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

/** Runs the headroom CLI (same machine as the daemon) for JSON reports. */
async function runHeadroomJson(args: string[]): Promise<unknown> {
  // Candidates are resolved per call so HEADROOM_BIN is honored at runtime.
  const candidates = [
    process.env.HEADROOM_BIN,
    "headroom",
    join(homedir(), ".local", "bin", "headroom"),
  ].filter((p): p is string => p !== undefined);
  let lastError: unknown;
  for (const bin of candidates) {
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
            total_input_tokens: z.number().optional(),
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

export function sessionStoreIds(cwd: string, baseDir: string = join(homedir(), ".omp", "agent", "sessions")): Set<string> {
  const slug = cwd.startsWith(homedir())
    ? cwd.slice(homedir().length).replaceAll("/", "-")
    : cwd.replaceAll("/", "-");
  const dir = join(baseDir, slug);
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
  total_input_tokens?: number;
  savings_percent?: number;
  last_activity_at?: string;
};

export function ledgerSessions(
  perProject: Record<string, LedgerRow> | undefined,
  filterIds?: Set<string>,
): HeadroomSession[] {
  return Object.entries(perProject ?? {})
    .map(([id, p]) => ({
      id,
      requests: p.requests,
      tokensSaved: p.tokens_saved,
      inputTokens: p.total_input_tokens,
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

// --- Extras: CLI-backed reports. Refreshes are coalesced per report type, an
// in-flight promise is shared across concurrent callers, and a refresh started
// later always supersedes an older one (out-of-order completions never win).
// Cached errors serve for the TTL so a broken CLI cannot spam subprocesses. ---

type WindowData = { tokensSaved?: number; calls?: number; savingsPct?: number };

export function pickWindow(w: unknown): WindowData | undefined {
  const v = z
    .object({
      tokens_saved: z.number().optional(),
      calls: z.number().optional(),
      savings_percent: z.number().optional(),
    })
    .safeParse(w);
  return v.success
    ? {
        tokensSaved: v.data.tokens_saved,
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
type CacheEntry<T> = { startedAt: number; value: T };

const LEDGER_TTL = 60_000;
const INSPECT_TTL = 30_000;

const ledgerStore: { entry: CacheEntry<ExtrasLedger> | null; inflight: Promise<ExtrasLedger> | null } = {
  entry: null,
  inflight: null,
};
const inspectStore: {
  entry: CacheEntry<ExtrasInspect> | null;
  inflight: Promise<ExtrasInspect> | null;
  inflightKey: number | null;
  key: number | null;
  startedAt: number;
} = { entry: null, inflight: null, inflightKey: null, key: NaN, startedAt: 0 };

async function getLedger(): Promise<ExtrasLedger> {
  const cached = ledgerStore.entry;
  const startedAt = Date.now();
  if (cached !== null && startedAt - cached.startedAt <= LEDGER_TTL) return cached.value;
  if (ledgerStore.inflight !== null) return ledgerStore.inflight;
  const inflight = (async () => {
    let value: ExtrasLedger;
    try {
      const parsed = z
        .object({ lifetime: z.unknown().optional(), windows: z.record(z.string(), z.unknown()).optional() })
        .parse(await runHeadroomJson(["savings", "--json"]));
      value = {
        today: parsed.windows ? pickWindow(parsed.windows.today) : undefined,
        lifetime: pickWindow(parsed.lifetime),
      };
    } catch (error) {
      value = { error: String(error) };
    }
    if (ledgerStore.entry === null || ledgerStore.entry.startedAt < startedAt) {
      ledgerStore.entry = { startedAt, value };
    }
    return value;
  })();
  ledgerStore.inflight = inflight;
  try {
    return await inflight;
  } finally {
    ledgerStore.inflight = null;
  }
}

async function getInspect(limit: number): Promise<ExtrasInspect> {
  const cached = inspectStore.entry;
  const startedAt = Date.now();
  const fresh = cached !== null && startedAt - cached.startedAt <= INSPECT_TTL && inspectStore.key === limit;
  if (fresh) return cached.value;
  // Join an in-flight refresh for the same limit; a different limit refreshes in parallel.
  if (inspectStore.inflight !== null && inspectStore.inflightKey === limit) return inspectStore.inflight;
  inspectStore.inflightKey = limit;
  const inflight = (async () => {
    let value: ExtrasInspect;
    try {
      const raw = await runHeadroomJson(["inspect", "--last", String(limit), "--format", "json"]);
      const list = Array.isArray(raw)
        ? raw
        : z.object({ requests: z.array(z.unknown()) }).parse(raw).requests;
      const requests = (list as unknown[]).slice(0, limit).map((entry) => {
        const flat: Record<string, string | number | boolean | null> = {};
        for (const [k, v] of Object.entries(z.record(z.string(), z.unknown()).parse(entry))) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
            flat[k] = v;
          }
        }
        return flat;
      });
      value = { available: true, requests };
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      value = { available: false, hint: message };
    }
    if (inspectStore.entry === null || inspectStore.entry.startedAt < startedAt) {
      inspectStore.entry = { startedAt, value };
      inspectStore.key = limit;
      inspectStore.startedAt = startedAt;
    }
    return value;
  })();
  inspectStore.inflight = inflight;
  try {
    return await inflight;
  } finally {
    inspectStore.inflight = null;
  }
}

export async function getHeadroomExtras({
  inspectLimit = 8,
}: {
  inspectLimit?: number;
}): Promise<{ ledger: ExtrasLedger; inspect: ExtrasInspect }> {
  // Defense in depth: the RPC contract already constrains this, but the value
  // is passed to a subprocess argv, so clamp at the call site too.
  const limit = Math.min(50, Math.max(1, Math.round(inspectLimit)));
  const [ledger, inspect] = await Promise.all([getLedger(), getInspect(limit)]);
  return { ledger, inspect };
}
