/**
 * Layout of delegated child Threads in the sidebar lists Codex Desktop has mounted.
 *
 * The parent relation comes from the Host's Thread tree subscription (`api.threads.watchTree`).
 * Each sidebar list is its own view, as Desktop can list the same Thread in a project and in
 * Recents. Within a list, a tree appears once, where its topmost member in that list stands: on
 * the root's own row when that is the topmost, otherwise on a row codexhost draws for the root.
 * Members whose rows the tree replaces are hidden.
 *
 * Trees whose roots continue one another after a context handoff form a handoff group: the trees
 * stand next to each other at their own level, the one that received context most recently
 * first. A group is placed like a tree, where its topmost member in the list stands.
 */
import { handoffChains, type HandoffLink } from "./handoff.js";

export type SidebarThreadTreeStatus = "pending" | "running" | "unknown" | "idle";

/** Waiting for the user (an approval or a question) outranks running, then unknown, then idle. */
const STATUS_PRIORITY: Record<SidebarThreadTreeStatus, number> = {
  pending: 0,
  running: 1,
  unknown: 2,
  idle: 3,
};

export function mostUrgentSidebarThreadStatus(
  statuses: Iterable<SidebarThreadTreeStatus>,
): SidebarThreadTreeStatus {
  let result: SidebarThreadTreeStatus = "idle";
  for (const status of statuses) {
    if (STATUS_PRIORITY[status] < STATUS_PRIORITY[result]) result = status;
  }
  return result;
}

/** Display rule: levels deeper than this keep its indentation and draw no guides. */
export const SIDEBAR_THREAD_TREE_MAX_INDENT_DEPTH = 3;
const MAX_ANCESTRY = 64;

/** What the Host describes about a Thread placed in the tree. */
export interface SidebarThreadTreeThread {
  status: SidebarThreadTreeStatus;
  /** The user archived the Thread. */
  archived: boolean;
  /** The Thread no longer exists. Like an archived one, it and its subtree are left out. */
  deleted?: boolean;
  /** Position among siblings: larger sorts first (delegation time). */
  order: number;
}

/** Live work below a Thread, for the collapsed summary. */
export interface SidebarThreadTreeActivity {
  running: number;
  pending: number;
}

export interface SidebarThreadTreeNode {
  threadId: string;
  /** 1 for a direct child of the root. */
  depth: number;
  status: SidebarThreadTreeStatus;
  /** Threads below this one; 0 means it has nothing to expand. */
  descendants: number;
  expanded: boolean;
  /** Most urgent state below this one. */
  rollup: SidebarThreadTreeStatus;
  activity: SidebarThreadTreeActivity;
}

export interface SidebarThreadTreeRoot {
  threadId: string;
  status: SidebarThreadTreeStatus;
  descendants: number;
  expanded: boolean;
  rollup: SidebarThreadTreeStatus;
  activity: SidebarThreadTreeActivity;
  /** Visible descendants in display order; empty while collapsed. */
  nodes: SidebarThreadTreeNode[];
}

/** A native row Desktop has mounted, in document order. */
export interface SidebarThreadTreeRowInput {
  key: string;
  threadId: string;
  /** The sidebar list the row belongs to. */
  list: string;
}

export type SidebarThreadTreeRowPlan =
  /**
   * The row is the root and shows its tree. With `handoff`, the trees of the Threads it continues
   * follow it, at its level.
   */
  | { kind: "root"; tree: SidebarThreadTreeRoot; handoff?: SidebarThreadTreeRoot[] }
  /**
   * The row is the topmost member of a tree whose root row is elsewhere or not mounted, or of a
   * handoff group that does not start with this row's Thread.
   */
  | { kind: "virtual"; tree: SidebarThreadTreeRoot; handoff?: SidebarThreadTreeRoot[] }
  /** The row's Thread is shown in a tree or handoff group above it in the same list. */
  | { kind: "hidden"; rootId: string }
  | { kind: "plain" };

/**
 * Plans every mounted row. Threads the Host has not described and archived Threads are left out
 * of trees, with everything below them; such a Thread's descendants form their own trees. A
 * Thread whose ancestry loops is left as it is. A handoff joins the trees of two Threads that
 * are shown at the top level; a Thread shown under a parent stays in its parent's tree.
 */
export function planSidebarThreadTree(input: {
  parents: Readonly<Record<string, string>>;
  threads: ReadonlyMap<string, SidebarThreadTreeThread>;
  rows: readonly SidebarThreadTreeRowInput[];
  expanded(threadId: string): boolean;
  handoffs?: readonly HandoffLink[];
}): Map<string, SidebarThreadTreeRowPlan> {
  const { threads } = input;

  /** Number of ancestors, or null when the chain loops or is too long to trust. */
  const ancestry = (threadId: string): number | null => {
    const seen = new Set([threadId]);
    let depth = 0;
    for (
      let current = Object.hasOwn(input.parents, threadId) ? input.parents[threadId] : undefined;
      current !== undefined;
      current = Object.hasOwn(input.parents, current) ? input.parents[current] : undefined
    ) {
      if (seen.has(current) || depth >= MAX_ANCESTRY) return null;
      seen.add(current);
      depth += 1;
    }
    return depth;
  };
  const depths = new Map<string, number>();
  const parentOf = (threadId: string): string | undefined => {
    if (!Object.hasOwn(input.parents, threadId) || input.parents[threadId] === undefined)
      return undefined;
    let depth = depths.get(threadId);
    if (depth === undefined) depths.set(threadId, (depth = ancestry(threadId) ?? -1));
    return depth < 0 ? undefined : input.parents[threadId];
  };
  const showable = (threadId: string): boolean => {
    const thread = threads.get(threadId);
    return thread !== undefined && !thread.archived && thread.deleted !== true;
  };

  const childrenOf = new Map<string, string[]>();
  for (const childId of Object.keys(input.parents)) {
    const parentId = parentOf(childId);
    if (parentId === undefined || !showable(childId)) continue;
    let siblings = childrenOf.get(parentId);
    if (!siblings) childrenOf.set(parentId, (siblings = []));
    siblings.push(childId);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort(
      (left, right) =>
        (threads.get(right)?.order ?? 0) - (threads.get(left)?.order ?? 0) ||
        (left < right ? -1 : left > right ? 1 : 0),
    );
  }

  /** The highest Thread this one is shown under, or itself. */
  const topOf = (threadId: string): string => {
    let current = threadId;
    for (let parentId = parentOf(current); parentId !== undefined; parentId = parentOf(current)) {
      if (!showable(current) || !showable(parentId)) break;
      current = parentId;
    }
    return current;
  };

  const walk = (
    parentId: string,
    depth: number,
    emit: boolean,
    out: SidebarThreadTreeNode[],
  ): { count: number; statuses: SidebarThreadTreeStatus[] } => {
    let count = 0;
    const statuses: SidebarThreadTreeStatus[] = [];
    for (const childId of childrenOf.get(parentId) ?? []) {
      const status = threads.get(childId)?.status ?? "idle";
      const expanded = input.expanded(childId);
      const node: SidebarThreadTreeNode = {
        threadId: childId,
        depth,
        status,
        descendants: 0,
        expanded,
        rollup: "idle",
        activity: { running: 0, pending: 0 },
      };
      if (emit) out.push(node);
      const below = walk(childId, depth + 1, emit && expanded, out);
      node.descendants = below.count;
      node.rollup = mostUrgentSidebarThreadStatus(below.statuses);
      node.activity = activityOf(below.statuses);
      count += 1 + below.count;
      statuses.push(status, ...below.statuses);
    }
    return { count, statuses };
  };

  const trees = new Map<string, SidebarThreadTreeRoot>();
  const treeOf = (rootId: string): SidebarThreadTreeRoot => {
    let tree = trees.get(rootId);
    if (!tree) {
      const nodes: SidebarThreadTreeNode[] = [];
      const expanded = input.expanded(rootId);
      const { count, statuses } = walk(rootId, 1, expanded, nodes);
      tree = {
        threadId: rootId,
        status: threads.get(rootId)?.status ?? "idle",
        descendants: count,
        expanded,
        rollup: mostUrgentSidebarThreadStatus(statuses),
        activity: activityOf(statuses),
        nodes,
      };
      trees.set(rootId, tree);
    }
    return tree;
  };

  /** Each handoff group's trees in display order, by the root of each of its trees. */
  const groups = new Map<string, SidebarThreadTreeRoot[]>();
  const chains = handoffChains(
    input.handoffs ?? [],
    (threadId) => showable(threadId) && topOf(threadId) === threadId,
  );
  for (const chain of chains) {
    const units = chain.map(treeOf);
    for (const unit of units) groups.set(unit.threadId, units);
  }

  const plans = new Map<string, SidebarThreadTreeRowPlan>();
  const placed = new Set<string>();
  for (const row of input.rows) {
    const rootId = topOf(row.threadId);
    const units = showable(rootId) ? groups.get(rootId) : undefined;
    const head = units?.[0];
    if (units && head) {
      const group = `${row.list}\u0000${head.threadId}`;
      if (placed.has(group)) {
        plans.set(row.key, { kind: "hidden", rootId: head.threadId });
        continue;
      }
      placed.add(group);
      plans.set(row.key, {
        kind: row.threadId === head.threadId ? "root" : "virtual",
        tree: head,
        handoff: units.slice(1),
      });
      continue;
    }
    // topOf stops at the row's own Thread when that is not showable: its children form their
    // own trees, under their own rows.
    const tree = showable(rootId) ? treeOf(rootId) : null;
    if (!tree || tree.descendants === 0) {
      plans.set(row.key, { kind: "plain" });
      continue;
    }
    const group = `${row.list}\u0000${rootId}`;
    if (placed.has(group)) {
      plans.set(row.key, { kind: "hidden", rootId });
      continue;
    }
    placed.add(group);
    plans.set(row.key, { kind: row.threadId === rootId ? "root" : "virtual", tree });
  }
  return plans;
}

function activityOf(statuses: readonly SidebarThreadTreeStatus[]): SidebarThreadTreeActivity {
  let running = 0;
  let pending = 0;
  for (const status of statuses) {
    if (status === "running") running += 1;
    else if (status === "pending") pending += 1;
  }
  return { running, pending };
}
