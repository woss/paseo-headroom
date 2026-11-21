import type { HeadroomStats } from "../shared/headroom";

// Uses the same env var as the headroom CLI; default matches `headroom proxy`.
const port = process.env.HEADROOM_PORT ?? "8787";

export async function getHeadroomStats(): Promise<HeadroomStats> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/stats`, {
      signal: ac.signal,
    });
    if (!res.ok) return { live: false, error: `proxy HTTP ${res.status}`, port };
    const data = (await res.json()) as {
      summary?: {
        api_requests?: number;
        primary_model?: string;
        compression?: {
          requests_compressed?: number;
          avg_compression_pct?: number;
          best_compression_pct?: number;
          best_detail?: string;
          total_tokens_removed?: number;
          total_tokens_before?: number;
        };
        uncompressed_requests?: { prefix_frozen?: number };
        cost?: {
          with_headroom_usd?: number;
          without_headroom_usd?: number;
          total_saved_usd?: number;
          savings_pct?: number;
        };
      };
    };
    const s = data.summary ?? {};
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
    };
  } catch (error) {
    return { live: false, error: String(error), port };
  } finally {
    clearTimeout(timer);
  }
}
