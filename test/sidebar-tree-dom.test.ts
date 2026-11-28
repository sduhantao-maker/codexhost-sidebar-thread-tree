// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  harnessIdSchema,
  threadTreeSnapshotSchema,
  type DesktopExtensionApiV1,
  type DesktopSidebarRow,
  type ThreadTreeNode,
  type ThreadTreeSnapshot,
} from "@codexhost/shared-contracts";
import {
  SIDEBAR_TREE_ACTION_ATTRIBUTE,
  SIDEBAR_TREE_ACTIONS_CLASS,
  SIDEBAR_TREE_CHILDREN_ATTRIBUTE,
  SIDEBAR_TREE_EXPAND_ATTRIBUTE,
  SIDEBAR_TREE_MENU_ATTRIBUTE,
  SIDEBAR_TREE_NODE_ATTRIBUTE,
  SIDEBAR_TREE_SUMMARY_ATTRIBUTE,
  SIDEBAR_TREE_TOGGLE_ATTRIBUTE,
  SIDEBAR_TREE_VIRTUAL_ATTRIBUTE,
} from "../src/dom.js";
import {
  SIDEBAR_THREAD_TREE_EXPANDED_KEY,
  activate,
  type SidebarThreadTreeOptions,
} from "../src/sidebar-tree.js";

const PI = harnessIdSchema.parse("pi");
const CODEX = harnessIdSchema.parse("codex");

const cleanups: Array<() => void> = [];

function must<T>(value: T | null | undefined, label = "value"): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label} to be defined`);
  return value;
}

afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  document.body.replaceChildren();
  document.documentElement.lang = "";
  window.localStorage.removeItem(SIDEBAR_THREAD_TREE_EXPANDED_KEY);
});

function createHarness(
  options: SidebarThreadTreeOptions = {},
  backend?: { invoke(method: string, params?: unknown): Promise<unknown> },
) {
  const abort = new AbortController();
  const teardowns = new Set<() => void>();
  const mounted = new Set<Element>();
  const marks = new Map<Element, Set<string>>();
  let onRows: ((rows: readonly DesktopSidebarRow[]) => void) | undefined;
  let onTree: ((snapshot: ThreadTreeSnapshot) => void) | undefined;
  const openThread = vi.fn(async (_threadId: string): Promise<void> => undefined);

  const api: DesktopExtensionApiV1 & { backend?: typeof backend } = {
    ...(backend ? { backend } : {}),
    id: "sidebar-thread-tree",
    apiVersion: 1,
    signal: abort.signal,
    sidebar: {
      observeRows(cb) {
        onRows = cb;
        return () => {
          onRows = undefined;
        };
      },
    },
    threads: {
      watchTree(cb) {
        onTree = cb;
        return () => {
          onTree = undefined;
        };
      },
    },
    navigate: { openThread },
    harnesses: {
      describe(harnessId) {
        if (harnessId === "pi") return { name: "Pi", icon: "data:image/svg+xml,<svg/>" };
        if (harnessId === "codex") return { name: "Codex" };
        return undefined;
      },
    },
    dom: {
      mount(node, parent, position = "append") {
        mounted.add(node);
        parent[position](node);
      },
      mark(target, name) {
        const attr = `data-cx-${api.id}-${name}`;
        target.setAttribute(attr, "");
        let set = marks.get(target);
        if (!set) marks.set(target, (set = new Set()));
        set.add(attr);
      },
      unmark(target, name) {
        const attr = `data-cx-${api.id}-${name}`;
        target.removeAttribute(attr);
        marks.get(target)?.delete(attr);
      },
    },
    track(teardown) {
      teardowns.add(teardown);
    },
  };

  const stopActivate = activate(api, { storage: null, ...options });

  const dispose = () => {
    stopActivate();
    abort.abort();
    for (const fn of teardowns) fn();
    teardowns.clear();
    for (const node of mounted) node.remove();
    mounted.clear();
    for (const [el, attrs] of marks) {
      for (const attr of attrs) el.removeAttribute(attr);
    }
    marks.clear();
  };
  cleanups.push(dispose);

  return {
    api,
    openThread,
    dispose,
    setRows(rows: readonly DesktopSidebarRow[]) {
      onRows?.(rows);
    },
    setTree(tree: {
      revision: number;
      truncated: boolean;
      parents: Record<string, string>;
      nodes: Record<string, ThreadTreeNode>;
    }) {
      onTree?.(threadTreeSnapshotSchema.parse(tree));
    },
  };
}

function makeListRow(
  list: HTMLElement,
  threadId: string,
  titleText: string,
  options: { hostId?: string; isLocal?: boolean; agentIcon?: string } = {},
): { item: HTMLElement; row: DesktopSidebarRow; trigger: HTMLElement; icon: HTMLElement } {
  const item = document.createElement("div");
  item.setAttribute("role", "listitem");

  const rowElement = document.createElement("div");
  rowElement.setAttribute("role", "button");
  rowElement.setAttribute("data-app-action-sidebar-thread-row", "");
  rowElement.setAttribute("data-app-action-sidebar-thread-title", titleText);

  const trigger = document.createElement("div");
  trigger.setAttribute("data-thread-title-trigger", "");
  trigger.style.display = "flex";
  trigger.style.alignItems = "center";

  const icon = document.createElement("span");
  icon.setAttribute("data-codexhost-sidebar-agent-icon", options.agentIcon ?? "pi");
  const img = document.createElement("img");
  img.src = "data:image/png;base64,AA==";
  icon.append(img);

  const title = document.createElement("span");
  title.setAttribute("data-thread-title", "");
  title.textContent = titleText;

  trigger.append(icon, title);
  rowElement.append(trigger);
  item.append(rowElement);
  list.append(item);

  return {
    item,
    trigger,
    icon,
    row: {
      element: rowElement,
      hostId: options.hostId ?? "local",
      isLocal: options.isLocal ?? true,
      threadId,
      draftId: null,
      isConnected: () => rowElement.isConnected,
    },
  };
}

function makeNode(
  harnessId: ThreadTreeNode["harnessId"],
  status: ThreadTreeNode["status"],
  title: string,
): ThreadTreeNode {
  return { harnessId, status, title, archived: false };
}

describe("sidebar-thread-tree DOM behavior", () => {
  it("renders PR #947 native root chrome, hides children via api.dom.mark, and navigates via api.navigate.openThread", () => {
    document.documentElement.lang = "zh-CN";
    const harness = createHarness();
    const scroll = document.createElement("div");
    scroll.setAttribute("data-app-action-sidebar-scroll", "");
    const list = document.createElement("div");
    scroll.append(list);
    document.body.append(scroll);

    const parent = makeListRow(list, "parent", "梳理侧栏会话交互", { agentIcon: "codex" });
    const childWait = makeListRow(list, "child-wait", "确认规则");
    const childRun = makeListRow(list, "child-run", "核对状态");
    const childUnknown = makeListRow(list, "child-unknown", "未知状态");
    const childIdle = makeListRow(list, "child-idle", "整理术语");

    harness.setRows([parent.row, childWait.row, childRun.row, childUnknown.row, childIdle.row]);
    harness.setTree({
      revision: 1,
      truncated: false,
      parents: {
        "child-wait": "parent",
        "child-run": "parent",
        "child-unknown": "parent",
        "child-idle": "parent",
      },
      nodes: {
        parent: makeNode(CODEX, "idle", "梳理侧栏会话交互"),
        "child-wait": makeNode(PI, "waiting", "确认规则"),
        "child-run": makeNode(CODEX, "running", "核对状态"),
        "child-unknown": makeNode(PI, "unknown", "未知状态"),
        "child-idle": makeNode(PI, "idle", "整理术语"),
      },
    });

    // Native children are hidden strictly via host-managed markers, never inline style.
    expect(childWait.item.hasAttribute("data-cx-sidebar-thread-tree-hidden")).toBe(true);
    expect(childWait.item.getAttribute("style")).toBeNull();
    expect(parent.item.hasAttribute("data-cx-sidebar-thread-tree-root-collapsed")).toBe(true);

    // Native root places .cxh-tree-toggle right before the Agent icon without touching icon attrs.
    const toggle = parent.row.element.querySelector<HTMLButtonElement>(
      `[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}="parent"]`,
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.nextElementSibling).toBe(parent.icon);
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(parent.icon.getAttribute("style")).toBeNull();

    // Collapsed state renders PR #947 summary line + expand button, and no children group yet.
    const summaryLine = parent.item.querySelector<HTMLElement>(
      `[${SIDEBAR_TREE_SUMMARY_ATTRIBUTE}="parent"]`,
    );
    const summaryButton = summaryLine?.querySelector<HTMLButtonElement>(
      `[${SIDEBAR_TREE_EXPAND_ATTRIBUTE}="parent"]`,
    );
    expect(summaryButton?.textContent).toBe("4 个子会话 · 1 运行中 · 1 待批准");
    expect(parent.item.querySelector(`[${SIDEBAR_TREE_CHILDREN_ATTRIBUTE}]`)).toBeNull();

    // Clicking the summary line outside the summary button opens the parent via api.navigate.openThread.
    must(summaryLine, "summary line").click();
    expect(harness.openThread).toHaveBeenCalledWith("parent");

    // Clicking the toggle expands without bubbling to the native row.
    const rowClicks: string[] = [];
    parent.row.element.addEventListener("click", () => rowClicks.push("click"));
    must(toggle, "tree toggle").click();
    expect(rowClicks).toEqual([]);

    // Expanded state marks root-expanded, removes summary line, and mounts guided children.
    expect(parent.item.hasAttribute("data-cx-sidebar-thread-tree-root-expanded")).toBe(true);
    expect(parent.item.hasAttribute("data-cx-sidebar-thread-tree-root-collapsed")).toBe(false);
    expect(parent.item.querySelector(`[${SIDEBAR_TREE_SUMMARY_ATTRIBUTE}]`)).toBeNull();
    const childrenGroup = parent.item.querySelector<HTMLElement>(
      `[${SIDEBAR_TREE_CHILDREN_ATTRIBUTE}="parent"]`,
    );
    expect(childrenGroup?.hasAttribute("data-guide")).toBe(true);

    const waitRow = parent.item.querySelector<HTMLElement>(
      `[${SIDEBAR_TREE_NODE_ATTRIBUTE}="child-wait"]`,
    );
    const runRow = parent.item.querySelector<HTMLElement>(
      `[${SIDEBAR_TREE_NODE_ATTRIBUTE}="child-run"]`,
    );
    const unknownRow = parent.item.querySelector<HTMLElement>(
      `[${SIDEBAR_TREE_NODE_ATTRIBUTE}="child-unknown"]`,
    );
    const idleRow = parent.item.querySelector<HTMLElement>(
      `[${SIDEBAR_TREE_NODE_ATTRIBUTE}="child-idle"]`,
    );

    expect(waitRow?.querySelector('.cxh-tree-status[data-status="pending"]')).not.toBeNull();
    expect(runRow?.querySelector('.cxh-tree-status[data-status="running"] > svg')).not.toBeNull();
    expect(unknownRow?.querySelector('.cxh-tree-status[data-status="unknown"]')).not.toBeNull();
    expect(idleRow?.querySelector(".cxh-tree-status")).toBeNull();

    // Clicking a child row calls api.navigate.openThread.
    must(waitRow, "wait child row").click();
    expect(harness.openThread).toHaveBeenCalledWith("child-wait");

    // Keyboard Enter on a child row also navigates.
    must(runRow, "run child row").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(harness.openThread).toHaveBeenCalledWith("child-run");

    // Disposing restores all marks and removes all extension nodes.
    harness.dispose();
    expect(childWait.item.hasAttribute("data-cx-sidebar-thread-tree-hidden")).toBe(false);
    expect(parent.item.hasAttribute("data-cx-sidebar-thread-tree-root-expanded")).toBe(false);
    expect(parent.item.querySelector(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`)).toBeNull();
    expect(parent.item.querySelector(`[${SIDEBAR_TREE_CHILDREN_ATTRIBUTE}]`)).toBeNull();
  });

  it("renders virtual root with anchor mark when child precedes parent, and moves focus on summary expand", () => {
    document.documentElement.lang = "en";
    const harness = createHarness();
    const list = document.createElement("div");
    document.body.append(list);

    const child = makeListRow(list, "child-1", "Child task");
    const parent = makeListRow(list, "parent", "Parent task");

    harness.setRows([child.row, parent.row]);
    harness.setTree({
      revision: 1,
      truncated: false,
      parents: { "child-1": "parent" },
      nodes: {
        parent: makeNode(PI, "idle", "Parent task"),
        "child-1": makeNode(PI, "running", "Child task"),
      },
    });

    expect(child.item.hasAttribute("data-cx-sidebar-thread-tree-anchor")).toBe(true);
    expect(child.row.element.getAttribute("style")).toBeNull();
    expect(parent.item.hasAttribute("data-cx-sidebar-thread-tree-hidden")).toBe(true);

    const virtual = child.item.querySelector<HTMLElement>(
      `[${SIDEBAR_TREE_VIRTUAL_ATTRIBUTE}="parent"]`,
    );
    expect(virtual).not.toBeNull();
    const summaryBtn = virtual?.querySelector<HTMLButtonElement>(
      `[${SIDEBAR_TREE_EXPAND_ATTRIBUTE}="parent"]`,
    );
    expect(summaryBtn?.textContent).toBe("1 child sessions · 1 running");

    // Focusing summary button then clicking moves focus to the root toggle after expand.
    const requiredSummaryBtn = must(summaryBtn, "summary button");
    requiredSummaryBtn.focus();
    requiredSummaryBtn.click();
    expect(virtual?.querySelector(`[${SIDEBAR_TREE_EXPAND_ATTRIBUTE}]`)).toBeNull();
    const rootToggle = virtual?.querySelector<HTMLElement>(
      `[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}="parent"]`,
    );
    expect(document.activeElement).toBe(rootToggle);
    expect(virtual?.querySelector(`[${SIDEBAR_TREE_NODE_ATTRIBUTE}="child-1"]`)).not.toBeNull();
  });

  it("auto-expands ancestors for the currently open Thread and marks it aria-current=page", () => {
    const harness = createHarness();
    const list = document.createElement("div");
    document.body.append(list);

    const portal = document.createElement("div");
    portal.setAttribute("data-above-composer-conversation-id", "grandchild");
    document.body.append(portal);

    const parent = makeListRow(list, "parent", "Parent");
    const child = makeListRow(list, "child", "Child");
    const grandchild = makeListRow(list, "grandchild", "Grandchild");

    harness.setRows([parent.row, child.row, grandchild.row]);
    harness.setTree({
      revision: 1,
      truncated: false,
      parents: { child: "parent", grandchild: "child" },
      nodes: {
        parent: makeNode(CODEX, "idle", "Parent"),
        child: makeNode(PI, "idle", "Child"),
        grandchild: makeNode(PI, "running", "Grandchild"),
      },
    });

    const activeRow = parent.item.querySelector<HTMLElement>(
      `[${SIDEBAR_TREE_NODE_ATTRIBUTE}="grandchild"]`,
    );
    expect(activeRow?.getAttribute("aria-current")).toBe("page");

    // User can still collapse the parent afterwards without auto-expand overriding it.
    must(
      parent.row.element.querySelector<HTMLButtonElement>(
        `[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}="parent"]`,
      ),
      "parent tree toggle",
    ).click();
    expect(parent.item.hasAttribute("data-cx-sidebar-thread-tree-root-collapsed")).toBe(true);
  });

  it("leaves remote rows, shared listitems, and nodes omitted from truncated snapshots untouched", () => {
    const harness = createHarness();
    const list = document.createElement("div");
    document.body.append(list);

    const remoteParent = makeListRow(list, "parent", "Remote parent", {
      hostId: "remote-1",
      isLocal: false,
    });
    const localParent = makeListRow(list, "parent", "Local parent");
    const localChild = makeListRow(list, "child", "Local child");
    const omittedRow = makeListRow(list, "omitted", "Omitted in truncated snapshot");

    harness.setRows([remoteParent.row, localParent.row, localChild.row, omittedRow.row]);
    harness.setTree({
      revision: 1,
      truncated: true,
      parents: { child: "parent" },
      nodes: {
        parent: makeNode(CODEX, "idle", "Local parent"),
        child: makeNode(PI, "idle", "Local child"),
      },
    });

    expect(remoteParent.item.hasAttribute("data-cx-sidebar-thread-tree-root-collapsed")).toBe(
      false,
    );
    expect(remoteParent.item.hasAttribute("data-cx-sidebar-thread-tree-hidden")).toBe(false);
    expect(localParent.item.hasAttribute("data-cx-sidebar-thread-tree-root-collapsed")).toBe(true);
    expect(localChild.item.hasAttribute("data-cx-sidebar-thread-tree-hidden")).toBe(true);
    expect(omittedRow.item.hasAttribute("data-cx-sidebar-thread-tree-hidden")).toBe(false);
  });

  it("places the toggle before an Agent icon that sits outside the title trigger", () => {
    const harness = createHarness();
    const list = document.createElement("div");
    document.body.append(list);

    const parent = makeListRow(list, "parent", "Parent");
    const child = makeListRow(list, "child-1", "Child");
    const spacer = document.createElement("div");
    parent.row.element.insertBefore(spacer, parent.trigger);
    parent.row.element.insertBefore(parent.icon, parent.trigger);

    harness.setRows([parent.row, child.row]);
    harness.setTree({
      revision: 1,
      truncated: false,
      parents: { "child-1": "parent" },
      nodes: {
        parent: makeNode(CODEX, "idle", "Parent"),
        "child-1": makeNode(PI, "idle", "Child"),
      },
    });

    const toggle = parent.row.element.querySelector(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}="parent"]`);
    expect(toggle?.previousElementSibling).toBe(spacer);
    expect(toggle?.nextElementSibling).toBe(parent.icon);
    expect(parent.icon.nextElementSibling).toBe(parent.trigger);
  });

  it("keeps toggle aligned when the native Agent icon is replaced in place", async () => {
    const harness = createHarness();
    const list = document.createElement("div");
    document.body.append(list);

    const parent = makeListRow(list, "parent", "Parent");
    const child = makeListRow(list, "child-1", "Child");

    harness.setRows([parent.row, child.row]);
    harness.setTree({
      revision: 1,
      truncated: false,
      parents: { "child-1": "parent" },
      nodes: {
        parent: makeNode(PI, "idle", "Parent"),
        "child-1": makeNode(PI, "idle", "Child"),
      },
    });

    const toggle = parent.row.element.querySelector(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}="parent"]`);
    expect(toggle?.nextElementSibling).toBe(parent.icon);

    const replacement = document.createElement("span");
    replacement.setAttribute("data-codexhost-sidebar-agent-icon", "codex");
    parent.icon.replaceWith(replacement);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const updatedToggle = parent.row.element.querySelector(
      `[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}="parent"]`,
    );
    expect(updatedToggle).not.toBeNull();
    expect(updatedToggle?.nextElementSibling).toBe(replacement);
  });
  /** A parent with one delegated child, expanded so the child is a row codexhost draws. */
  function expandedChild(options: { childMounted?: boolean; childActive?: boolean } = {}) {
    const harness = createHarness();
    const list = document.createElement("div");
    document.body.append(list);
    const parent = makeListRow(list, "parent", "Parent");
    const child = makeListRow(list, "child-1", "Child");
    const pressed: string[] = [];
    const holder = document.createElement("div");
    for (const label of ["Pin chat", "Archive chat"]) {
      const button = document.createElement("button");
      button.setAttribute("aria-label", label);
      button.innerHTML = '<svg viewBox="0 0 16 16"><path d="M2 2h12"/></svg>';
      button.addEventListener("click", () => pressed.push(label));
      holder.append(button);
    }
    const main = document.createElement("button");
    main.setAttribute("data-interactive-row-button", "");
    main.setAttribute("aria-label", "Child");
    main.innerHTML = '<svg viewBox="0 0 16 16"></svg>';
    child.row.element.append(main, holder);
    if (options.childActive)
      child.row.element.setAttribute("data-app-action-sidebar-thread-active", "true");
    harness.setRows(options.childMounted === false ? [parent.row] : [parent.row, child.row]);
    harness.setTree({
      revision: 1,
      truncated: false,
      parents: { "child-1": "parent" },
      nodes: {
        parent: makeNode(CODEX, "idle", "Parent"),
        "child-1": makeNode(PI, "running", "Child"),
      },
    });
    if (!options.childActive)
      must(
        parent.row.element.querySelector<HTMLElement>(
          `[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}="parent"]`,
        ),
        "tree toggle",
      ).click();
    const drawn = must(
      parent.item.querySelector<HTMLElement>(`[${SIDEBAR_TREE_NODE_ATTRIBUTE}="child-1"]`),
      "drawn child row",
    );
    return { harness, parent, child, drawn, pressed };
  }

  it("offers a drawn row its Thread's own pin and archive, pressing Desktop's buttons", () => {
    const { harness, drawn, pressed } = expandedChild();
    expect(drawn.querySelector(`.${SIDEBAR_TREE_ACTIONS_CLASS}`)).toBeNull();

    drawn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const mirrored = [
      ...drawn.querySelectorAll<HTMLButtonElement>(`[${SIDEBAR_TREE_ACTION_ATTRIBUTE}]`),
    ];
    expect(mirrored.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Pin chat",
      "Archive chat",
    ]);
    expect(mirrored.every((button) => button.querySelector("svg") !== null)).toBe(true);

    must(mirrored[1], "archive").click();
    expect(pressed).toEqual(["Archive chat"]);
    expect(harness.openThread).not.toHaveBeenCalled();
  });

  it("opens Desktop's own menu of the drawn row's Thread, at the pointer", () => {
    const { parent, child, drawn } = expandedChild();
    const menus: { target: EventTarget | null; x: number; y: number }[] = [];
    child.row.element.addEventListener("contextmenu", (event) =>
      menus.push({ target: event.target, x: event.clientX, y: event.clientY }),
    );
    const elsewhere: string[] = [];
    parent.row.element.addEventListener("contextmenu", () => elsewhere.push("parent row"));
    parent.item.addEventListener("contextmenu", () => elsewhere.push("parent item"));

    const press = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 340,
      button: 2,
    });
    must(drawn.querySelector(".cxh-tree-title"), "drawn title").dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
    expect(menus).toEqual([{ target: child.row.element, x: 120, y: 340 }]);
    expect(elsewhere).toEqual([]);
  });

  /**
   * Desktop's main view: the Composer names the open Thread, and the header toolbar has the
   * button that opens that Thread's own menu.
   */
  function mainView(openThreadId: string) {
    const composer = document.createElement("div");
    composer.setAttribute("data-above-composer-conversation-id", openThreadId);
    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-app-shell-header-toolbar", "true");
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-label", "Chat actions");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    toolbar.append(trigger);
    document.body.append(toolbar, composer);
    const keys: { key: string; openThread: string | null }[] = [];
    trigger.addEventListener("keydown", (event) =>
      keys.push({
        key: event.key,
        openThread: composer.getAttribute("data-above-composer-conversation-id"),
      }),
    );
    return { composer, trigger, keys };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

  it("offers Desktop's own menu for a Thread whose Desktop row is not mounted", async () => {
    const { harness, drawn } = expandedChild({ childMounted: false });
    const view = mainView("parent");
    harness.openThread.mockImplementation(async (threadId) => {
      view.composer.setAttribute("data-above-composer-conversation-id", threadId);
    });

    drawn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const buttons = [
      ...drawn.querySelectorAll<HTMLButtonElement>(`.${SIDEBAR_TREE_ACTIONS_CLASS} button`),
    ];
    expect(buttons).toHaveLength(1);
    const menu = must(buttons[0], "menu button");
    expect(menu.hasAttribute(SIDEBAR_TREE_MENU_ATTRIBUTE)).toBe(true);
    expect(menu.getAttribute("aria-label")).toBe("Chat actions");
    expect(menu.querySelector("svg")).not.toBeNull();

    menu.click();
    expect(harness.openThread).toHaveBeenCalledWith("child-1");
    await settle();
    // The menu opens only once the main view shows the Thread it is for.
    expect(view.keys).toEqual([{ key: "ArrowDown", openThread: "child-1" }]);
    expect(document.activeElement).toBe(view.trigger);
  });

  it("opens Desktop's own menu on a right-click of a Thread without a Desktop row", async () => {
    const { harness, drawn } = expandedChild({ childMounted: false });
    const view = mainView("child-1");

    const press = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    must(drawn.querySelector(".cxh-tree-title"), "drawn title").dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    await settle();
    // The Thread is already open, so it is not opened again.
    expect(harness.openThread).not.toHaveBeenCalled();
    expect(view.keys).toEqual([{ key: "ArrowDown", openThread: "child-1" }]);
  });

  it("finds the open Thread by its Composer's place when Desktop hides the empty portal", async () => {
    const { harness, drawn, parent } = expandedChild({ childMounted: false });
    // Desktop keeps the Composer of an earlier view, hidden further up, next to the open one.
    const earlier = mainView("parent");
    earlier.trigger.closest("[data-app-shell-header-toolbar]")?.remove();
    const shownView = mainView("child-1");
    const place = document.createElement("div");
    shownView.composer.replaceWith(place);
    place.append(shownView.composer);
    Object.defineProperty(place, "getClientRects", { value: () => [new DOMRect(0, 0, 600, 40)] });

    drawn.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await settle();
    expect(harness.openThread).not.toHaveBeenCalled();
    expect(shownView.keys).toEqual([{ key: "ArrowDown", openThread: "child-1" }]);
    // The open Thread's drawn row is marked as the open one, as Desktop marks its own rows.
    const row = parent.item.querySelector(`[${SIDEBAR_TREE_NODE_ATTRIBUTE}="child-1"]`);
    expect(row?.getAttribute("aria-current")).toBe("page");
  });

  it("never opens the menu while the main view shows another Thread", async () => {
    const { harness, drawn } = expandedChild({ childMounted: false });
    const view = mainView("parent");
    // Opening fails to show the Thread, as when Desktop cannot open it.
    harness.openThread.mockImplementation(async () => undefined);

    drawn.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await settle();
    expect(harness.openThread).toHaveBeenCalledWith("child-1");
    expect(view.keys).toEqual([]);
  });

  it("keeps Desktop's row menu for a Thread whose Desktop row is mounted", async () => {
    const { harness, child, drawn } = expandedChild();
    const view = mainView("parent");
    const menus: EventTarget[] = [];
    child.row.element.addEventListener("contextmenu", (event) => {
      if (event.target) menus.push(event.target);
    });

    drawn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(drawn.querySelector(`[${SIDEBAR_TREE_MENU_ATTRIBUTE}]`)).toBeNull();
    expect(drawn.querySelectorAll(`[${SIDEBAR_TREE_ACTION_ATTRIBUTE}]`)).toHaveLength(2);
    drawn.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await settle();
    expect(menus).toEqual([child.row.element]);
    expect(harness.openThread).not.toHaveBeenCalled();
    expect(view.keys).toEqual([]);
  });

  it("renames the open Thread on a title double-click, as its Desktop row does", () => {
    const { child, drawn } = expandedChild({ childActive: true });
    expect(drawn.getAttribute("aria-current")).toBe("page");
    const renames: EventTarget[] = [];
    const nativeTitle = must(
      child.row.element.querySelector("[data-thread-title]"),
      "native title",
    );
    child.row.element.addEventListener("dblclick", (event) => {
      if (event.target) renames.push(event.target);
    });

    must(drawn.querySelector(".cxh-tree-title"), "drawn title").dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }),
    );
    expect(renames).toEqual([nativeTitle]);
  });
  it("leaves out a delegated Thread that no longer exists, not one that is unread or elsewhere", () => {
    const harness = createHarness();
    const list = document.createElement("div");
    document.body.append(list);
    const parent = makeListRow(list, "parent", "Parent");
    const unread = makeListRow(list, "child-unread", "Unread child");
    harness.setRows([parent.row, unread.row]);
    harness.setTree({
      revision: 1,
      truncated: false,
      parents: {
        "child-deleted": "parent",
        grandchild: "child-deleted",
        "child-elsewhere": "parent",
        "child-unread": "parent",
      },
      nodes: {
        parent: makeNode(CODEX, "idle", "Parent"),
        // Deleted: the Host still lists it, unreadable, with no title and no Desktop row.
        "child-deleted": { harnessId: CODEX, status: "unknown", archived: false },
        grandchild: makeNode(CODEX, "idle", "Below the deleted one"),
        // In another project: no Desktop row in this list, but the Host knows its title.
        "child-elsewhere": makeNode(PI, "unknown", "Child in another project"),
        // Not read by the Host yet, but Desktop has its row.
        "child-unread": { harnessId: CODEX, status: "unknown", archived: false },
      },
    });

    const summary = parent.item.querySelector(`[${SIDEBAR_TREE_EXPAND_ATTRIBUTE}="parent"]`);
    expect(summary?.textContent).toBe("2 child sessions");
    must(
      parent.row.element.querySelector<HTMLElement>(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}="parent"]`),
      "tree toggle",
    ).click();
    const shown = [...parent.item.querySelectorAll(`[${SIDEBAR_TREE_NODE_ATTRIBUTE}]`)].map((row) =>
      row.getAttribute(SIDEBAR_TREE_NODE_ATTRIBUTE),
    );
    expect(shown.sort()).toEqual(["child-elsewhere", "child-unread"]);
  });
});

describe("context handoffs on Desktop", () => {
  const CLAUDE = harnessIdSchema.parse("claude-code");

  async function settle(): Promise<void> {
    for (let index = 0; index < 4; index += 1) await new Promise((done) => setTimeout(done, 20));
  }

  function sidebar(): HTMLElement {
    const scroll = document.createElement("div");
    scroll.setAttribute("data-app-action-sidebar-scroll", "");
    const list = document.createElement("div");
    scroll.append(list);
    document.body.append(scroll);
    return list;
  }

  it("keeps the Thread that received context on its row and the older one right after it, joined by the rail", async () => {
    document.documentElement.lang = "zh-CN";
    const invoke = vi.fn(async () => ({
      links: [{ target: "claude", source: "codex", at: 5 }],
      threads: { codex: { title: "评估第三方支付 SDK", agent: "codex", status: "idle" } },
    }));
    const harness = createHarness({}, { invoke });
    const list = sidebar();
    const claude = makeListRow(list, "claude", "评估第三方支付 SDK", {
      agentIcon: "claude-code",
    });
    const other = makeListRow(list, "other", "整理支付接入文档", { agentIcon: "claude-code" });
    const codex = makeListRow(list, "codex", "评估第三方支付 SDK", { agentIcon: "codex" });
    harness.setRows([claude.row, other.row, codex.row]);
    harness.setTree({ revision: 1, truncated: false, parents: {}, nodes: {} });
    await settle();

    expect(invoke).toHaveBeenCalledWith(
      "handoffs",
      expect.objectContaining({ describe: expect.any(Array) }),
    );
    const group = claude.item.querySelector<HTMLElement>("[data-codexhost-sidebar-tree-handoff]");
    expect(group).not.toBeNull();
    // Without a tree of its own, the group starts the rail at the native row's icon.
    expect(group?.hasAttribute("data-handoff-head")).toBe(true);
    const moved = group?.querySelector<HTMLElement>(`[${SIDEBAR_TREE_NODE_ATTRIBUTE}="codex"]`);
    expect(moved?.closest(".cxh-tree-branch")?.getAttribute("data-handoff")).toBe("last");
    expect(moved?.textContent).toContain("评估第三方支付 SDK");
    // Same level as Desktop's rows: no indent.
    expect(
      moved?.closest<HTMLElement>(".cxh-tree-branch")?.style.getPropertyValue("--cxh-indent"),
    ).toBe("0px");
    expect(codex.item.hasAttribute("data-cx-sidebar-thread-tree-hidden")).toBe(true);
    expect(other.item.hasAttribute("data-cx-sidebar-thread-tree-hidden")).toBe(false);
    expect(claude.row.element.querySelector(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`)).toBeNull();

    must(moved, "moved row").click();
    expect(harness.openThread).toHaveBeenCalledWith("codex");
  });

  it("draws the whole group in place of the older Thread's row when that sorts first", async () => {
    const invoke = vi.fn(async () => ({
      links: [{ target: "claude", source: "codex", at: 5 }],
      threads: {},
    }));
    const harness = createHarness({}, { invoke });
    const list = sidebar();
    const codex = makeListRow(list, "codex", "Plan the run", { agentIcon: "codex" });
    const claude = makeListRow(list, "claude", "Plan the run", { agentIcon: "claude-code" });
    harness.setRows([codex.row, claude.row]);
    harness.setTree({ revision: 1, truncated: false, parents: {}, nodes: {} });
    await settle();

    expect(codex.item.hasAttribute("data-cx-sidebar-thread-tree-anchor")).toBe(true);
    const drawn = codex.item.querySelector<HTMLElement>(`[${SIDEBAR_TREE_VIRTUAL_ATTRIBUTE}]`);
    expect(drawn?.hasAttribute("data-handoff")).toBe(true);
    const places = [
      ...(drawn?.querySelectorAll<HTMLElement>(":scope > .cxh-tree-branch") ?? []),
    ].map((branch) => [
      branch
        .querySelector(`[${SIDEBAR_TREE_NODE_ATTRIBUTE}]`)
        ?.getAttribute(SIDEBAR_TREE_NODE_ATTRIBUTE),
      branch.getAttribute("data-handoff"),
    ]);
    expect(places).toEqual([
      ["claude", "first"],
      ["codex", "last"],
    ]);
    expect(claude.item.hasAttribute("data-cx-sidebar-thread-tree-hidden")).toBe(true);
  });

  it("follows a delegation tree of the first Thread and draws a Thread Desktop does not list from the backend", async () => {
    const invoke = vi.fn(async (_method: string, params?: unknown) => ({
      links: [{ target: "claude", source: "codex", at: 5 }],
      threads: (params as { describe?: string[] } | undefined)?.describe?.includes("codex")
        ? { codex: { title: "Old plan", agent: "codex", status: "running" } }
        : {},
    }));
    const harness = createHarness({}, { invoke });
    const list = sidebar();
    const claude = makeListRow(list, "claude", "New plan", { agentIcon: "claude-code" });
    const child = makeListRow(list, "child", "Sub task", { agentIcon: "codex" });
    harness.setRows([claude.row, child.row]);
    harness.setTree({
      revision: 1,
      truncated: false,
      parents: { child: "claude" },
      nodes: {
        claude: makeNode(CLAUDE, "idle", "New plan"),
        child: makeNode(CODEX, "running", "Sub task"),
      },
    });
    await settle();

    expect(invoke).toHaveBeenLastCalledWith("handoffs", { describe: ["codex"] });
    // The first Thread's own tree comes first and starts the rail; the older Thread follows.
    const summary = claude.item.querySelector<HTMLElement>(
      `[${SIDEBAR_TREE_SUMMARY_ATTRIBUTE}="claude"]`,
    );
    expect(summary?.hasAttribute("data-handoff-head")).toBe(true);
    const group = claude.item.querySelector<HTMLElement>("[data-codexhost-sidebar-tree-handoff]");
    expect(group?.hasAttribute("data-handoff-head")).toBe(false);
    expect(summary?.nextElementSibling).toBe(group);
    const drawn = group?.querySelector<HTMLElement>(`[${SIDEBAR_TREE_NODE_ATTRIBUTE}="codex"]`);
    expect(drawn?.textContent).toContain("Old plan");
    expect(drawn?.querySelector('.cxh-tree-status[data-status="running"]')).not.toBeNull();
    // A Thread without a Desktop row opens Desktop's own menu from its "…" button.
    drawn?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(drawn?.querySelector(`[${SIDEBAR_TREE_MENU_ATTRIBUTE}]`)).not.toBeNull();

    harness.dispose();
    expect(claude.item.querySelector("[data-codexhost-sidebar-tree-handoff]")).toBeNull();
  });
});
