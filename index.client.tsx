import type { PluginButtonRegistration, PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { compact, pct, SavingsPanel, SavingsScreen, SessionPopover } from "./client/panel";
import { headroomStats, nearestSession } from "./shared/headroom";

function SavingsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Gauge"
      active={currentScreen?.screenId === "savings"}
      onPress={() => openScreen({ screenId: "savings" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "savings",
    title: "Headroom savings",
    icon: "Gauge",
    locations: ["workspace", "explorer"],
    Component: SavingsPanel,
  });
  client.addScreen({ id: "savings", title: "Headroom savings", Component: SavingsScreen });
  client.addSidebarHeaderItem({ id: "savings", title: "Headroom savings", Component: SavingsItem });

  // Per-agent composer pill: live savings of the agent's current session.
  // Agents sharing a cwd share one stats RPC per tick (coalesced below); the
  // session is matched per agent by last-activity proximity. Press opens the
  // session popover.
  const pills = new Map<string, PluginButtonRegistration>();
  const labels = new Map<string, string>();
  const agents = new Map<string, { cwd: string; title: string | null; updatedAt: string }>();
  const missCount = new Map<string, number>();
  const lifetime = new AbortController();

  function registerPill(agent: {
    id: string;
    workspaceId?: string | null;
    cwd?: string | null;
    title?: string | null;
    updatedAt?: string | null;
  }) {
    if (lifetime.signal.aborted || !agent.workspaceId || !agent.cwd || !agent.updatedAt) return;
    agents.set(agent.id, { cwd: agent.cwd, title: agent.title ?? null, updatedAt: agent.updatedAt });
    // Register once; the poll owns visibility and label from here on, so agent
    // upserts cannot flash the pill.
    if (pills.has(agent.id)) return;
    pills.set(
      agent.id,
      client.addComposerPill({
        id: "savings",
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        button: {
          title: "Headroom savings",
          icon: "Gauge",
          label: labels.get(agent.id) ?? "HR …",
          behavior: { kind: "popover", Content: SessionPopover },
        },
      }),
    );
  }

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          for (const { agent } of entries) registerPill(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") registerPill(update.agent);
          else {
            pills.get(update.agentId)?.remove();
            pills.delete(update.agentId);
            labels.delete(update.agentId);
            agents.delete(update.agentId);
            missCount.delete(update.agentId);
          }
        },
      });
      return undefined;
    })
    .catch(() => {});

  // One stats RPC per distinct cwd per tick, shared by all agents on it. Two
  // consecutive misses hide the pill (an agent whose traffic does not route
  // through Headroom never matches and stays hidden).
  const poll = setInterval(() => {
    const byCwd = new Map<string, string[]>();
    for (const [agentId, info] of agents) {
      if (!pills.has(agentId)) continue;
      const ids = byCwd.get(info.cwd) ?? [];
      ids.push(agentId);
      byCwd.set(info.cwd, ids);
    }
    for (const [cwd, agentIds] of byCwd) {
      void client
        .rpc(headroomStats, { cwd })
        .then((s) => {
          for (const agentId of agentIds) {
            const pill = pills.get(agentId);
            if (!pill) continue;
            const info = agents.get(agentId);
            if (info === undefined) continue;
            if (!s.live) continue;
            // Proximity join against the agent's own last turn: no match means
            // no attributable session, so the pill hides instead of guessing.
            const session = nearestSession(s.workspaceSessions ?? [], {
              id: agentId,
              title: info.title,
              lastActivityAt: info.updatedAt,
            });
            if (session === undefined) {
              const misses = (missCount.get(agentId) ?? 0) + 1;
              missCount.set(agentId, misses);
              if (misses >= 2) pill.update({ visible: false });
              continue;
            }
            missCount.delete(agentId);
            const label = `saved ${compact(session.tokensSaved)} · ${pct(session.savingsPct)}`;
            labels.set(agentId, label);
            pill.update({ visible: true, label });
          }
        })
        .catch(() => {});
    }
  }, 5000);

  return () => {
    lifetime.abort();
    clearInterval(poll);
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}
