Headroom Savings is a Paseo plugin that shows the savings of a local Headroom optimization proxy inside Paseo: tokens removed from prompts, compression rates, request counts, and estimated cost, in a workspace panel, a sidebar screen, and a per-agent composer pill whose popover shows the current session's detail.

## How it works

The daemon process fetches `http://127.0.0.1:<port>/stats` from the Headroom proxy running on the same host (port from the `HEADROOM_PORT` environment variable, default 8787, the same variable the `headroom` CLI uses) and reshapes the summary for display; the app polls it via a plugin RPC. Extras views run the `headroom` CLI for the savings ledger and the per-request inspector. Nothing is sent anywhere else, no credentials are read, and the only plugin-side storage is short-lived in-memory caches (ledger 60 seconds, inspector 30 seconds).

## Setup

- Headroom optimization proxy running on the daemon host (`headroom proxy`; default port 8787).
- The `headroom` CLI on the daemon host for the today/lifetime, model-mix, and per-request views; the rest work without it.
- Per-request diffs require the proxy to run with `--log-messages`.
- Paseo 0.16.2 or later.

## Capabilities and limits

- The workspace panel scopes its session list to the workspace's omp session store, matched to agents by last-activity proximity (20-minute window); unmatched sessions stay unlinked and unattributable pills hide.
- Session figures are per omp session since the proxy started; there is no hard binding between Paseo agents and proxy sessions.
- Dollar figures are the proxy's own estimates from model pricing, not metered billing.
- Polling: panel 5 seconds, popover 3 seconds while open, extras 15 seconds; agents sharing a directory share one stats request.
- Transient proxy failures keep the last good numbers on screen with an amber dot; the error screen appears only before any data was received.

## Alternatives considered

- Proxy-wide panel only: simpler and matched the first release, but per-session views and the pill are what make the numbers actionable per conversation; the proxy-wide hero remains.
- A hard binding between Paseo agents and proxy sessions: needs the omp provider to expose its omp session id, which is not available today; the proximity heuristic is used instead and unattributable sessions stay unlinked.
- A dockable right-side pane for the session detail: the plugin API provides anchored popovers for per-agent UI; a dockable pane would require host support.
