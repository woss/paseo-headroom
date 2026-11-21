import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const sessionSchema = z.object({
  id: z.string(),
  requests: z.number().optional(),
  tokensSaved: z.number().optional(),
  costSaved: z.number().optional(),
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
  tokensSaved: z.number().optional(),
  tokensBefore: z.number().optional(),
  avgPct: z.number().optional(),
  bestPct: z.number().optional(),
  bestDetail: z.string().optional(),
  prefixFrozen: z.number().optional(),
  costWith: z.number().optional(),
  costWithout: z.number().optional(),
  costSaved: z.number().optional(),
  costSavingsPct: z.number().optional(),
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
