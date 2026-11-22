import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchAgents, nearestSession } from "../shared/headroom";
import type { HeadroomSession, SessionAgent } from "../shared/headroom";
import { getHeadroomExtras, ledgerSessions, pickWindow, sessionStoreIds } from "../server/headroom";

const T0 = "2026-11-22T00:00:00.000Z";
const MIN = 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.parse(T0) + offsetMs).toISOString();
const session = (id: string, lastActivityAt: string): HeadroomSession => ({ id, lastActivityAt });
const agent = (id: string, lastActivityAt: string): SessionAgent => ({ id, title: id, lastActivityAt });

describe("matchAgents", () => {
  it("matches the nearest agent within the window", () => {
    const matches = matchAgents(
      [session("near", iso(0)), session("far", iso(-25 * MIN))],
      [agent("a", iso(MIN)), agent("b", iso(-30 * MIN))],
    );
    expect(matches.get("near")?.id).toBe("a");
    expect(matches.get("far")?.id).toBe("b");
  });

  it("leaves sessions without an agent in the window unmatched", () => {
    const matches = matchAgents(
      [session("s", iso(0)), session("idle", iso(-3 * 60 * MIN))],
      [agent("a", iso(MIN))],
    );
    expect(matches.has("s")).toBe(true);
    expect(matches.has("idle")).toBe(false);
  });

  it("never binds one agent to two sessions", () => {
    const matches = matchAgents(
      [session("s1", iso(0)), session("s2", iso(MIN))],
      [agent("a", iso(30 * 1000))],
    );
    expect([...matches.values()].filter((a) => a.id === "a")).toHaveLength(1);
  });
});

describe("nearestSession", () => {
  it("returns the closest session and undefined when nothing is in the window", () => {
    const rows = [session("s1", iso(0)), session("s2", iso(2 * MIN))];
    expect(nearestSession(rows, agent("a", iso(90 * 1000)))?.id).toBe("s2");
    expect(nearestSession(rows, agent("a", iso(60 * MIN)))).toBeUndefined();
  });
});

describe("pickWindow", () => {
  it("maps the CLI window shape and rejects malformed data", () => {
    expect(pickWindow({ tokens_saved: 10, calls: 2, savings_percent: 3 })).toEqual({
      tokensSaved: 10,
      calls: 2,
      savingsPct: 3,
    });
    expect(pickWindow("nope")).toBeUndefined();
  });
});

describe("ledgerSessions", () => {
  const perProject = {
    a: { tokens_saved: 5, last_activity_at: iso(0) },
    b: { tokens_saved: 9, last_activity_at: iso(-1000) },
  };
  it("sorts newest first", () => {
    expect(ledgerSessions(perProject).map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("filters by session store ids", () => {
    expect(ledgerSessions(perProject, new Set(["b"])).map((r) => r.id)).toEqual(["b"]);
  });
});

describe("sessionStoreIds", () => {
  it("extracts omp session UUIDs from the workspace session store", () => {
    const base = mkdtempSync(join(tmpdir(), "headroom-sessions-"));
    const ws = join(base, "-tmp-ws");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "2026-11-22T00-00-00Z_11111111-2222-3333-4444-555555555555.jsonl"), "");
    writeFileSync(join(ws, "not-a-session.txt"), "");
    const ids = sessionStoreIds("/tmp/ws", base);
    expect(ids.has("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(ids.size).toBe(1);
  });
});

describe("getHeadroomExtras caches and clamping", () => {
  const bin = join(tmpdir(), `headroom-stub-${process.pid}.sh`);
  const log = `${bin}.log`;
  let counter = 0;
  let originalBin: string | undefined;

  function freshStub(sleepSeconds = "0.2") {
    counter += 1;
    const myLog = `${bin}-${counter}.log`;
    writeFileSync(
      bin,
      `#!/bin/sh\nsleep ${sleepSeconds}\necho "$@" >> ${JSON.stringify(myLog)}\nprintf '{"lifetime":{"tokens_saved":1,"calls":1},"windows":{}}'\n`,
    );
    chmodSync(bin, 0o755);
    return myLog;
  }

  beforeAll(() => {
    originalBin = process.env.HEADROOM_BIN;
  });

  afterAll(() => {
    if (originalBin === undefined) delete process.env.HEADROOM_BIN;
    else process.env.HEADROOM_BIN = originalBin;
  });

  it("coalesces concurrent calls into one CLI run per report", async () => {
    const myLog = freshStub();
    process.env.HEADROOM_BIN = bin;
    const [r1, r2] = await Promise.all([
      getHeadroomExtras({ inspectLimit: 8 }),
      getHeadroomExtras({ inspectLimit: 8 }),
    ]);
    expect(r1.ledger.lifetime?.tokensSaved).toBe(1);
    expect(r2.ledger.lifetime?.tokensSaved).toBe(1);
    const lines = readFileSync(myLog, "utf8").trim().split("\n");
    expect(lines.filter((l) => l.includes("savings")).length).toBe(1);
    expect(lines.filter((l) => l.includes("inspect")).length).toBe(1);
  });

  it("clamps inspectLimit into 1..50 at the call site", async () => {
    const myLog = freshStub("0");
    process.env.HEADROOM_BIN = bin;
    await getHeadroomExtras({ inspectLimit: 500 });
    await getHeadroomExtras({ inspectLimit: 0 });
    const lines = readFileSync(myLog, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("--last 50");
    expect(lines[1]).toContain("--last 1");
  });
});
