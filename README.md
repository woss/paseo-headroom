# Headroom Savings

A [Paseo](https://paseo.sh) plugin that shows your [Headroom](https://github.com/headroom-llm) proxy savings live in a workspace panel — the same numbers the terminal HUD and `headroom dashboard` show, without leaving Paseo.

## What it shows

- **Tokens removed** — total tokens stripped from requests, against total tokens sent, as a percentage.
- **Compression** — how many requests were compressed, average compression, and the best single result.
- **Requests** — total API requests through the proxy and how many were prefix-frozen.
- **Cost** — estimated spend with and without Headroom, and what was saved.

The panel polls every five seconds. A status dot shows whether the proxy is reachable; when it is not, the panel says how to start it.

## Requirements

- The Headroom optimization proxy running on the same machine as your Paseo daemon (`headroom proxy`, default port 8787).
- Paseo 0.16.2 or newer.

## How it works

The plugin's daemon process fetches `http://127.0.0.1:<port>/stats` from your local Headroom proxy, where the port comes from the `HEADROOM_PORT` environment variable (same variable the `headroom` CLI uses) with a default of 8787. It reshapes the proxy's summary into a small payload; the app polls it with a plugin RPC and renders the panel. No data leaves your machine, and no proxy or provider credentials are read.

## Scope and limits

- Numbers are proxy-wide totals since the proxy started, not per-agent-session like the Headroom terminal HUD.
- The panel reads only the proxy's `/stats` endpoint; it never writes to the proxy.

## Development

```bash
npm install
npm run typecheck
paseo plugin install /absolute/path/to/paseo-headroom
```

## License

MIT
