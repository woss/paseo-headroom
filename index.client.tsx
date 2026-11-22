import type { PluginButtonRegistration, PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { compact, pct, SavingsPanel, SavingsScreen, SessionPopover } from "./client/panel";
import { headroomStats } from "./shared/headroom";

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
    locations: ["workspace"],
    Component: SavingsPanel,
  });
  client.addScreen({ id: "savings", title: "Headroom savings", Component: SavingsScreen });
  client.addSidebarHeaderItem({ id: "savings", title: "Headroom savings", Component: SavingsItem });

  // Per-agent composer pill: live savings of the agent's most recent session,
  // derived from its cwd's omp session store. Press opens the savings panel.
  const pills = new Map<string, PluginButtonRegistration>();
  const labels = new Map<string, string>();
  const cwds = new Map<string, string>();
  const lifetime = new AbortController();

  function registerPill(agent: { id: string; workspaceId?: string | null; cwd?: string | null }) {
    if (lifetime.signal.aborted || !agent.workspaceId || !agent.cwd) return;
    cwds.set(agent.id, agent.cwd);
    const label = labels.get(agent.id) ?? "HR …";
    pills.get(agent.id)?.remove();
    pills.set(
      agent.id,
      client.addComposerPill({
        id: "savings",
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        button: {
          title: "Headroom savings",
          icon: "Gauge",
          label,
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
            cwds.delete(update.agentId);
          }
        },
      });
      return undefined;
    })
    .catch(() => {});

  const poll = setInterval(() => {
    for (const [agentId, cwd] of cwds) {
      const pill = pills.get(agentId);
      if (!pill) continue;
      void client
        .rpc(headroomStats, { cwd })
        .then((s) => {
          if (!s.live || !s.workspaceSessions?.length) {
            pill.update({ visible: false });
            return;
          }
          const current = s.workspaceSessions[0];
          const label = `saved ${compact(current.tokensSaved)} · ${pct(current.savingsPct)}`;
          labels.set(agentId, label);
          pill.update({ visible: true, label });
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
