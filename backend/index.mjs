// src/backend/index.ts
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// src/handoff.ts
var HANDOFFS_METHOD = "handoffs";
var MAX_DESCRIBED_THREADS = 64;

// src/backend/index.ts
var LIST_EVERY_MS = 6e4;
var LIST_LIMIT = 100;
var REQUEST_TIMEOUT_MS = 5e3;
var MAX_HANDOFFS_BYTES = 8 * 1024 * 1024;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value, max) {
  return typeof value === "string" && value.trim() && value.length <= max ? value : void 0;
}
function parseHandoffsFile(value) {
  if (!isRecord(value) || value.formatVersion !== 1 || !Array.isArray(value.handoffs)) return [];
  const links = [];
  for (const entry of value.handoffs) {
    if (!isRecord(entry) || !isRecord(entry.handoff)) continue;
    const target = text(entry.targetThreadId, 256);
    const source = text(entry.handoff.sourceThreadId, 256);
    if (!target || !source || target === source) continue;
    const at = entry.handoff.createdAtMs;
    links.push({ target, source, at: typeof at === "number" && Number.isFinite(at) ? at : 0 });
  }
  return links;
}
var HandoffFile = class {
  constructor(file, log) {
    this.file = file;
    this.log = log;
  }
  file;
  log;
  #stamp = "";
  #links = [];
  #reported = false;
  async read() {
    let stamp;
    try {
      const info = await stat(this.file);
      if (info.size > MAX_HANDOFFS_BYTES) throw new Error("handoff file is too large");
      stamp = `${info.size}:${info.mtimeMs}`;
    } catch (error) {
      if (error.code === "ENOENT") {
        this.#stamp = "";
        this.#links = [];
        return this.#links;
      }
      this.#report(error);
      return this.#links;
    }
    if (stamp === this.#stamp) return this.#links;
    try {
      this.#links = parseHandoffsFile(JSON.parse(await readFile(this.file, "utf8")));
      this.#stamp = stamp;
      this.#reported = false;
    } catch (error) {
      this.#report(error);
    }
    return this.#links;
  }
  #report(error) {
    if (this.#reported) return;
    this.#reported = true;
    this.log(
      `could not read context handoffs: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};
function listStatus(value) {
  return value === "running" ? "running" : value === "waiting" ? "waiting" : "idle";
}
function describeListedThread(entry) {
  if (!isRecord(entry)) return null;
  const threadId = text(entry.threadId, 256);
  if (!threadId || entry.hostId !== void 0) return null;
  const info = { status: listStatus(entry.status) };
  const title = text(entry.title, 4096);
  const agent = text(entry.harnessId, 128);
  if (title) info.title = title;
  if (agent) info.agent = agent;
  const updatedAt = Date.parse(String(entry.updatedAt ?? entry.recencyAt ?? ""));
  if (Number.isFinite(updatedAt)) info.updatedAt = updatedAt;
  return [threadId, info];
}
function isLoopback(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}
var ThreadDirectory = class {
  constructor(credentialsFile, log, fetchImpl = fetch, now = Date.now) {
    this.credentialsFile = credentialsFile;
    this.log = log;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }
  credentialsFile;
  log;
  fetchImpl;
  now;
  #listed = /* @__PURE__ */ new Map();
  #listedAt = Number.NEGATIVE_INFINITY;
  #listing;
  #reported = false;
  /** Asks codexhost for the list ahead of the first description, when it is too old. */
  warm() {
    if (this.now() - this.#listedAt < LIST_EVERY_MS) return;
    this.#listing ??= this.#list().finally(() => {
      this.#listing = void 0;
    });
  }
  /** What is known of `threadIds`; asks codexhost again when its last answer is too old. */
  async describe(threadIds) {
    if (threadIds.length === 0) return {};
    if (this.now() - this.#listedAt >= LIST_EVERY_MS) {
      this.#listing ??= this.#list().finally(() => {
        this.#listing = void 0;
      });
      await this.#listing;
    }
    const result = {};
    for (const threadId of threadIds) {
      const info = this.#listed.get(threadId);
      if (info) result[threadId] = info;
    }
    return result;
  }
  async #list() {
    this.#listedAt = this.now();
    try {
      const raw = JSON.parse(await readFile(this.credentialsFile, "utf8"));
      if (!isRecord(raw) || typeof raw.endpoint !== "string" || typeof raw.token !== "string")
        throw new Error("codexhost's local credential is unreadable");
      if (!isLoopback(raw.endpoint)) throw new Error("codexhost's local API is not on loopback");
      const response = await this.fetchImpl(`${raw.endpoint.replace(/\/+$/u, "")}/v1/thread/list`, {
        method: "POST",
        headers: { authorization: `Bearer ${raw.token}`, "content-type": "application/json" },
        body: JSON.stringify({ limit: LIST_LIMIT, sort: "recency-desc" }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`codexhost answered ${String(response.status)}`);
      const body = await response.json();
      const listed = /* @__PURE__ */ new Map();
      for (const entry of isRecord(body) && Array.isArray(body.threads) ? body.threads : []) {
        const described = describeListedThread(entry);
        if (described) listed.set(described[0], described[1]);
      }
      this.#listed = listed;
      this.#reported = false;
    } catch (error) {
      if (!this.#reported) {
        this.#reported = true;
        this.log(
          `could not list Threads: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
};
function wantedThreads(params, links) {
  if (!isRecord(params) || !Array.isArray(params.describe)) return [];
  const members = /* @__PURE__ */ new Set();
  for (const { target, source } of links) members.add(target).add(source);
  const wanted = [];
  for (const id of params.describe) {
    if (typeof id !== "string" || !members.has(id) || wanted.includes(id)) continue;
    wanted.push(id);
    if (wanted.length >= MAX_DESCRIBED_THREADS) break;
  }
  return wanted;
}
function activate(ctx) {
  const dataRoot = path.resolve(ctx.dataDir, "..", "..");
  const log = (message) => {
    console.warn(`[sidebar-thread-tree] ${message}`);
  };
  const handoffs = new HandoffFile(
    path.join(dataRoot, "mapping-store", "handoffs", "handoffs.json"),
    log
  );
  const directory = new ThreadDirectory(path.join(dataRoot, "cli-credentials.json"), log);
  void handoffs.read().then((links) => {
    if (links.length > 0) directory.warm();
  });
  ctx.handle(HANDOFFS_METHOD, async (params) => {
    const links = await handoffs.read();
    const threads = await directory.describe(wantedThreads(params, links));
    return { links, threads };
  });
}
export {
  HandoffFile,
  ThreadDirectory,
  activate,
  describeListedThread,
  parseHandoffsFile,
  wantedThreads
};
