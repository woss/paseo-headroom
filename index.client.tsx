import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { SavingsPanel, SavingsScreen } from "./client/panel";

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
  return () => {};
}
