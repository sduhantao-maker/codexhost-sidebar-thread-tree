/// <reference types="node" />
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostExtensionBackendContext } from "@codexhost/shared-contracts";
import {
  HandoffFile,
  ThreadDirectory,
  activate,
  describeListedThread,
  parseHandoffsFile,
  wantedThreads,
} from "../src/backend/index.js";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const created = await mkdtemp(path.join(tmpdir(), "cxh-tree-"));
  folders.push(created);
  return created;
}

const handoff = (target: string, source: string, createdAtMs: number) => ({
  targetThreadId: target,
  handoff: { sourceThreadId: source, createdAtMs, preview: "…" },
});

describe("codexhost's handoff file", () => {
  it("reads format 1 and skips what it does not understand", () => {
    expect(
      parseHandoffsFile({
        formatVersion: 1,
        handoffs: [
          handoff("b", "a", 5),
          { targetThreadId: "c" },
          handoff("d", "d", 1),
          { targetThreadId: "e", handoff: { sourceThreadId: "a", createdAtMs: "soon" } },
        ],
      }),
    ).toEqual([
      { target: "b", source: "a", at: 5 },
      { target: "e", source: "a", at: 0 },
    ]);
    expect(parseHandoffsFile({ formatVersion: 2, handoffs: [handoff("b", "a", 1)] })).toEqual([]);
  });

  it("reads the file again only when it changes, and keeps the last links on a bad read", async () => {
    const dir = await folder();
    const file = path.join(dir, "handoffs.json");
    const log = vi.fn();
    const reader = new HandoffFile(file, log);
    expect(await reader.read()).toEqual([]);
    await writeFile(file, JSON.stringify({ formatVersion: 1, handoffs: [handoff("b", "a", 5)] }));
    expect(await reader.read()).toEqual([{ target: "b", source: "a", at: 5 }]);
    await writeFile(file, "{ not json");
    await utimes(file, new Date(), new Date(Date.now() + 5_000));
    expect(await reader.read()).toEqual([{ target: "b", source: "a", at: 5 }]);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("describing Threads", () => {
  it("maps a local list entry and ignores another computer's", () => {
    expect(
      describeListedThread({
        threadId: "a",
        harnessId: "codex",
        status: "completed",
        title: "Plan",
        updatedAt: "2026-11-27T06:40:16.000Z",
      }),
    ).toEqual([
      "a",
      {
        status: "idle",
        title: "Plan",
        agent: "codex",
        updatedAt: Date.UTC(2026, 10, 27, 6, 40, 16),
      },
    ]);
    expect(describeListedThread({ threadId: "a", hostId: "peer" })).toBeNull();
  });

  it("describes only Threads of a known handoff", () => {
    const links = [{ target: "b", source: "a", at: 1 }];
    expect(wantedThreads({ describe: ["a", "zzz", "a", 3, "b"] }, links)).toEqual(["a", "b"]);
    expect(wantedThreads(null, links)).toEqual([]);
  });

  it("asks codexhost's local API at most once a minute, on loopback only", async () => {
    const dir = await folder();
    const credentials = path.join(dir, "cli-credentials.json");
    await writeFile(
      credentials,
      JSON.stringify({ endpoint: "http://127.0.0.1:43210", token: "t" }),
    );
    let now = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        threads: [{ threadId: "a", harnessId: "codex", status: "running", title: "Plan" }],
      }),
    );
    const directory = new ThreadDirectory(
      credentials,
      () => undefined,
      fetchImpl as typeof fetch,
      () => now,
    );
    expect(await directory.describe(["a", "b"])).toEqual({
      a: { status: "running", title: "Plan", agent: "codex" },
    });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:43210/v1/thread/list");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t");
    now = 30_000;
    await directory.describe(["a"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 61_000;
    await directory.describe(["a"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await writeFile(credentials, JSON.stringify({ endpoint: "http://example.com", token: "t" }));
    now = 200_000;
    expect(await directory.describe(["a"])).toEqual({
      a: { status: "running", title: "Plan", agent: "codex" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("the backend method", () => {
  it("answers with the handoffs next to the extension's data folder", async () => {
    const dir = await folder();
    const dataDir = path.join(dir, "host-extension-data", "sidebar-thread-tree");
    const handoffs = path.join(dir, "mapping-store", "handoffs");
    await import("node:fs/promises").then(({ mkdir }) =>
      Promise.all([mkdir(dataDir, { recursive: true }), mkdir(handoffs, { recursive: true })]),
    );
    await writeFile(
      path.join(handoffs, "handoffs.json"),
      JSON.stringify({ formatVersion: 1, handoffs: [handoff("b", "a", 9)] }),
    );
    const handlers = new Map<string, (params: unknown) => unknown>();
    const ctx: HostExtensionBackendContext = {
      extensionId: "sidebar-thread-tree",
      extensionDir: dir,
      dataDir,
      readSettings: async () => ({}),
      writeSettings: async (values) => values,
      handle: (method, handler) => handlers.set(method, handler),
    };
    activate(ctx);
    const answer = await handlers.get("handoffs")?.({ describe: [] });
    expect(answer).toEqual({ links: [{ target: "b", source: "a", at: 9 }], threads: {} });
  });
});
