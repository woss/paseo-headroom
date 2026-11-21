import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { headroomStats } from "../shared/headroom";
import type { HeadroomStats } from "../shared/headroom";

// One surface for both registrations: workspace panels and screens share theme + layout.
type SurfaceProps = Pick<PluginScreenProps, "theme" | "layout">;

function compact(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

const usd = (n: number | undefined) => (n === undefined ? "—" : `$${n.toFixed(2)}`);
const pct = (n: number | undefined) => (n === undefined ? "—" : `${n.toFixed(1)}%`);

function ago(iso: string | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Micro({ children, theme }: { children: string; theme: SurfaceProps["theme"] }) {
  return (
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase" }}>
      {children}
    </Text>
  );
}

function StatCard({
  label,
  value,
  sub,
  theme,
  compactLayout,
}: {
  label: string;
  value: string;
  sub?: string;
  theme: SurfaceProps["theme"];
  compactLayout: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        gap: 3,
        padding: compactLayout ? 10 : 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Micro theme={theme}>{label}</Micro>
      <Text style={{ color: theme.colors.foreground, fontSize: compactLayout ? 15 : 17, fontWeight: "700" }}>
        {value}
      </Text>
      {sub !== undefined && (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
  );
}

export function SavingsPanel({ theme, layout }: SurfaceProps) {
  const getStats = useRpc(headroomStats);
  const query = useQuery({
    queryKey: ["headroom-stats"],
    queryFn: () => getStats({}),
    refetchInterval: 5000,
  });
  const s: HeadroomStats | undefined = query.data;
  const c = layout.compact;

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: c ? 16 : 24,
        gap: c ? 14 : 20,
        backgroundColor: theme.colors.surface0,
      },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      title: { color: theme.colors.foreground, fontSize: c ? 16 : 20, fontWeight: "700" as const },
      model: { color: theme.colors.foregroundMuted, fontSize: 12 },
      dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: s?.live ? theme.colors.statusSuccess : theme.colors.border,
      },
      hero: { gap: 2 },
      heroNumber: {
        color: theme.colors.foreground,
        fontSize: c ? 38 : 52,
        fontWeight: "800" as const,
        letterSpacing: -1,
      },
      heroSub: { color: theme.colors.foregroundMuted, fontSize: c ? 12 : 14 },
      grid: { flexDirection: "row" as const, gap: 10 },
      section: { gap: 8 },
      card: {
        gap: 10,
        padding: c ? 10 : 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      sessionId: { color: theme.colors.foreground, fontSize: 12, fontWeight: "600" as const },
      sessionMeta: { color: theme.colors.foregroundMuted, fontSize: 11 },
      pill: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: theme.colors.surface2,
      },
      pillText: { color: theme.colors.foreground, fontSize: 10, fontWeight: "600" as const },
      value: { color: theme.colors.foreground, fontSize: 12, fontWeight: "600" as const },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [theme, c, s?.live],
  );

  if (query.isPending) {
    return (
      <View style={styles.screen}>
        <Text style={styles.muted}>Connecting to Headroom proxy…</Text>
      </View>
    );
  }

  if (s && !s.live) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.dot} />
          <Text style={styles.title}>Headroom proxy not reachable</Text>
        </View>
        <Text style={styles.muted}>Start it with `headroom proxy` (port {s?.port ?? "8787"}).</Text>
        <Text style={styles.muted}>{s.error}</Text>
      </View>
    );
  }

  const savedPct =
    s?.tokensSaved !== undefined && s.tokensBefore ? (s.tokensSaved / s.tokensBefore) * 100 : undefined;

  return (
    <ScrollView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.dot} />
        <Text style={styles.title}>Headroom</Text>
        <Text style={styles.model}>{s?.model ?? ""}</Text>
      </View>

      <View style={styles.hero}>
        <Micro theme={theme}>Tokens removed</Micro>
        <Text style={styles.heroNumber}>{compact(s?.tokensSaved)}</Text>
        <Text style={styles.heroSub}>
          of {compact(s?.tokensBefore)} sent · {pct(savedPct)} lighter prompts
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        <View style={styles.grid}>
          <StatCard label="Avg compression" value={pct(s?.avgPct)} theme={theme} compactLayout={c} />
          <StatCard
            label="Best"
            value={pct(s?.bestPct)}
            sub={s?.bestDetail}
            theme={theme}
            compactLayout={c}
          />
        </View>
        <View style={styles.grid}>
          <StatCard
            label="Cost saved"
            value={usd(s?.costSaved)}
            sub={`${usd(s?.costWithout)} → ${usd(s?.costWith)}`}
            theme={theme}
            compactLayout={c}
          />
          <StatCard
            label="Requests"
            value={compact(s?.requests)}
            sub={`${compact(s?.compressed)} compressed · ${compact(s?.prefixFrozen)} frozen`}
            theme={theme}
            compactLayout={c}
          />
        </View>
      </View>

      {s?.sessions !== undefined && s.sessions.length > 0 && (
        <View style={styles.section}>
          <Micro theme={theme}>Sessions</Micro>
          <View style={styles.card}>
            {s.sessions.map((session, i) => (
              <View key={session.id} style={{ gap: 10 }}>
                {i > 0 && <View style={{ height: 1, backgroundColor: theme.colors.border }} />}
                <View style={styles.row}>
                  <View style={{ width: 8, alignItems: "center" }}>
                    {i === 0 && (
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: theme.colors.statusSuccess,
                        }}
                      />
                    )}
                  </View>
                  <Text style={styles.sessionId}>{session.id.slice(0, 8)}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.value}>{compact(session.tokensSaved)}</Text>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{pct(session.savingsPct)}</Text>
                  </View>
                  <Text style={styles.sessionMeta}>{usd(session.costSaved)}</Text>
                  <Text style={styles.sessionMeta}>{ago(session.lastActivityAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
