/**
 * The extension's backend: tells Desktop and Web which Threads continue one another after a
 * context handoff, and describes those the sidebar does not show itself.
 *
 * - Handoffs come from the file codexhost keeps them in (`mapping-store/handoffs/handoffs.json`
 *   in its data folder, next to this extension's own data folder). It is read again only when it
 *   changes, so asking costs a `stat`.
 * - A Thread of a handoff that has no sidebar row (for example one beyond "Show more") is described
 *   from codexhost's local Thread list (`/v1/thread/list`, the API the `codexhost` command uses),
 *   asked for at most once a minute and only while such a Thread is wanted.
 *
 * Nothing is written, and nothing leaves this machine: the local API answers on loopback only.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { HostExtensionBackendContext } from "@codexhost/shared-contracts";
import {
  HANDOFFS_METHOD,
  MAX_DESCRIBED_THREADS,
  type HandoffLink,
  type HandoffThreadInfo,
  type HandoffThreadStatus,
} from "../handoff.js";

const LIST_EVERY_MS = 60_000;
const LIST_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_HANDOFFS_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= max ? value : undefined;
}

/** The links of codexhost's handoff file (format 1); malformed entries are skipped. */
export function parseHandoffsFile(value: unknown): HandoffLink[] {
  if (!isRecord(value) || value.formatVersion !== 1 || !Array.isArray(value.handoffs)) return [];
  const links: HandoffLink[] = [];
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

/** Reads the handoff file again only when its size or time changed. */
export class HandoffFile {
  #stamp = "";
  #links: HandoffLink[] = [];
  #reported = false;

  constructor(
    private readonly file: string,
    private readonly log: (message: string) => void,
  ) {}

  async read(): Promise<HandoffLink[]> {
    let stamp: string;
    try {
      const info = await stat(this.file);
      if (info.size > MAX_HANDOFFS_BYTES) throw new Error("handoff file is too large");
      stamp = `${info.size}:${info.mtimeMs}`;
    } catch (error) {
      // No handoff yet: codexhost writes the file with the first one.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
      // codexhost replaces the file in one step, so a failed read is not a half-written file;
      // the last links stand until it can be read.
      this.#report(error);
    }
    return this.#links;
  }

  #report(error: unknown): void {
    if (this.#reported) return;
    this.#reported = true;
    this.log(
      `could not read context handoffs: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function listStatus(value: unknown): HandoffThreadStatus {
  return value === "running" ? "running" : value === "waiting" ? "waiting" : "idle";
}

/** One entry of `/v1/thread/list`, as this extension shows it. */
export function describeListedThread(entry: unknown): [string, HandoffThreadInfo] | null {
  if (!isRecord(entry)) return null;
  const threadId = text(entry.threadId, 256);
  if (!threadId || entry.hostId !== undefined) return null;
  const info: HandoffThreadInfo = { status: listStatus(entry.status) };
  const title = text(entry.title, 4096);
  const agent = text(entry.harnessId, 128);
  if (title) info.title = title;
  if (agent) info.agent = agent;
  const updatedAt = Date.parse(String(entry.updatedAt ?? entry.recencyAt ?? ""));
  if (Number.isFinite(updatedAt)) info.updatedAt = updatedAt;
  return [threadId, info];
}

function isLoopback(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

/** Recently active Threads, from codexhost's local API. */
export class ThreadDirectory {
  #listed = new Map<string, HandoffThreadInfo>();
  #listedAt = Number.NEGATIVE_INFINITY;
  #listing: Promise<void> | undefined;
  #reported = false;

  constructor(
    private readonly credentialsFile: string,
    private readonly log: (message: string) => void,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Asks codexhost for the list ahead of the first description, when it is too old. */
  warm(): void {
    if (this.now() - this.#listedAt < LIST_EVERY_MS) return;
    this.#listing ??= this.#list().finally(() => {
      this.#listing = undefined;
    });
  }

  /** What is known of `threadIds`; asks codexhost again when its last answer is too old. */
  async describe(threadIds: readonly string[]): Promise<Record<string, HandoffThreadInfo>> {
    if (threadIds.length === 0) return {};
    if (this.now() - this.#listedAt >= LIST_EVERY_MS) {
      this.#listing ??= this.#list().finally(() => {
        this.#listing = undefined;
      });
      await this.#listing;
    }
    const result: Record<string, HandoffThreadInfo> = {};
    for (const threadId of threadIds) {
      const info = this.#listed.get(threadId);
      if (info) result[threadId] = info;
    }
    return result;
  }

  async #list(): Promise<void> {
    // Asked again a minute later even when this fails.
    this.#listedAt = this.now();
    try {
      const raw: unknown = JSON.parse(await readFile(this.credentialsFile, "utf8"));
      if (!isRecord(raw) || typeof raw.endpoint !== "string" || typeof raw.token !== "string")
        throw new Error("codexhost's local credential is unreadable");
      if (!isLoopback(raw.endpoint)) throw new Error("codexhost's local API is not on loopback");
      const response = await this.fetchImpl(`${raw.endpoint.replace(/\/+$/u, "")}/v1/thread/list`, {
        method: "POST",
        headers: { authorization: `Bearer ${raw.token}`, "content-type": "application/json" },
        body: JSON.stringify({ limit: LIST_LIMIT, sort: "recency-desc" }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`codexhost answered ${String(response.status)}`);
      const body: unknown = await response.json();
      const listed = new Map<string, HandoffThreadInfo>();
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
          `could not list Threads: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

/** The Threads a caller wants described: members of a known handoff only. */
export function wantedThreads(params: unknown, links: readonly HandoffLink[]): string[] {
  if (!isRecord(params) || !Array.isArray(params.describe)) return [];
  const members = new Set<string>();
  for (const { target, source } of links) members.add(target).add(source);
  const wanted: string[] = [];
  for (const id of params.describe) {
    if (typeof id !== "string" || !members.has(id) || wanted.includes(id)) continue;
    wanted.push(id);
    if (wanted.length >= MAX_DESCRIBED_THREADS) break;
  }
  return wanted;
}

export function activate(ctx: HostExtensionBackendContext): void {
  // codexhost keeps every extension's data under <data folder>/host-extension-data/<id>.
  const dataRoot = path.resolve(ctx.dataDir, "..", "..");
  const log = (message: string): void => {
    console.warn(`[sidebar-thread-tree] ${message}`);
  };
  const handoffs = new HandoffFile(
    path.join(dataRoot, "mapping-store", "handoffs", "handoffs.json"),
    log,
  );
  const directory = new ThreadDirectory(path.join(dataRoot, "cli-credentials.json"), log);
  // With handoffs to show, the sidebar soon asks to describe some of their Threads.
  void handoffs.read().then((links) => {
    if (links.length > 0) directory.warm();
  });
  ctx.handle(HANDOFFS_METHOD, async (params) => {
    const links = await handoffs.read();
    const threads = await directory.describe(wantedThreads(params, links));
    return { links, threads };
  });
}
