import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const sessionSchema = z.object({
  id: z.string(),
  requests: z.number().optional(),
  tokensSaved: z.number().optional(),
  costSaved: z.number().optional(),
  inputCost: z.number().optional(),
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
  costWith: z.number().optional(),
  costWithout: z.number().optional(),
  costSaved: z.number().optional(),
  costSavingsPct: z.number().optional(),
  layers: z
    .array(z.object({ name: z.string(), usd: z.number() }))
    .optional(),
  models: z.array(z.object({ model: z.string(), requests: z.number() })).optional(),
  fetchedAt: z.string().optional(),
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
  costUsd: z.number().optional(),
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
  input: z.object({ inspectLimit: z.number().optional() }),
  output: extrasOutput,
});
