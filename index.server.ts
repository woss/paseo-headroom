import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getHeadroomExtras, getHeadroomStats } from "./server/headroom";
import { headroomExtras, headroomStats } from "./shared/headroom";

export default function contribute(server: PluginServerContext) {
  server.handle(headroomStats, getHeadroomStats);
  server.handle(headroomExtras, getHeadroomExtras);
  return () => {};
}
