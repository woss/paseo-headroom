import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { HeadroomSession, HeadroomStats } from "../shared/headroom";

// Uses the same env var as the headroom CLI; default matches `headroom proxy`.
const port = process.env.HEADROOM_PORT ?? "8787";

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
      uncompressed_requests: z.object({ prefix_frozen: z.number().optional() }).optional(),
      cost: z
        .object({
          with_headroom_usd: z.number().optional(),
          without_headroom_usd: z.number().optional(),
          total_saved_usd: z.number().optional(),
          savings_pct: z.number().optional(),
        })
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

function ledgerSessions(
  perProject: Record<string, { requests?: number; tokens_saved?: number; compression_savings_usd?: number; savings_percent?: number; last_activity_at?: string }> | undefined,
  filterIds?: Set<string>,
): HeadroomSession[] {
  return Object.entries(perProject ?? {})
    .map(([id, p]) => ({
      id,
      requests: p.requests,
      tokensSaved: p.tokens_saved,
      costSaved: p.compression_savings_usd,
      savingsPct: p.savings_percent,
      lastActivityAt: p.last_activity_at,
    }))
    .filter((s) => filterIds === undefined || filterIds.has(s.id))
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""))
    .slice(0, 8);
}

export async function getHeadroomStats({ cwd }: { cwd?: string }): Promise<HeadroomStats> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
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
    return {
      live: true,
      port,
      model: s.primary_model,
      requests: s.api_requests,
      compressed: s.compression?.requests_compressed,
      tokensSaved: s.compression?.total_tokens_removed,
      tokensBefore: s.compression?.total_tokens_before,
      avgPct: s.compression?.avg_compression_pct,
      bestPct: s.compression?.best_compression_pct,
      bestDetail: s.compression?.best_detail,
      prefixFrozen: s.uncompressed_requests?.prefix_frozen,
      costWith: s.cost?.with_headroom_usd,
      costWithout: s.cost?.without_headroom_usd,
      costSaved: s.cost?.total_saved_usd,
      costSavingsPct: s.cost?.savings_pct,
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
