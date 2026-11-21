Headroom savings for the omp + Headroom setup: a workspace panel that polls the local Headroom proxy's `/stats` endpoint every five seconds and shows tokens removed, average and best compression, request counts, and cost with and without Headroom.

## How it works

The panel talks to the Headroom optimization proxy that must already be running on the daemon host (start it with `headroom proxy`; the default port is 8787, and the `HEADROOM_PORT` environment variable is honored by the plugin's daemon process). The daemon side fetches `http://127.0.0.1:<port>/stats` and reshapes the summary for display; the app side polls it via a plugin RPC. Nothing is sent anywhere else, and no Headroom or proxy credentials are read.

## Limits

Shows proxy-wide totals since proxy start, not per-session numbers like the terminal HUD. Requires the proxy on the same machine as the Paseo daemon.
