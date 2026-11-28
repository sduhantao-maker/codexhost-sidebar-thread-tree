/**
 * Context handoffs, shared by Desktop and Web.
 *
 * codexhost can hand a conversation's context to another agent: a new Thread then continues the
 * old one. The backend reads those links from codexhost; here they become chains of Threads that
 * the sidebar keeps next to each other, at their own level, joined by a rail on their side.
 */

/** `target` continues `source` with another agent. */
export interface HandoffLink {
  target: string;
  source: string;
  /** When the handoff happened, in ms since the epoch; 0 when unknown. */
  at: number;
}

export type HandoffThreadStatus = "running" | "waiting" | "idle" | "unknown";

/** What the backend knows of a Thread of a handoff that the sidebar does not show itself. */
export interface HandoffThreadInfo {
  title?: string;
  /** The Thread's agent (Harness ID). */
  agent?: string;
  status?: HandoffThreadStatus;
  /** Last activity, in ms since the epoch. */
  updatedAt?: number;
}

export interface HandoffSnapshot {
  links: HandoffLink[];
  threads: Record<string, HandoffThreadInfo>;
}

export const EMPTY_HANDOFFS: HandoffSnapshot = { links: [], threads: {} };

/** The backend method both surfaces call. */
export const HANDOFFS_METHOD = "handoffs";
/** At most this many Threads are joined in one chain; longer chains keep their newest Threads. */
export const MAX_HANDOFF_CHAIN = 16;
/** At most this many Threads are described in one call. */
export const MAX_DESCRIBED_THREADS = 64;
/** How often both surfaces ask again; the backend answers from a cache in between. */
export const HANDOFF_POLL_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, max = 512): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    ? value
    : undefined;
}

const STATUSES: ReadonlySet<string> = new Set(["running", "waiting", "idle", "unknown"]);

/** Reads the backend's answer, keeping only well-formed entries. */
export function parseHandoffSnapshot(value: unknown): HandoffSnapshot {
  if (!isRecord(value)) return EMPTY_HANDOFFS;
  const links: HandoffLink[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value.links) ? value.links : []) {
    if (!isRecord(entry)) continue;
    const target = nonEmpty(entry.target, 256);
    const source = nonEmpty(entry.source, 256);
    if (!target || !source || target === source || seen.has(target)) continue;
    seen.add(target);
    const at = typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0;
    links.push({ target, source, at });
  }
  const threads: Record<string, HandoffThreadInfo> = {};
  if (isRecord(value.threads)) {
    for (const [threadId, entry] of Object.entries(value.threads)) {
      if (!isRecord(entry) || !nonEmpty(threadId, 256)) continue;
      const info: HandoffThreadInfo = {};
      const title = nonEmpty(entry.title, 4096);
      const agent = nonEmpty(entry.agent, 128);
      if (title) info.title = title;
      if (agent) info.agent = agent;
      if (typeof entry.status === "string" && STATUSES.has(entry.status))
        info.status = entry.status as HandoffThreadStatus;
      if (typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt))
        info.updatedAt = entry.updatedAt;
      threads[threadId] = info;
    }
  }
  return { links, threads };
}

/** Whether two snapshots say the same. */
export function sameHandoffs(left: HandoffSnapshot, right: HandoffSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The Threads a link touches. */
export function handoffMembers(links: readonly HandoffLink[]): Set<string> {
  const members = new Set<string>();
  for (const { target, source } of links) members.add(target).add(source);
  return members;
}

/**
 * Chains of Threads joined by handoffs, each in display order: the Thread that received context
 * most recently first, the Thread the chain started from last. A chain stays joined through
 * Threads `include` leaves out, such as an archived Thread between two shown ones. Chains of
 * fewer than two included Threads are left out.
 */
export function handoffChains(
  links: readonly HandoffLink[],
  include: (threadId: string) => boolean,
): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    for (let next = parent.get(root); next !== undefined && next !== root; next = parent.get(root))
      root = next;
    // Path compression keeps later lookups short.
    for (let node = id; node !== root;) {
      const next = parent.get(node) ?? root;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const arrival = new Map<string, number>();
  for (const { target, source, at } of links) {
    if (!parent.has(target)) parent.set(target, target);
    if (!parent.has(source)) parent.set(source, source);
    const a = find(target);
    const b = find(source);
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    arrival.set(target, Math.max(arrival.get(target) ?? Number.NEGATIVE_INFINITY, at));
  }
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) {
    if (!include(id)) continue;
    const root = find(id);
    let members = groups.get(root);
    if (!members) groups.set(root, (members = []));
    members.push(id);
  }
  const chains: string[][] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // A Thread that never received context (where the chain started) sorts last.
    members.sort(
      (left, right) =>
        (arrival.get(right) ?? Number.NEGATIVE_INFINITY) -
          (arrival.get(left) ?? Number.NEGATIVE_INFINITY) ||
        (left < right ? -1 : left > right ? 1 : 0),
    );
    chains.push(members.slice(0, MAX_HANDOFF_CHAIN));
  }
  return chains;
}

/** The first retry after a failed call; each failure doubles it, up to the poll interval. */
const RETRY_FIRST_MS = 1_000;

export interface HandoffSourceOptions {
  /** `api.backend.invoke` of Desktop or Web. */
  invoke(method: string, params: { describe: string[] }): Promise<unknown>;
  /** Called after the snapshot changed. */
  onChange(): void;
  /** Whether the sidebar is on screen; polling pauses while it is not. */
  visible(): boolean;
  timers: Pick<Window, "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval">;
}

/**
 * The handoffs the backend reports, asked for at start, on every poll while the sidebar is on
 * screen, when the surface asks (`refresh`), and when the Threads it wants described change. One
 * call runs at a time; a failed call is retried soon, then less and less often.
 */
export class HandoffSource {
  snapshot: HandoffSnapshot = EMPTY_HANDOFFS;
  #wanted: string[] = [];
  #asked: string | null = null;
  #running = false;
  #again = false;
  #retryMs = 0;
  #retryTimer: number | undefined;
  #pollTimer: number | undefined;
  #disposed = false;

  constructor(private readonly options: HandoffSourceOptions) {}

  start(): void {
    this.refresh();
    this.#pollTimer = this.options.timers.setInterval(() => {
      if (this.options.visible()) this.refresh();
    }, HANDOFF_POLL_MS);
  }

  /** The Threads the surface cannot show without the backend's description. */
  want(threadIds: Iterable<string>): void {
    const wanted = [...new Set(threadIds)].sort().slice(0, MAX_DESCRIBED_THREADS);
    this.#wanted = wanted;
    if (wanted.join("\u0000") !== this.#asked) this.refresh();
  }

  refresh(): void {
    if (this.#disposed) return;
    if (this.#running) {
      this.#again = true;
      return;
    }
    if (this.#retryTimer !== undefined) {
      this.options.timers.clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
    this.#running = true;
    const describe = this.#wanted;
    this.#asked = describe.join("\u0000");
    void this.options
      .invoke(HANDOFFS_METHOD, { describe })
      .then(
        (value) => {
          this.#retryMs = 0;
          if (this.#disposed) return;
          const next = parseHandoffSnapshot(value);
          if (sameHandoffs(next, this.snapshot)) return;
          this.snapshot = next;
          this.options.onChange();
        },
        () => {
          // The backend may still be starting: ask again soon, then less often. The sidebar keeps
          // the handoffs it knew meanwhile.
          if (this.#disposed) return;
          this.#retryMs = Math.min(
            HANDOFF_POLL_MS,
            this.#retryMs === 0 ? RETRY_FIRST_MS : this.#retryMs * 2,
          );
          this.#retryTimer = this.options.timers.setTimeout(() => {
            this.#retryTimer = undefined;
            this.refresh();
          }, this.#retryMs);
        },
      )
      .finally(() => {
        this.#running = false;
        if (!this.#again) return;
        this.#again = false;
        this.refresh();
      });
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#pollTimer !== undefined) this.options.timers.clearInterval(this.#pollTimer);
    if (this.#retryTimer !== undefined) this.options.timers.clearTimeout(this.#retryTimer);
    this.#pollTimer = undefined;
    this.#retryTimer = undefined;
  }
}

/** The tree guides' elbow: 10.5px wide, ending 6px before the icon it points at. */
export const RAIL_ELBOW_PX = 10.5;
export const RAIL_GAP_PX = 6;
const RAIL_MIN_GAP_PX = 3;
const RAIL_MIN_ELBOW_PX = 4;

/**
 * Where the handoff rail runs, from the left of the icon column (`iconLeft`) and the first
 * position that is still drawn (`minX`): the tree guides' elbow where there is room, tighter
 * where the sidebar leaves little space beside the icons.
 */
export function handoffRail(iconLeft: number, minX = 1): { x: number; width: number } {
  let gap = RAIL_GAP_PX;
  let x = iconLeft - gap - RAIL_ELBOW_PX;
  if (x < minX) {
    gap = Math.max(RAIL_MIN_GAP_PX, iconLeft - minX - RAIL_ELBOW_PX);
    x = Math.max(minX, iconLeft - gap - RAIL_ELBOW_PX);
  }
  const width = Math.max(RAIL_MIN_ELBOW_PX, iconLeft - gap - x);
  return { x: Math.round(x * 2) / 2, width: Math.round(width * 2) / 2 };
}
