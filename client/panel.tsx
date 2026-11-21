import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { headroomStats } from "../shared/headroom";
import type { HeadroomStats } from "../shared/headroom";

function compact(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

const usd = (n: number | undefined) => (n === undefined ? "—" : `$${n.toFixed(2)}`);
const pct = (n: number | undefined) => (n === undefined ? "—" : `${n.toFixed(1)}%`);

function Row({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: { label: object; value: object };
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function SavingsPanel({ theme, layout }: PluginWorkspacePanelProps) {
  const getStats = useRpc(headroomStats);
  const query = useQuery({
    queryKey: ["headroom-stats"],
    queryFn: () => getStats({}),
    refetchInterval: 5000,
  });
  const s: HeadroomStats | undefined = query.data;

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        gap: layout.compact ? 10 : 14,
        backgroundColor: theme.colors.surface0,
      },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 18 : 22, fontWeight: "600" as const },
      model: { color: theme.colors.foregroundMuted, fontSize: layout.compact ? 12 : 14 },
      dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: s?.live ? theme.colors.statusSuccess : theme.colors.border,
      },
      saved: { color: theme.colors.foreground, fontSize: layout.compact ? 34 : 44, fontWeight: "700" as const },
      savedLabel: { color: theme.colors.foregroundMuted, fontSize: layout.compact ? 12 : 14 },
      label: { color: theme.colors.foregroundMuted, fontSize: layout.compact ? 12 : 14 },
      value: { color: theme.colors.foreground, fontSize: layout.compact ? 12 : 14 },
      box: {
        gap: 6,
        padding: layout.compact ? 10 : 14,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
      },
    }),
    [theme, layout.compact, s?.live],
  );

  if (query.isPending) {
    return (
      <View style={styles.screen}>
        <Text style={styles.savedLabel}>Connecting to Headroom proxy…</Text>
      </View>
    );
  }

  if (s && !s.live) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Headroom proxy not reachable</Text>
        <Text style={styles.savedLabel}>
          Start it with `headroom proxy` (port {s?.port ?? "8787"}).
        </Text>
        <Text style={styles.savedLabel}>{s.error}</Text>
      </View>
    );
  }

  const savedPct = s?.tokensSaved !== undefined && s.tokensBefore ? (s.tokensSaved / s.tokensBefore) * 100 : undefined;

  return (
    <ScrollView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.dot} />
        <Text style={styles.title}>Headroom savings</Text>
        <Text style={styles.model}>{s?.model ?? ""}</Text>
      </View>

      <View>
        <Text style={styles.saved}>{compact(s?.tokensSaved)}</Text>
        <Text style={styles.savedLabel}>
          tokens removed of {compact(s?.tokensBefore)} sent · {pct(savedPct)}
        </Text>
      </View>

      <View style={styles.box}>
        <Row label="Requests" value={compact(s?.requests)} styles={styles} />
        <Row label="Compressed" value={`${compact(s?.compressed)} · avg ${pct(s?.avgPct)}`} styles={styles} />
        <Row label="Best compression" value={s?.bestDetail ? `${pct(s?.bestPct)} (${s.bestDetail})` : pct(s?.bestPct)} styles={styles} />
        <Row label="Prefix-frozen" value={compact(s?.prefixFrozen)} styles={styles} />
        <Row label="Cost saved" value={`${usd(s?.costSaved)} (${pct(s?.costSavingsPct)})`} styles={styles} />
        <Row label="Full price → with Headroom" value={`${usd(s?.costWithout)} → ${usd(s?.costWith)}`} styles={styles} />
      </View>
    </ScrollView>
  );
}
