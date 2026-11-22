import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const sessionSchema = z.object({
  id: z.string(),
  requests: z.number().optional(),
  tokensSaved: z.number().optional(),
  inputTokens: z.number().optional(),
  savingsPct: z.number().optional(),
  lastActivityAt: z.string().optional(),
});

export type HeadroomSession = z.infer<typeof sessionSchema>;

const statsSchema = z.object({
  live: z.boolean(),
  error: z.string().optional(),
  port: z.string().optional(),
  model: z.string().optional(),
  requests: z.number().optional(),
  compressed: z.number().optional(),
  prefixFrozen: z.number().optional(),
  noCompressible: z.number().optional(),
  tip: z.string().optional(),
  tokensSaved: z.number().optional(),
  tokensBefore: z.number().optional(),
  avgPct: z.number().optional(),
  bestPct: z.number().optional(),
  bestDetail: z.string().optional(),
  fetchedAt: z.string().optional(),
  models: z.array(z.object({ model: z.string(), requests: z.number() })).optional(),
  sessions: z.array(sessionSchema).optional(),
  workspaceSessions: z.array(sessionSchema).optional(),
});

export type HeadroomStats = z.infer<typeof statsSchema>;

export const headroomStats = defineRpc({
  name: "headroom.stats",
  input: z.object({ cwd: z.string().optional() }),
  output: statsSchema,
});

const windowSchema = z.object({
  tokensSaved: z.number().optional(),
  calls: z.number().optional(),
  savingsPct: z.number().optional(),
});

const extrasOutput = z.object({
  ledger: z
    .object({
      today: windowSchema.optional(),
      lifetime: windowSchema.optional(),
      error: z.string().optional(),
    })
    .optional(),
  inspect: z
    .object({
      available: z.boolean(),
      hint: z.string().optional(),
      requests: z
        .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .optional(),
    })
    .optional(),
});

export type HeadroomExtras = z.infer<typeof extrasOutput>;

export const headroomExtras = defineRpc({
  name: "headroom.extras",
  input: z.object({
    inspectLimit: z.number().int().min(1).max(50).optional(),
  }),
  output: extrasOutput,
});

// An omp session's last proxy request and its agent's last turn land within
// minutes of each other; beyond this window a row is treated as unrelated.
export const MATCH_WINDOW_MS = 20 * 60 * 1000;

// Dollar figures are computed plugin-side from exact token counts, NOT from
// the proxy's baked cost_usd (which prices glm-5.3-flash at ~$3/1M — 13-75x
// the real opencode-zen rate). Source: models.dev, opencode-zen/glm-5.3-flash
// input rate, verified 2026-11-22.
export const INPUT_RATE_PER_1M = 0.15;

export function estimateUsd(tokens: number | undefined): number | undefined {
  if (tokens === undefined) return undefined;
  return (tokens / 1e6) * INPUT_RATE_PER_1M;
}

export type SessionAgent = { id: string; title: string | null; lastActivityAt: string };

/** Joins ledger rows to agents by last-activity proximity, nearest first, one agent per row. */
export function matchAgents(
  sessions: HeadroomSession[],
  agents: SessionAgent[],
): Map<string, SessionAgent> {
  const matches = new Map<string, SessionAgent>();
  const usedAgents = new Set<string>();
  for (const session of sessions) {
    if (session.lastActivityAt === undefined) continue;
    const sessionTime = new Date(session.lastActivityAt).getTime();
    let best: { agent: SessionAgent; delta: number } | undefined;
    for (const agent of agents) {
      if (usedAgents.has(agent.id)) continue;
      const delta = Math.abs(new Date(agent.lastActivityAt).getTime() - sessionTime);
      if (delta <= MATCH_WINDOW_MS && (best === undefined || delta < best.delta)) {
        best = { agent, delta };
      }
    }
    if (best !== undefined) {
      matches.set(session.id, best.agent);
      usedAgents.add(best.agent.id);
    }
  }
  return matches;
}

/** The one session nearest in time to an agent's last turn. windowMs defaults
 * to the 20-minute live window; pass Infinity for "nearest, no cap" (panel hero). */
export function nearestSession(
  sessions: HeadroomSession[],
  agent: SessionAgent,
  windowMs: number = MATCH_WINDOW_MS,
): HeadroomSession | undefined {
  let best: { row: HeadroomSession; delta: number } | undefined;
  for (const row of sessions) {
    if (row.lastActivityAt === undefined) continue;
    const delta = Math.abs(new Date(row.lastActivityAt).getTime() - new Date(agent.lastActivityAt).getTime());
    if (delta <= windowMs && (best === undefined || delta < best.delta)) {
      best = { row, delta };
    }
  }
  return best?.row;
}
