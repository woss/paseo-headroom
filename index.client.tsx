import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SavingsPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "savings",
    title: "Headroom savings",
    icon: "PiggyBank",
    context: "workspace",
    Component: SavingsPanel,
  });
  return () => {};
}
