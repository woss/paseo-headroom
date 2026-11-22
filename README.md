# Headroom Savings

A [Paseo](https://paseo.sh) plugin that shows your [Headroom](https://github.com/headroom-llm) proxy savings live inside Paseo — a workspace panel, a sidebar screen, and a per-agent composer pill, so the numbers follow the session you are in.

## What it shows

- **Tokens removed** — total tokens stripped from requests, against total tokens sent, as a percentage.
- **Compression** — how many requests were compressed, average compression, and the best single result.
- **Requests** — total API requests through the proxy and how many were prefix-frozen or passed through uncompressed.
- **Cost** — estimated spend with and without Headroom, and what was saved.
- **Sessions** — per-session savings, linked to the matching Paseo agent where one can be identified.
- **Model mix** — which models received the compressed traffic.
- **Savings layers** — how much came from compression versus cache versus other layers.
- **Today / lifetime** — dollar savings over the current day and the whole ledger.

## Where to see it

- **Composer pill** — next to Tasks and Memory, shows `saved X · Y%` for that agent's session. Clicking it opens an anchored popover with the session detail (requests, cost saved, full-price input, input tokens).
- **Panel** — the green **+** menu in a workspace opens the full panel, scoped to that workspace's sessions ("This workspace") plus everything else ("Other sessions").
- **Sidebar** — the piggy-bank row opens a screen with all sessions.

## Requirements

- Paseo 0.16.2 or newer.
- The Headroom optimization proxy running on the same machine as your Paseo daemon (`headroom proxy`, default port 8787).
- The `headroom` CLI on the daemon host for the extras views (today/lifetime, per-request inspector). Without it the panel shows a "ledger unavailable" note instead of those cards; everything else keeps working.
- Per-request diffs additionally require the proxy to be started with `headroom proxy --log-messages`; until then that section stays hidden and the panel shows a hint.

## How it works

The plugin's daemon process fetches `http://127.0.0.1:<port>/stats` from your local Headroom proxy, where the port comes from the `HEADROOM_PORT` environment variable (the same variable the `headroom` CLI uses) with a default of 8787. Extras views shell out to the `headroom` CLI (`HEADROOM_BIN` overrides binary discovery). The app polls over a plugin RPC and renders the results. No data leaves your machine, and no proxy or provider credentials are read.

## How session scoping works

The proxy records savings per omp session id. The plugin maps a workspace's directory to its omp session store and a per-agent view to that agent's own store, then matches agents to sessions by last-activity proximity (a session's last proxy request and its agent's last turn land within minutes of each other; the match window is 20 minutes). This is a heuristic: agents that finish in the same minute can swap titles, and agents with no attributable activity hide instead of guessing. Proxy-wide totals always remain visible.

## Terms

- **Headroom proxy** — the local optimization layer that compresses prompts before they reach a provider.
- **Terminal HUD** — the savings box the omp CLI draws in a terminal; this plugin shows the same data in Paseo.
- **Prefix-frozen** — a request whose prefix was already cached, so compression would bust the cache and Headroom skipped it.
- **omp session** — one conversation of the omp coding agent, identified by UUID in `~/.omp/agent/sessions/`.

## Costs are estimates

Dollar figures come from the proxy's own accounting (model pricing × token counts) and are reported, not metered from a bill. Treat them as comparable between sessions, not as invoiced amounts.

## Limits

- Panel and popover numbers are proxy-wide or per-session since the proxy started; there is no per-Paseo-agent binding beyond the proximity heuristic above.
- Extras cards lag at most one poll (ledger refreshes at most once a minute, the inspector once per 30 seconds; both caches are in-memory only, nothing is persisted by the plugin).
- Transient proxy failures keep the last good numbers on screen with an amber status dot.
- The panel polls every 5 seconds, the popover every 3 while open, extras every 15, and each distinct agent cwd gets one shared stats request per tick.

## Alternatives considered

- **Proxy-wide panel only** (the first version): simpler, but the pill and per-session views are what make the numbers meaningful per conversation. Kept the proxy-wide hero and added sessions on top.
- **Hard agent↔session binding**: needs the omp provider to expose its session id; not available today, which is why the panel uses the proximity heuristic and hides unattributable pills.
- **Dockable right-side pane for the popover**: the plugin API offers anchored popovers for per-agent UI; a dockable pane would require host support.

## Development

```bash
npm install
npm run typecheck
npm test
paseo plugin install /absolute/path/to/paseo-headroom
```

## License

MIT
