import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { HeadroomSession, HeadroomStats } from "../shared/headroom";

// Uses the same env var as the headroom CLI; default matches `headroom proxy`.
const port = process.env.HEADROOM_PORT ?? "8787";

const exec = promisify(execFile);
const HEADROOM_CANDIDATES = [
  process.env.HEADROOM_BIN,
  "headroom",
  join(homedir(), ".local", "bin", "headroom"),
].filter((p): p is string => p !== undefined);

/** Runs the headroom CLI (same machine as the daemon) for JSON reports. */
async function runHeadroomJson(args: string[]): Promise<unknown> {
  let lastError: unknown;
  for (const bin of HEADROOM_CANDIDATES) {
    try {
      const { stdout } = await exec(bin, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) {
      lastError = error;
      // Binary missing at this candidate: try the next path. CLI errors are real results.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("headroom CLI not found");
}

const statsPayload = z.object({
  summary: z
    .object({
      api_requests: z.number().optional(),
      primary_model: z.string().optional(),
      compression: z
        .object({
          requests_compressed: z.number().optional(),
          avg_compression_pct: z.number().optional(),
          best_compression_pct: z.number().optional(),
          best_detail: z.string().optional(),
          total_tokens_removed: z.number().optional(),
          total_tokens_before: z.number().optional(),
        })
        .optional(),
      uncompressed_requests: z
        .object({
          prefix_frozen: z.number().optional(),
          no_compressible_content: z.number().optional(),
        })
        .optional(),
      tip: z.string().optional(),
      cost: z
        .object({
          with_headroom_usd: z.number().optional(),
          without_headroom_usd: z.number().optional(),
          total_saved_usd: z.number().optional(),
          savings_pct: z.number().optional(),
          breakdown: z
            .object({
              compression_savings_usd: z.number().optional(),
              cache_savings_usd: z.number().optional(),
              tool_search_savings_usd: z.number().optional(),
              extension_realized_usd: z.number().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  agent_usage: z
    .object({
      agents: z
        .array(
          z.object({
            label: z.string().optional(),
            models: z.record(z.string(), z.number()).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  savings: z
    .object({
      per_project: z
        .record(
          z.string(),
          z.object({
            requests: z.number().optional(),
            tokens_saved: z.number().optional(),
            compression_savings_usd: z.number().optional(),
            total_input_tokens: z.number().optional(),
            total_input_cost_usd: z.number().optional(),
            savings_percent: z.number().optional(),
            last_activity_at: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

// omp session UUIDs appear in "<timestamp>_<uuid>" file and dir names.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function sessionStoreIds(cwd: string): Set<string> {
  const slug = cwd.startsWith(homedir())
    ? cwd.slice(homedir().length).replaceAll("/", "-")
    : cwd.replaceAll("/", "-");
  const dir = join(homedir(), ".omp", "agent", "sessions", slug);
  try {
    const ids = new Set<string>();
    for (const entry of readdirSync(dir)) {
      const match = UUID_RE.exec(entry);
      if (match) ids.add(match[0]);
    }
    return ids;
  } catch {
    return new Set();
  }
}

type LedgerRow = {
  requests?: number;
  tokens_saved?: number;
  compression_savings_usd?: number;
  total_input_tokens?: number;
  total_input_cost_usd?: number;
  savings_percent?: number;
  last_activity_at?: string;
};

function ledgerSessions(
  perProject: Record<string, LedgerRow> | undefined,
  filterIds?: Set<string>,
): HeadroomSession[] {
  return Object.entries(perProject ?? {})
    .map(([id, p]) => ({
      id,
      requests: p.requests,
      tokensSaved: p.tokens_saved,
      inputTokens: p.total_input_tokens,
      costSaved: p.compression_savings_usd,
      inputCost: p.total_input_cost_usd,
      savingsPct: p.savings_percent,
      lastActivityAt: p.last_activity_at,
    }))
    .filter((s) => filterIds === undefined || filterIds.has(s.id))
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""))
    .slice(0, 8);
}

export async function getHeadroomStats({ cwd }: { cwd?: string }): Promise<HeadroomStats> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/stats`, {
      signal: ac.signal,
    });
    if (!res.ok) return { live: false, error: `proxy HTTP ${res.status}`, port };
    const data = statsPayload.parse(await res.json());
    const s = data.summary ?? {};
    const sessions = ledgerSessions(data.savings?.per_project);
    const workspaceIds = cwd === undefined ? undefined : sessionStoreIds(cwd);
    const workspaceSessions =
      workspaceIds === undefined ? undefined : ledgerSessions(data.savings?.per_project, workspaceIds);
    const modelsMap = new Map<string, number>();
    for (const agent of data.agent_usage?.agents ?? []) {
      for (const [model, requests] of Object.entries(agent.models ?? {})) {
        modelsMap.set(model, (modelsMap.get(model) ?? 0) + requests);
      }
    }
    const models = [...modelsMap.entries()]
      .map(([model, requests]) => ({ model, requests }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 5);
    const b = s.cost?.breakdown;
    const layers = b
      ? ([
          { name: "compression", usd: b.compression_savings_usd },
          { name: "cache", usd: b.cache_savings_usd },
          { name: "tool search", usd: b.tool_search_savings_usd },
          { name: "extension", usd: b.extension_realized_usd },
        ].filter((l): l is { name: string; usd: number } => typeof l.usd === "number"))
      : undefined;
    return {
      live: true,
      port,
      model: s.primary_model,
      requests: s.api_requests,
      compressed: s.compression?.requests_compressed,
      prefixFrozen: s.uncompressed_requests?.prefix_frozen,
      noCompressible: s.uncompressed_requests?.no_compressible_content,
      tip: s.tip,
      tokensSaved: s.compression?.total_tokens_removed,
      tokensBefore: s.compression?.total_tokens_before,
      avgPct: s.compression?.avg_compression_pct,
      bestPct: s.compression?.best_compression_pct,
      bestDetail: s.compression?.best_detail,
      costWith: s.cost?.with_headroom_usd,
      costWithout: s.cost?.without_headroom_usd,
      costSaved: s.cost?.total_saved_usd,
      costSavingsPct: s.cost?.savings_pct,
      layers,
      models,
      fetchedAt: new Date().toISOString(),
      sessions,
      workspaceSessions,
    };
  } catch (error) {
    return { live: false, error: String(error), port };
  } finally {
    clearTimeout(timer);
  }
}

// --- Extras: CLI-backed reports, cached so the 15s panel poll stays cheap. ---

type WindowData = { tokensSaved?: number; costUsd?: number; calls?: number; savingsPct?: number };

function pickWindow(w: unknown): WindowData | undefined {
  const v = z
    .object({
      tokens_saved: z.number().optional(),
      cost_usd: z.number().optional(),
      calls: z.number().optional(),
      savings_percent: z.number().optional(),
    })
    .safeParse(w);
  return v.success
    ? {
        tokensSaved: v.data.tokens_saved,
        costUsd: v.data.cost_usd,
        calls: v.data.calls,
        savingsPct: v.data.savings_percent,
      }
    : undefined;
}

type ExtrasLedger = { today?: WindowData; lifetime?: WindowData; error?: string };
type ExtrasInspect = {
  available: boolean;
  hint?: string;
  requests?: Array<Record<string, string | number | boolean | null>>;
};
type CacheEntry<T> = { at: number; key: unknown; value: T };

let ledgerCache: CacheEntry<ExtrasLedger> | null = null;
let inspectCache: CacheEntry<ExtrasInspect> | null = null;

// Cache lifetime matches the panel poll so at most one subprocess runs per poll.
const LEDGER_TTL = 60_000;
const INSPECT_TTL = 30_000;

export async function getHeadroomExtras({
  inspectLimit = 8,
}: {
  inspectLimit?: number;
}): Promise<{ ledger?: ExtrasLedger; inspect?: ExtrasInspect }> {
  let ledger = ledgerCache;
  if (ledger === null || Date.now() - ledger.at > LEDGER_TTL) {
    try {
      const raw = await runHeadroomJson(["savings", "--json"]);
      const parsed = z
        .object({
          lifetime: z.unknown().optional(),
          windows: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(raw);
      ledger = {
        at: Date.now(),
        key: null,
        value: {
          today: parsed.windows ? pickWindow(parsed.windows.today) : undefined,
          lifetime: pickWindow(parsed.lifetime),
        },
      };
    } catch (error) {
      ledger = { at: Date.now(), key: null, value: { error: String(error) } };
    }
    ledgerCache = ledger;
  }

  let inspect = inspectCache;
  if (inspect === null || Date.now() - inspect.at > INSPECT_TTL || inspect.key !== inspectLimit) {
    try {
      const raw = await runHeadroomJson(["inspect", "--last", String(inspectLimit), "--format", "json"]);
      const list = Array.isArray(raw)
        ? raw
        : z.object({ requests: z.array(z.unknown()) }).parse(raw).requests;
      const requests = (list as unknown[]).slice(0, inspectLimit).map((entry) => {
        const flat: Record<string, string | number | boolean | null> = {};
        for (const [k, v] of Object.entries(z.record(z.string(), z.unknown()).parse(entry))) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
            flat[k] = v;
          }
        }
        return flat;
      });
      inspect = { at: Date.now(), key: inspectLimit, value: { available: true, requests } };
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      inspect = {
        at: Date.now(),
        key: inspectLimit,
        value: { available: false, hint: message },
      };
    }
    inspectCache = inspect;
  }

  return { ledger: ledger.value, inspect: inspect.value };
}
