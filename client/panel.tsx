import type { PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useAgent, usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { headroomExtras, headroomStats } from "../shared/headroom";
import type {
  HeadroomSession,
  HeadroomStats,
} from "../shared/headroom";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";

// One surface for both registrations: workspace panels and screens share theme + layout.
type SurfaceProps = Pick<PluginScreenProps, "theme" | "layout">;

export function compact(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

const usd = (n: number | undefined) => (n === undefined ? "—" : `$${n.toFixed(2)}`);

export function pct(n: number | undefined): string {
  return n === undefined ? "—" : `${n.toFixed(1)}%`;
}

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
        gap: 4,
        padding: compactLayout ? 12 : 18,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Micro theme={theme}>{label}</Micro>
      <Text style={{ color: theme.colors.foreground, fontSize: compactLayout ? 16 : 19, fontWeight: "700" }}>
        {value}
      </Text>
      {sub !== undefined && (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
  );
}

function Card({
  theme,
  compactLayout,
  children,
}: {
  theme: SurfaceProps["theme"];
  compactLayout: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={{
        gap: 8,
        flex: 1,
        padding: compactLayout ? 12 : 18,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      {children}
    </View>
  );
}

function SplitBar({
  segments,
  theme,
}: {
  segments: { label: string; value: number; color: string }[];
  theme: SurfaceProps["theme"];
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: "row",
          height: 8,
          borderRadius: 4,
          overflow: "hidden",
          backgroundColor: theme.colors.surface2,
        }}
      >
        {segments.map(
          (s) =>
            s.value > 0 && (
              <View key={s.label} style={{ flexGrow: s.value / total, backgroundColor: s.color }} />
            ),
        )}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {segments.map((s) => (
          <View key={s.label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.color }} />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
              {s.label} {compact(s.value)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

type SessionAgent = { id: string; title: string | null; lastActivityAt: string };

/** Subscribes to the host's agents; used to link ledger rows to openable conversations. */
function useAgents(paseo: ReturnType<typeof usePaseo>, enabled: boolean): SessionAgent[] {
  const [agents, setAgents] = useState<SessionAgent[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    void paseo.agents
      .list({ subscribe: {}, signal: ac.signal })
      .then(({ subscription }) => {
        subscription.subscribe({
          snapshot: ({ entries }) => {
            setAgents(
              entries
                .map(({ agent }) => ({
                  id: agent.id,
                  title: agent.title,
                  lastActivityAt: agent.updatedAt,
                }))
                .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
            );
          },
          update: () => {},
        });
        return undefined;
      })
      .catch(() => {});
    return () => ac.abort();
  }, [paseo, enabled]);
  return agents;
}

/**
 * Joins proxy ledger rows to Paseo agents by last-activity proximity: an omp
 * session's most recent proxy request and its agent's last turn land within
 * minutes of each other. Unmatched rows stay plain session ids.
 */
function matchAgents(sessions: HeadroomSession[], agents: SessionAgent[]): Map<string, SessionAgent> {
  const matches = new Map<string, SessionAgent>();
  const usedAgents = new Set<string>();
  for (const session of sessions) {
    if (session.lastActivityAt === undefined) continue;
    const sessionTime = new Date(session.lastActivityAt).getTime();
    let best: { agent: SessionAgent; delta: number } | undefined;
    for (const agent of agents) {
      if (usedAgents.has(agent.id)) continue;
      const delta = Math.abs(new Date(agent.lastActivityAt).getTime() - sessionTime);
      if (delta < 20 * 60 * 1000 && (best === undefined || delta < best.delta)) {
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

function SessionRow({
  session,
  agent,
  live,
  theme,
  onPress,
}: {
  session: HeadroomSession;
  agent?: SessionAgent;
  live: boolean;
  theme: SurfaceProps["theme"];
  onPress?: () => void;
}) {
  const linkable = agent !== undefined && onPress !== undefined;
  return (
    <Pressable
      accessibilityRole={linkable ? "button" : undefined}
      accessibilityLabel={
        linkable ? `Open session ${agent?.title ?? session.id.slice(0, 8)}` : undefined
      }
      onPress={onPress}
      disabled={!linkable}
      style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
    >
      <View style={{ width: 8, alignItems: "center" }}>
        {live && (
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.statusSuccess }} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{
            color: linkable ? theme.colors.accent : theme.colors.foreground,
            fontSize: 13,
            fontWeight: "600",
          }}
        >
          {agent?.title ?? session.id.slice(0, 8)}
          {linkable ? "  ↗" : ""}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {session.id.slice(0, 8)} · {usd(session.costSaved)}
          {session.inputCost !== undefined && session.inputCost > 0
            ? ` of ${usd(session.inputCost)}`
            : ""}{" "}
          · {ago(session.lastActivityAt)}
        </Text>
      </View>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
        {compact(session.tokensSaved)}
      </Text>
      <View
        style={{
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 2,
          backgroundColor: theme.colors.surface2,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 10, fontWeight: "600" }}>
          {pct(session.savingsPct)}
        </Text>
      </View>
    </Pressable>
  );
}

function SessionSection({
  label,
  sessions,
  agents,
  theme,
  compactLayout,
  match,
  onOpenAgent,
}: {
  label: string;
  sessions: HeadroomSession[];
  agents: SessionAgent[];
  theme: SurfaceProps["theme"];
  compactLayout: boolean;
  match: boolean;
  onOpenAgent?: (input: { agentId: string }) => void;
}) {
  if (sessions.length === 0) return null;
  const links = match ? matchAgents(sessions, agents) : new Map<string, SessionAgent>();
  return (
    <View style={{ gap: 10 }}>
      <Micro theme={theme}>{label}</Micro>
      <View
        style={{
          gap: compactLayout ? 12 : 16,
          padding: compactLayout ? 12 : 18,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        }}
      >
        {sessions.map((session, i) => {
          const agent = links.get(session.id);
          return (
            <View key={session.id} style={{ gap: compactLayout ? 12 : 16 }}>
              {i > 0 && <View style={{ height: 1, backgroundColor: theme.colors.border }} />}
              <SessionRow
                session={session}
                agent={agent}
                live={match && i === 0}
                theme={theme}
                onPress={agent && onOpenAgent ? () => onOpenAgent({ agentId: agent.id }) : undefined}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function SavingsSurface({
  theme,
  layout,
  cwd,
  workspaceId,
  openAgent,
}: SurfaceProps & {
  cwd?: string;
  workspaceId?: string;
  openAgent?: (input: { agentId: string }) => void;
}) {
  const paseo = usePaseo();
  const getStats = useRpc(headroomStats);
  const query = useQuery({
    queryKey: ["headroom-stats", cwd ?? "all"],
    queryFn: () => getStats({ cwd }),
    refetchInterval: 5000,
  });
  const raw: HeadroomStats | undefined = query.data;
  // Transient proxy hiccups (slow /stats, abort) shouldn't blank the panel:
  // fall back to the last good snapshot and mark the dot stale.
  const lastLive = useRef<HeadroomStats | undefined>(undefined);
  if (raw?.live) lastLive.current = raw;
  const stale = raw !== undefined && !raw.live && lastLive.current !== undefined;
  // Downstream keeps the name `s`: while stale it is the last good snapshot.
  const s = stale ? lastLive.current : raw;
  const getExtras = useRpc(headroomExtras);
  const extras = useQuery({
    queryKey: ["headroom-extras"],
    queryFn: () => getExtras({ inspectLimit: 8 }),
    refetchInterval: 15000,
  }).data;
  const c = layout.compact;
  // Agent linking only where the surface knows its workspace; time-proximity is
  // meaningless across projects.
  const agents = useAgents(paseo, workspaceId !== undefined);

  const styles = useMemo(
    () => ({
      scroll: { flex: 1, backgroundColor: theme.colors.surface0 },
      // Centered column: full-bleed cards on a wide window read as empty space.
      screen: {
        padding: c ? 16 : 32,
        gap: c ? 14 : 24,
        width: "100%" as const,
        maxWidth: 880,
        marginLeft: "auto" as const,
        marginRight: "auto" as const,
      },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      title: { color: theme.colors.foreground, fontSize: c ? 16 : 20, fontWeight: "700" as const },
      model: { color: theme.colors.foregroundMuted, fontSize: 12 },
      dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: stale
          ? theme.colors.statusWarning
          : s?.live
            ? theme.colors.statusSuccess
            : theme.colors.border,
      },
      hero: {
        gap: c ? 10 : 16,
        padding: c ? 14 : 24,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      heroNumber: {
        color: theme.colors.foreground,
        fontSize: c ? 38 : 56,
        fontWeight: "800" as const,
        letterSpacing: -1,
      },
      heroSub: { color: theme.colors.foregroundMuted, fontSize: c ? 12 : 14 },
      ratioTrack: {
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.surface2,
      },
      ratioFill: {
        height: 8,
        borderRadius: 4,
        minWidth: 8,
        backgroundColor: theme.colors.statusSuccess,
      },
      eqRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexWrap: "wrap" as const },
      eqPill: {
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 5,
        backgroundColor: theme.colors.surface2,
      },
      eqPillAccent: { backgroundColor: theme.colors.accent },
      eqText: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      eqTextAccent: { color: theme.colors.accentForeground },
      grid: { flexDirection: "row" as const, gap: 12 },
      section: { gap: 10 },
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

  if (raw !== undefined && !raw.live && lastLive.current === undefined) {
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

  // With a workspace cwd, the proxy ledger rows in this workspace's omp session
  // store are "this workspace"; the rest are other sessions.
  const workspaceSet = new Set(s?.workspaceSessions?.map((x) => x.id) ?? []);
  const otherSessions = cwd
    ? (s?.sessions ?? []).filter((x) => !workspaceSet.has(x.id))
    : (s?.sessions ?? []);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View style={styles.dot} />
        <Text style={styles.title}>Headroom</Text>
        <Text style={styles.model}>{s?.model ?? ""}</Text>
      </View>

      <View style={styles.hero}>
        <View style={{ gap: 2 }}>
          <Micro theme={theme}>Tokens removed</Micro>
          <Text style={styles.heroNumber}>{compact(s?.tokensSaved)}</Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <View style={styles.ratioTrack}>
              <View style={[styles.ratioFill, { width: `${Math.min(100, Math.max(0, savedPct ?? 0))}%` }]} />
            </View>
          </View>
          <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "700" }}>
            {pct(savedPct)}
          </Text>
        </View>

        <View style={styles.eqRow}>
          <View style={styles.eqPill}>
            <Text style={styles.eqText}>{compact(s?.tokensBefore)} sent</Text>
          </View>
          <Text style={styles.eqText}>−</Text>
          <View style={[styles.eqPill, styles.eqPillAccent]}>
            <Text style={[styles.eqText, styles.eqTextAccent]}>{compact(s?.tokensSaved)} removed</Text>
          </View>
          <Text style={styles.eqText}>=</Text>
          <View style={styles.eqPill}>
            <Text style={styles.eqText}>
              {s?.tokensBefore !== undefined && s.tokensSaved !== undefined
                ? compact(s.tokensBefore - s.tokensSaved)
                : "—"}{" "}
              billed
            </Text>
          </View>
        </View>
      </View>

      {s?.tip && (
        <View
          style={{
            gap: 2,
            padding: c ? 10 : 14,
            borderRadius: 12,
            borderLeftWidth: 3,
            borderLeftColor: theme.colors.accent,
            backgroundColor: theme.colors.surface1,
          }}
        >
          <Micro theme={theme}>Tip</Micro>
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{s.tip}</Text>
        </View>
      )}

      {extras?.ledger !== undefined && (
        <View style={styles.grid}>
          <StatCard
            label="Saved today"
            value={usd(extras.ledger.today?.costUsd)}
            sub={`${compact(extras.ledger.today?.tokensSaved)} tokens · ${compact(extras.ledger.today?.calls)} calls`}
            theme={theme}
            compactLayout={c}
          />
          <StatCard
            label="Saved lifetime"
            value={usd(extras.ledger.lifetime?.costUsd)}
            sub={`${compact(extras.ledger.lifetime?.tokensSaved)} tokens · ${compact(extras.ledger.lifetime?.calls)} calls`}
            theme={theme}
            compactLayout={c}
          />
        </View>
      )}

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

      {(s?.compressed !== undefined || s?.prefixFrozen !== undefined || s?.noCompressible !== undefined) && (
        <View style={styles.grid}>
          <Card theme={theme} compactLayout={c as boolean}>
            <Micro theme={theme}>Traffic</Micro>
            <SplitBar
              theme={theme}
              segments={[
                { label: "compressed", value: s?.compressed ?? 0, color: theme.colors.statusSuccess },
                { label: "frozen", value: s?.prefixFrozen ?? 0, color: theme.colors.accent },
                { label: "plain", value: s?.noCompressible ?? 0, color: theme.colors.border },
              ]}
            />
          </Card>
          <Card theme={theme} compactLayout={c}>
            <Micro theme={theme}>Savings layers</Micro>
            {s?.layers !== undefined && s.layers.length > 0 && (
              <SplitBar
                theme={theme}
                segments={s.layers.map((layer, i) => ({
                  label: layer.name,
                  value: Math.round(layer.usd * 100),
                  color: [theme.colors.statusSuccess, theme.colors.accent, theme.colors.border, theme.colors.surface2][i % 4],
                }))}
              />
            )}
            <View style={{ gap: 2 }}>
              {s?.layers?.map((layer) => (
                <Text key={layer.name} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                  {layer.name}: {usd(layer.usd)}
                </Text>
              ))}
            </View>
          </Card>
        </View>
      )}

      {s?.models !== undefined && s.models.length > 0 && (
        <View style={styles.section}>
          <Micro theme={theme}>Model mix</Micro>
          <Card theme={theme} compactLayout={c}>
            {s.models.map((m, i) => {
              const max = s.models?.[0]?.requests ?? 1;
              return (
                <View key={m.model} style={{ gap: c ? 10 : 12 }}>
                  {i > 0 && <View style={{ height: 1, backgroundColor: theme.colors.border }} />}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foreground, fontSize: 12 }}>
                      {m.model}
                    </Text>
                    <View
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: theme.colors.surface2,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          width: `${Math.max(4, (m.requests / max) * 100)}%`,
                          height: "100%",
                          backgroundColor: theme.colors.accent,
                        }}
                      />
                    </View>
                    <Text
                      style={{
                        color: theme.colors.foreground,
                        fontSize: 11,
                        fontWeight: "600",
                        fontVariant: ["tabular-nums"],
                        minWidth: 36,
                        textAlign: "right",
                      }}
                    >
                      {compact(m.requests)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>
        </View>
      )}

      {cwd && s?.workspaceSessions !== undefined && s.workspaceSessions.length > 0 && (
        <SessionSection
          label="This workspace"
          sessions={s.workspaceSessions}
          agents={agents}
          theme={theme}
          compactLayout={c}
          match
          onOpenAgent={openAgent}
        />
      )}

      {otherSessions.length > 0 && (
        <SessionSection
          label={cwd ? "Other sessions" : "Sessions"}
          sessions={otherSessions}
          agents={[]}
          theme={theme}
          compactLayout={c}
          match={false}
        />
      )}

      {extras?.inspect?.available === true &&
        extras.inspect.requests !== undefined &&
        extras.inspect.requests.length > 0 && (
          <View style={styles.section}>
            <Micro theme={theme}>Recent requests</Micro>
            <Card theme={theme} compactLayout={c}>
              {extras.inspect.requests.map((entry, i) => {
                const pairs = Object.entries(entry);
                const head = pairs.slice(0, 3);
                const rest = pairs.slice(3);
                return (
                  <View key={i} style={{ gap: c ? 10 : 12 }}>
                    {i > 0 && <View style={{ height: 1, backgroundColor: theme.colors.border }} />}
                    <View style={{ gap: 2 }}>
                      <Text
                        numberOfLines={1}
                        style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}
                      >
                        {head.map(([k, v]) => `${k} ${String(v)}`).join("  ·  ")}
                      </Text>
                      {rest.length > 0 && (
                        <Text numberOfLines={2} style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>
                          {rest.map(([k, v]) => `${k} ${String(v)}`).join("  ·  ")}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        )}
    </ScrollView>
  );
}

// Session popover: opens from the composer pill, scoped to that agent's session.
export function SessionPopover(props: PluginButtonContentProps) {
  // Registered per agent, so the host passes the agent context branch.
  const isAgent = props.context === "agent";
  const theme = props.theme;
  const layout = props.layout;
  const agentId = isAgent ? props.agentId : undefined;
  const agent = useAgent(agentId ?? "", (a) => ({
    cwd: a.cwd,
    title: a.title,
    updatedAt: a.updatedAt,
  })) ?? undefined;
  const getStats = useRpc(headroomStats);
  const query = useQuery({
    queryKey: ["headroom-session", agentId ?? "", agent?.cwd ?? ""],
    queryFn: () => getStats({ cwd: agent?.cwd }),
    enabled: agent?.cwd !== undefined,
    refetchInterval: 3000,
  });
  const raw: HeadroomStats | undefined = query.data;
  const lastLive = useRef<HeadroomStats | undefined>(undefined);
  if (raw?.live) lastLive.current = raw;
  const stale = raw !== undefined && !raw.live && lastLive.current !== undefined;
  // Same fallback as the panel: keep the last good snapshot while stale.
  const s = stale ? lastLive.current : raw;
  const c = layout.compact;
  const close = "close" in props ? props.close : undefined;

  // Same proximity join as the panel: the agent's last turn and its session's
  // last proxy request land within minutes of each other.
  const candidates = s?.workspaceSessions ?? [];
  const session =
    agent === undefined
      ? candidates[0]
      : candidates.reduce<{ row: HeadroomSession; delta: number } | undefined>((best, row) => {
          if (row.lastActivityAt === undefined) return best;
          const delta = Math.abs(new Date(row.lastActivityAt).getTime() - new Date(agent.updatedAt).getTime());
          return delta < 20 * 60 * 1000 && (best === undefined || delta < best.delta)
            ? { row, delta }
            : best;
        }, undefined)?.row ?? candidates[0];

  const styles = useMemo(
    () => ({
      screen: {
        width: 280,
        padding: c ? 12 : 16,
        gap: c ? 10 : 14,
        backgroundColor: theme.colors.surface0,
      },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "700" as const, flexShrink: 1 },
      model: { color: theme.colors.foregroundMuted, fontSize: 11 },
      dot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: stale
          ? theme.colors.statusWarning
          : s?.live
            ? theme.colors.statusSuccess
            : theme.colors.border,
      },
      number: { color: theme.colors.foreground, fontSize: 30, fontWeight: "800" as const, letterSpacing: -0.5 },
      label: { color: theme.colors.foregroundMuted, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase" },
      row: { flexDirection: "row" as const, justifyContent: "space-between" as const },
      key: { color: theme.colors.foregroundMuted, fontSize: 12 },
      value: { color: theme.colors.foreground, fontSize: 12, fontWeight: "600" as const },
      box: {
        gap: 8,
        padding: c ? 10 : 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
      },
      muted: { color: theme.colors.foregroundMuted, fontSize: 11 },
    }),
    [theme, c, s?.live, agent],
  );

  if (agent === undefined || query.isPending) {
    return (
      <View style={styles.screen}>
        <Text style={styles.muted}>Loading session…</Text>
      </View>
    );
  }

  if (raw !== undefined && !raw.live && lastLive.current === undefined) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.dot} />
          <Text style={styles.title}>Proxy not reachable</Text>
        </View>
        <Text style={styles.muted}>{s.error}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={close}
          style={{ paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface1 }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12, textAlign: "center" }}>Close</Text>
        </Pressable>
      </View>
    );
  }

  const savedPct =
    session?.tokensSaved !== undefined && session.requests !== undefined
      ? pct(session.savingsPct)
      : undefined;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.dot} />
        <Text style={styles.title} numberOfLines={1}>
          {agent.title ?? session?.id.slice(0, 8)}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close}>
          <Text style={styles.model}>close</Text>
        </Pressable>
      </View>

      {session === undefined ? (
        <Text style={styles.muted}>No Headroom activity recorded for this session yet.</Text>
      ) : (
        <>
          <View style={{ gap: 2 }}>
            <Micro theme={theme}>Session savings</Micro>
            <Text style={styles.number}>{compact(session.tokensSaved)}</Text>
            <Text style={styles.muted}>
              {session.id.slice(0, 8)} · {savedPct ?? "—"} lighter · {ago(session.lastActivityAt)}
            </Text>
          </View>

          <View style={styles.box}>
            <View style={styles.row}>
              <Text style={styles.key}>Requests</Text>
              <Text style={styles.value}>{compact(session.requests)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Cost saved</Text>
              <Text style={styles.value}>{usd(session.costSaved)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Full-price input</Text>
              <Text style={styles.value}>
                {session.inputCost !== undefined && session.inputCost > 0 ? usd(session.inputCost) : "—"}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.key}>Input tokens</Text>
              <Text style={styles.value}>{compact(session.inputTokens)}</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// Workspace panel: scoped to the workspace the + menu opened it from.
export function SavingsPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (w) => w.directory);
  return (
    <SavingsSurface
      theme={theme}
      layout={layout}
      cwd={directory ?? undefined}
      workspaceId={workspaceId}
      openAgent={navigation?.openAgent}
    />
  );
}

// Sidebar screen: no workspace context; shows every session the proxy has seen.
export function SavingsScreen({ theme, layout }: PluginScreenProps) {
  return <SavingsSurface theme={theme} layout={layout} />;
}
