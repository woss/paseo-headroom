import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getHeadroomStats } from "./server/headroom";
import { headroomStats } from "./shared/headroom";

export default function contribute(server: PluginServerContext) {
  server.handle(headroomStats, getHeadroomStats);
  return () => {};
}
