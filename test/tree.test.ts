import { describe, expect, it } from "vitest";
import {
  SIDEBAR_THREAD_TREE_MAX_INDENT_DEPTH,
  mostUrgentSidebarThreadStatus,
  planSidebarThreadTree,
  type SidebarThreadTreeThread,
} from "../src/tree.js";

const thread = (
  status: SidebarThreadTreeThread["status"] = "idle",
  order = 0,
  archived = false,
): SidebarThreadTreeThread => ({
  status,
  archived,
  order,
});

describe("sidebar Thread tree placement", () => {
  it("places one tree per list at its first mounted member, with nested live activity and rollup", () => {
    const expanded = new Set(["parent", "child"]);
    const plans = planSidebarThreadTree({
      parents: { child: "parent", leaf: "child", other: "parent" },
      threads: new Map([
        ["parent", thread("idle", 10)],
        ["child", thread("running", 20)],
        ["leaf", thread("pending", 30)],
        ["other", thread("unknown", 15)],
      ]),
      rows: [
        { key: "recent-child", threadId: "child", list: "recents" },
        { key: "recent-parent", threadId: "parent", list: "recents" },
        { key: "project-parent", threadId: "parent", list: "project" },
        { key: "project-leaf", threadId: "leaf", list: "project" },
      ],
      expanded: (id) => expanded.has(id),
    });

    expect(plans.get("recent-child")).toEqual({
      kind: "virtual",
      tree: {
        threadId: "parent",
        status: "idle",
        descendants: 3,
        expanded: true,
        rollup: "pending",
        activity: { running: 1, pending: 1 },
        nodes: [
          {
            threadId: "child",
            depth: 1,
            status: "running",
            descendants: 1,
            expanded: true,
            rollup: "pending",
            activity: { running: 0, pending: 1 },
          },
          {
            threadId: "leaf",
            depth: 2,
            status: "pending",
            descendants: 0,
            expanded: false,
            rollup: "idle",
            activity: { running: 0, pending: 0 },
          },
          {
            threadId: "other",
            depth: 1,
            status: "unknown",
            descendants: 0,
            expanded: false,
            rollup: "idle",
            activity: { running: 0, pending: 0 },
          },
        ],
      },
    });
    expect(plans.get("recent-parent")).toEqual({ kind: "hidden", rootId: "parent" });
    expect(plans.get("project-parent")).toMatchObject({
      kind: "root",
      tree: { threadId: "parent", descendants: 3, expanded: true },
    });
    expect(plans.get("project-leaf")).toEqual({ kind: "hidden", rootId: "parent" });
  });

  it("omits nodes while collapsed while still counting descendants and activity", () => {
    const plans = planSidebarThreadTree({
      parents: { child: "parent", leaf: "child" },
      threads: new Map([
        ["parent", thread("idle")],
        ["child", thread("running")],
        ["leaf", thread("pending")],
      ]),
      rows: [
        { key: "parent", threadId: "parent", list: "project" },
        { key: "child", threadId: "child", list: "project" },
      ],
      expanded: () => false,
    });

    expect(plans.get("parent")).toEqual({
      kind: "root",
      tree: {
        threadId: "parent",
        status: "idle",
        descendants: 2,
        expanded: false,
        rollup: "pending",
        activity: { running: 1, pending: 1 },
        nodes: [],
      },
    });
    expect(plans.get("child")).toEqual({ kind: "hidden", rootId: "parent" });
  });

  it("leaves unplaceable rows plain and keeps descendants below a promoted Thread", () => {
    const plans = planSidebarThreadTree({
      parents: {
        child: "pinned",
        archived: "parent",
        detached: "archived",
        missing: "not-in-snapshot",
        loop: "loop",
      },
      threads: new Map([
        ["parent", thread()],
        ["pinned", thread()],
        ["child", thread()],
        ["archived", thread("idle", 0, true)],
        ["detached", thread()],
        ["missing", thread()],
        ["loop", thread()],
      ]),
      rows: ["parent", "pinned", "child", "archived", "detached", "missing", "loop"].map(
        (threadId) => ({
          key: threadId,
          list: "project",
          threadId,
        }),
      ),
      expanded: () => true,
    });

    expect(plans.get("pinned")).toMatchObject({
      kind: "root",
      tree: { threadId: "pinned", descendants: 1, nodes: [{ threadId: "child", depth: 1 }] },
    });
    expect(plans.get("child")).toEqual({ kind: "hidden", rootId: "pinned" });
    for (const key of ["parent", "archived", "detached", "missing", "loop"]) {
      expect(plans.get(key)).toEqual({ kind: "plain" });
    }
  });

  it("ranks pending > running > unknown > idle without conflating unknown with idle", () => {
    expect(SIDEBAR_THREAD_TREE_MAX_INDENT_DEPTH).toBe(3);
    expect(mostUrgentSidebarThreadStatus(["idle", "unknown"])).toBe("unknown");
    expect(mostUrgentSidebarThreadStatus(["unknown", "running"])).toBe("running");
    expect(mostUrgentSidebarThreadStatus(["running", "pending", "unknown"])).toBe("pending");
    expect(mostUrgentSidebarThreadStatus([])).toBe("idle");
  });
});

describe("handoff groups", () => {
  const unit = (threadId: string, descendants = 0) => ({
    threadId,
    status: "idle" as const,
    descendants,
    expanded: false,
    rollup: "idle" as const,
    activity: { running: 0, pending: 0 },
    nodes: [],
  });

  it("puts the Thread that received context first, on its own row, and hides the other's row", () => {
    const plans = planSidebarThreadTree({
      parents: {},
      threads: new Map([
        ["claude", thread()],
        ["codex", thread()],
        ["other", thread()],
      ]),
      rows: [
        { key: "claude", threadId: "claude", list: "recents" },
        { key: "other", threadId: "other", list: "recents" },
        { key: "codex", threadId: "codex", list: "recents" },
      ],
      expanded: () => false,
      handoffs: [{ target: "claude", source: "codex", at: 5 }],
    });
    expect(plans.get("claude")).toEqual({
      kind: "root",
      tree: unit("claude"),
      handoff: [unit("codex")],
    });
    expect(plans.get("codex")).toEqual({ kind: "hidden", rootId: "claude" });
    expect(plans.get("other")).toEqual({ kind: "plain" });
  });

  it("draws the whole group where the older Thread stands when it sorts first", () => {
    const plans = planSidebarThreadTree({
      parents: { child: "codex" },
      threads: new Map([
        ["claude", thread()],
        ["codex", thread()],
        ["child", thread("running")],
      ]),
      rows: [
        { key: "codex", threadId: "codex", list: "recents" },
        { key: "claude", threadId: "claude", list: "recents" },
      ],
      expanded: () => false,
      handoffs: [{ target: "claude", source: "codex", at: 5 }],
    });
    expect(plans.get("codex")).toEqual({
      kind: "virtual",
      tree: unit("claude"),
      handoff: [{ ...unit("codex", 1), rollup: "running", activity: { running: 1, pending: 0 } }],
    });
    expect(plans.get("claude")).toEqual({ kind: "hidden", rootId: "claude" });
  });

  it("leaves a delegated child in its parent's tree and a lone Thread alone", () => {
    const plans = planSidebarThreadTree({
      parents: { child: "parent" },
      threads: new Map([
        ["parent", thread()],
        ["child", thread()],
        ["claude", thread()],
        ["solo", thread()],
      ]),
      rows: [
        { key: "parent", threadId: "parent", list: "recents" },
        { key: "claude", threadId: "claude", list: "recents" },
        { key: "solo", threadId: "solo", list: "recents" },
      ],
      expanded: () => false,
      handoffs: [
        { target: "claude", source: "child", at: 5 },
        { target: "solo", source: "archived-or-unknown", at: 6 },
      ],
    });
    expect(plans.get("parent")).toMatchObject({ kind: "root", tree: { threadId: "parent" } });
    expect(plans.get("parent")).not.toHaveProperty("handoff");
    expect(plans.get("claude")).toEqual({ kind: "plain" });
    expect(plans.get("solo")).toEqual({ kind: "plain" });
  });

  it("shows a group once in every list that has one of its Threads", () => {
    const plans = planSidebarThreadTree({
      parents: {},
      threads: new Map([
        ["claude", thread()],
        ["codex", thread()],
      ]),
      rows: [
        { key: "recent-claude", threadId: "claude", list: "recents" },
        { key: "project-codex", threadId: "codex", list: "project" },
      ],
      expanded: () => false,
      handoffs: [{ target: "claude", source: "codex", at: 5 }],
    });
    expect(plans.get("recent-claude")).toMatchObject({
      kind: "root",
      handoff: [{ threadId: "codex" }],
    });
    expect(plans.get("project-codex")).toMatchObject({
      kind: "virtual",
      tree: { threadId: "claude" },
      handoff: [{ threadId: "codex" }],
    });
  });
});
