import type {
  DesktopExtensionApiV1,
  DesktopSidebarRow,
  ThreadTreeNode,
  ThreadTreeSnapshot,
  ThreadTreeStatus,
} from "@codexhost/shared-contracts";
import {
  SIDEBAR_TREE_OWNED_SELECTOR,
  canRenderSidebarThreadTree,
  clearSidebarThreadTree,
  clearSidebarThreadTreeRow,
  measureSidebarThreadTreeRows,
  renderSidebarThreadTreeRoot,
  renderSidebarThreadTreeVirtual,
  setSidebarThreadTreeRowHidden,
  type SidebarHarnessIcon,
  type SidebarThreadTreeDisplay,
  type SidebarThreadTreeHandlers,
  type SidebarThreadTreeLabels,
  type SidebarThreadTreeView,
} from "./dom.js";
import {
  cancelSidebarThreadTreeMotion,
  captureSidebarThreadTreeMotion,
  playSidebarThreadTreeMotion,
} from "./motion.js";
import {
  planSidebarThreadTree,
  type SidebarThreadTreeRoot,
  type SidebarThreadTreeRowInput,
  type SidebarThreadTreeRowPlan,
  type SidebarThreadTreeStatus,
  type SidebarThreadTreeThread,
} from "./tree.js";

/**
 * Shows the Threads a sidebar Thread delegated under it, as the Web sidebar tree does.
 *
 * The parent relation and Thread states come from `api.threads.watchTree`, and mounted sidebar
 * rows come from `api.sidebar.observeRows`. Rows of other Hosts are untouched.
 */

const SIDEBAR_SELECTOR = "[data-app-action-sidebar-scroll]";
const AGENT_ICON_ATTRIBUTE = "data-codexhost-sidebar-agent-icon";
const ACTIVE_ATTRIBUTE = "data-app-action-sidebar-thread-active";
const TITLE_ATTRIBUTE = "data-app-action-sidebar-thread-title";
/** Desktop marks the Composer of the open Thread with its id. */
const COMPOSER_THREAD_ATTRIBUTE = "data-above-composer-conversation-id";
/** Nodes whose arrival or removal changes what the tree shows. */
const WATCHED_SELECTOR = `${SIDEBAR_SELECTOR}, [${COMPOSER_THREAD_ATTRIBUTE}]`;
/**
 * The button in Desktop's header that opens the open Thread's own menu (rename, pin, archive,
 * delete). It is the only menu button of the header toolbar.
 */
const HEADER_MENU_SELECTOR = '[data-app-shell-header-toolbar] button[aria-haspopup="menu"]';
/** How long the main view may take to show a Thread opened for its menu. */
const MENU_WAIT_MS = 5000;
const MENU_POLL_MS = 50;
/** Consecutive checks the Thread must stay alone in the main view before its menu is opened. */
const MENU_SETTLE_CHECKS = 2;
const MAX_REMEMBERED_EXPANDED = 500;
const PLAIN: SidebarThreadTreeRowPlan = { kind: "plain" };
export const SIDEBAR_THREAD_TREE_EXPANDED_KEY = "codexhost.sidebar-thread-tree.expanded.v1";

export type SidebarTreeLocale = "en" | "zh-CN";

/** The wording of the Web sidebar tree. */
export function sidebarThreadTreeLabels(locale: SidebarTreeLocale): SidebarThreadTreeLabels {
  const chinese = locale === "zh-CN";
  return {
    expand: (count) => (chinese ? `展开 ${count} 个子会话` : `Expand ${count} child sessions`),
    collapse: (count) => (chinese ? `收起 ${count} 个子会话` : `Collapse ${count} child sessions`),
    status: (status) =>
      status === "pending"
        ? chinese
          ? "等待处理"
          : "Waiting for you"
        : status === "running"
          ? chinese
            ? "正在运行"
            : "Running"
          : status === "unknown"
            ? chinese
              ? "状态未知"
              : "Unknown"
            : "",
    children: (count) => (chinese ? `${count} 个子会话` : `${count} child sessions`),
    running: (count) => (chinese ? `${count} 运行中` : `${count} running`),
    pending: (count) => (chinese ? `${count} 待批准` : `${count} needs approval`),
    expandSummary: (title, summary) =>
      chinese ? `${title}，${summary}，展开` : `${title}, ${summary}, expand`,
    // Desktop's own name for the menu it opens.
    actions: chinese ? "聊天操作" : "Chat actions",
  };
}

export interface ExpandedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SidebarThreadTreeOptions {
  /** Whether Desktop lays out a row's list; a collapsed project keeps its rows mounted. */
  isRowListVisible?(row: HTMLElement): boolean;
  storage?: ExpandedStorage | null;
  root?: Document;
}

function readExpanded(storage: ExpandedStorage | null): Set<string> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(SIDEBAR_THREAD_TREE_EXPANDED_KEY) ?? "[]");
    if (Array.isArray(value))
      return new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    // An unreadable preference starts collapsed.
  }
  return new Set();
}

function detectLocale(doc: Document): SidebarTreeLocale {
  const lang = doc.documentElement.lang.trim() || doc.defaultView?.navigator.language || "";
  return /^zh\b/iu.test(lang) ? "zh-CN" : "en";
}

/**
 * Whether a Thread in the tree no longer exists. The Host keeps the delegation of a deleted
 * Thread and still lists it, but cannot read it: its status is unknown, it has no title, and
 * Desktop has no row for it. Such a row could not be opened or acted on, so it is left out.
 * A Thread the Host has not read yet looks the same but usually has a Desktop row; it shows once
 * the Host reads it.
 */
function isDeleted(
  threadId: string,
  node: ThreadTreeNode,
  rows: ReadonlyMap<string, readonly HTMLElement[]>,
): boolean {
  return node.status === "unknown" && !node.title?.trim() && !rows.has(threadId);
}

function mapTreeStatus(status: ThreadTreeStatus): SidebarThreadTreeStatus {
  if (status === "waiting") return "pending";
  if (status === "running") return "running";
  if (status === "unknown") return "unknown";
  return "idle";
}

function defaultIsRowListVisible(row: HTMLElement): boolean {
  const list = row.closest('[role="listitem"]')?.parentElement;
  if (!list) return false;
  if (list.getClientRects().length > 0) return true;
  // In non-layout environments (e.g. jsdom), no element reports client rects unless mocked.
  const doc = row.ownerDocument;
  return (doc.body ?? doc.documentElement).getClientRects().length === 0;
}

function collectSampledIcons(rows: readonly DesktopSidebarRow[]): Map<string, Element> {
  const icons = new Map<string, Element>();
  for (const row of rows) {
    if (!row.isConnected()) continue;
    const host = row.element.querySelector<HTMLElement>(`[${AGENT_ICON_ATTRIBUTE}]`);
    if (!host) continue;
    const harnessId = host.getAttribute(AGENT_ICON_ATTRIBUTE);
    if (!harnessId || icons.has(harnessId)) continue;
    const graphic = host.querySelector(":scope > img, :scope > svg");
    if (graphic) icons.set(harnessId, graphic);
  }
  return icons;
}

function iconSignature(sampled: Element | undefined, iconUrl: string | undefined): string {
  if (sampled) {
    const tag = sampled.tagName.toLowerCase();
    if (tag === "img") {
      const img = sampled as HTMLImageElement;
      return `img:${img.getAttribute("src") ?? ""}:${img.style.borderRadius}:${img.style.background}:${img.style.padding}`;
    }
    if (tag === "svg") return `svg:${sampled.innerHTML}`;
  }
  if (iconUrl) return `url:${iconUrl}`;
  return "fallback";
}

/** A local Thread row Desktop has mounted. */
interface MountedRow {
  element: HTMLElement;
  threadId: string;
}

export function activate(
  api: DesktopExtensionApiV1,
  options: SidebarThreadTreeOptions = {},
): () => void {
  const root = options.root ?? document;
  const view = root.defaultView ?? window;
  const storage =
    options.storage !== undefined
      ? options.storage
      : (() => {
          try {
            return view.localStorage;
          } catch {
            return null;
          }
        })();
  const isRowListVisible = options.isRowListVisible ?? defaultIsRowListVisible;

  let disposed = false;
  let observedRows: readonly DesktopSidebarRow[] = [];
  let snapshot: ThreadTreeSnapshot | undefined;
  const expanded = readExpanded(storage);
  /** The open Thread whose ancestors were already expanded for it. */
  let expandedForThreadId: string | null = null;
  let applyScheduled = false;
  let rafId: number | undefined;
  const listIds = new WeakMap<Element, string>();
  let nextListId = 0;
  let lastTouchedRows = new Set<HTMLElement>();

  const saveExpanded = (): void => {
    try {
      storage?.setItem(
        SIDEBAR_THREAD_TREE_EXPANDED_KEY,
        JSON.stringify([...expanded].slice(-MAX_REMEMBERED_EXPANDED)),
      );
    } catch {
      // The choice still holds for this window.
    }
  };

  const localMountedRows = (): {
    mounted: MountedRow[];
    sharedItems: Set<HTMLElement>;
  } => {
    const itemCounts = new Map<HTMLElement, number>();
    for (const row of observedRows) {
      if (!row.isConnected()) continue;
      const item = row.element.closest<HTMLElement>('[role="listitem"]');
      if (item) itemCounts.set(item, (itemCounts.get(item) ?? 0) + 1);
    }
    const sharedItems = new Set<HTMLElement>();
    for (const [item, count] of itemCounts) {
      if (count !== 1) sharedItems.add(item);
    }
    const mounted: MountedRow[] = [];
    for (const row of observedRows) {
      if (!row.isLocal || !row.threadId || !row.isConnected()) continue;
      mounted.push({ element: row.element, threadId: row.threadId });
    }
    return { mounted, sharedItems };
  };

  const byThread = (rows: readonly MountedRow[]): Map<string, HTMLElement[]> => {
    const map = new Map<string, HTMLElement[]>();
    for (const { element, threadId } of rows) {
      const list = map.get(threadId);
      if (list) list.push(element);
      else map.set(threadId, [element]);
    }
    return map;
  };

  /** The sidebar list a row belongs to; each list shows a tree once. */
  const listOf = (row: HTMLElement): string => {
    const list = row.closest('[role="listitem"]')?.parentElement ?? row;
    let id = listIds.get(list);
    if (id === undefined) listIds.set(list, (id = String((nextListId += 1))));
    return id;
  };

  const navigate = (threadId: string): void => {
    void api.navigate.openThread(threadId).catch((error: unknown) => {
      if (!api.signal.aborted) console.warn("codexhost could not open the delegated Thread", error);
    });
  };

  /** The Threads whose Composer the main view shows; Desktop shows one at a time. */
  const composerThreadIds = (): Set<string> => {
    const shown = new Set<string>();
    const all = new Set<string>();
    for (const portal of root.querySelectorAll(`[${COMPOSER_THREAD_ATTRIBUTE}]`)) {
      const threadId = portal.getAttribute(COMPOSER_THREAD_ATTRIBUTE);
      if (!threadId) continue;
      all.add(threadId);
      // Desktop hides the portal itself while nothing sits above the Composer, and hides the
      // Composers of earlier views further up, so a shown Composer has the portal's place laid out.
      if (
        portal.getClientRects().length > 0 ||
        (portal.parentElement?.getClientRects().length ?? 0) > 0
      )
        shown.add(threadId);
    }
    // A hidden Composer of an earlier view may still name its own Thread.
    return shown.size > 0 ? shown : all;
  };

  /** The open Thread: the Composer names it even when it has no sidebar row. */
  const openThreadId = (rows: ReadonlyMap<string, HTMLElement[]>): string | null => {
    const composers = composerThreadIds();
    if (composers.size === 1) return [...composers][0] ?? null;
    for (const [threadId, list] of rows) {
      if (list.some((row) => row.getAttribute(ACTIVE_ATTRIBUTE) === "true")) return threadId;
    }
    return null;
  };

  const cancelScheduledApply = (): void => {
    if (!applyScheduled) return;
    applyScheduled = false;
    if (rafId !== undefined && typeof view.cancelAnimationFrame === "function") {
      view.cancelAnimationFrame(rafId);
      rafId = undefined;
    }
  };

  const toggle = (threadId: string, source: Element): void => {
    if (disposed || api.signal.aborted) return;
    const item = source.closest<HTMLElement>('[role="listitem"]');
    const motion = item ? captureSidebarThreadTreeMotion(item) : null;
    if (expanded.has(threadId)) expanded.delete(threadId);
    else expanded.add(threadId);
    saveExpanded();
    // Laid out now, so the motion can start from the positions just recorded.
    apply();
    if (motion) {
      playSidebarThreadTreeMotion(motion, (overlay, viewport) =>
        api.dom.mount(overlay, viewport, "append"),
      );
    }
  };

  /** Each Thread's mounted Desktop rows, as of the latest pass. */
  let nativeRows = new Map<string, HTMLElement[]>();
  const nativeRow = (threadId: string): HTMLElement | null =>
    nativeRows.get(threadId)?.find((element) => element.isConnected) ?? null;

  /** Desktop's menu button for `threadId`, once the main view shows that Thread alone. */
  const headerMenuOf = (threadId: string): HTMLElement | null => {
    const composers = composerThreadIds();
    if (composers.size !== 1 || !composers.has(threadId)) return null;
    const triggers = [...root.querySelectorAll<HTMLElement>(HEADER_MENU_SELECTOR)];
    const shown = triggers.filter((trigger) => trigger.getClientRects().length > 0);
    const candidates = shown.length > 0 ? shown : triggers;
    const trigger = candidates.length === 1 ? candidates[0] : undefined;
    if (!trigger || trigger.matches(":disabled") || trigger.getAttribute("aria-disabled") === "true")
      return null;
    return trigger;
  };

  let menuRequest = 0;
  /**
   * Opens Desktop's own menu of a Thread that has no Desktop row. Desktop offers such a Thread's
   * actions only in its header, so the Thread is opened first; once the main view has shown it
   * alone for a moment, Desktop's header menu opens. If the Thread does not show in time, or the
   * user asks for another menu meanwhile, nothing opens, so the menu never acts on another Thread.
   */
  const openMenu = (threadId: string): void => {
    if (disposed || api.signal.aborted) return;
    const request = (menuRequest += 1);
    const current = (): boolean => !disposed && !api.signal.aborted && request === menuRequest;
    void (async () => {
      const composers = composerThreadIds();
      if (composers.size !== 1 || !composers.has(threadId)) await api.navigate.openThread(threadId);
      const deadline = Date.now() + MENU_WAIT_MS;
      let trigger: HTMLElement | null = null;
      let settled = 0;
      while (current() && settled < MENU_SETTLE_CHECKS && Date.now() < deadline) {
        await new Promise((resolve) => view.setTimeout(resolve, MENU_POLL_MS));
        const found = headerMenuOf(threadId);
        settled = found !== null && found === trigger ? settled + 1 : found ? 1 : 0;
        trigger = found;
      }
      if (!current() || !trigger || settled < MENU_SETTLE_CHECKS || !trigger.isConnected) return;
      if (trigger.getAttribute("aria-expanded") === "true") return;
      trigger.focus({ preventScroll: true });
      // Desktop opens the menu from the keyboard as from a press, with focus on its first item.
      trigger.dispatchEvent(
        new view.KeyboardEvent("keydown", {
          key: "ArrowDown",
          code: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    })().catch((error: unknown) => {
      if (!api.signal.aborted) console.warn("codexhost could not open the Thread's menu", error);
    });
  };

  // A row press only opens: on the Web it also folds the open Thread, but on Desktop the first
  // press of a double-click on the open row's title is the start of a rename.
  const handlers: SidebarThreadTreeHandlers = {
    toggle,
    open: navigate,
    native: nativeRow,
    menu: openMenu,
  };

  const apply = (): void => {
    cancelScheduledApply();
    if (disposed || api.signal.aborted || !snapshot) return;

    const parents: Readonly<Record<string, string>> = snapshot.parents;
    const nodes: Readonly<Record<string, ThreadTreeNode>> = snapshot.nodes;
    const { mounted, sharedItems } = localMountedRows();
    const rows = byThread(mounted);
    nativeRows = rows;
    const sampledIcons = collectSampledIcons(observedRows);

    const current = openThreadId(rows);
    // Opening a Thread expands its ancestors once; they can be collapsed again afterwards.
    // The Thread stays pending until the tree places it: it may be open before the tree is read.
    if (current === null || !Object.hasOwn(parents, current)) expandedForThreadId = null;
    else if (current !== expandedForThreadId) {
      expandedForThreadId = current;
      let changed = false;
      const seen = new Set<string>([current]);
      for (
        let parentId: string | undefined = parents[current];
        parentId !== undefined && !seen.has(parentId);
        parentId = Object.hasOwn(parents, parentId) ? parents[parentId] : undefined
      ) {
        seen.add(parentId);
        if (!expanded.has(parentId)) {
          expanded.add(parentId);
          changed = true;
        }
      }
      if (changed) saveExpanded();
    }

    // Rows of collapsed lists are left to Desktop until they are shown again.
    const planned: (MountedRow & SidebarThreadTreeRowInput & { renderable: boolean })[] = [];
    for (const row of mounted) {
      if (!isRowListVisible(row.element)) continue;
      const item = row.element.closest<HTMLElement>('[role="listitem"]');
      const renderable =
        item !== null &&
        item !== row.element &&
        item.parentElement !== null &&
        !sharedItems.has(item) &&
        canRenderSidebarThreadTree(row.element);
      planned.push({
        ...row,
        key: String(planned.length),
        list: listOf(row.element),
        renderable,
      });
    }

    const threads = new Map<string, SidebarThreadTreeThread>();
    for (const [threadId, node] of Object.entries(nodes)) {
      threads.set(threadId, {
        status: mapTreeStatus(node.status),
        archived: node.archived,
        deleted: isDeleted(threadId, node, rows),
        order: 0,
      });
    }
    const plans = planSidebarThreadTree({
      parents,
      threads,
      rows: planned,
      expanded: (threadId) => expanded.has(threadId),
    });
    // A tree whose place is a row it cannot be attached to shows nothing in that list, so
    // nothing may be hidden for it there.
    const broken = new Set<string>();
    for (const row of planned) {
      const plan = plans.get(row.key);
      if (!row.renderable && (plan?.kind === "root" || plan?.kind === "virtual"))
        broken.add(`${row.list}\u0000${plan.tree.threadId}`);
    }

    const harnessInfo = (harnessId: string): SidebarHarnessIcon => {
      const described = api.harnesses.describe(harnessId);
      const name = described?.name ?? (harnessId === "codex" ? "Codex" : harnessId);
      const sampled = sampledIcons.get(harnessId);
      const iconUrl = described?.icon;
      return {
        name,
        ...(iconUrl ? { iconUrl } : {}),
        ...(sampled ? { sampled } : {}),
        signature: `${harnessId}|${name}|${iconSignature(sampled, iconUrl)}`,
      };
    };

    const nativeTitle = (threadId: string): string | undefined =>
      rows.get(threadId)?.[0]?.getAttribute(TITLE_ATTRIBUTE)?.trim() || undefined;
    const display = (threadId: string): SidebarThreadTreeDisplay => {
      const node = Object.hasOwn(nodes, threadId) ? nodes[threadId] : undefined;
      const harnessId = node?.harnessId ?? "codex";
      const harness = harnessInfo(harnessId);
      return {
        title: nativeTitle(threadId) ?? (node?.title?.trim() || undefined) ?? harness.name,
        agent: harnessId,
        harness,
        current: threadId === current,
      };
    };
    const viewOf = (tree: SidebarThreadTreeRoot): SidebarThreadTreeView => ({
      ...tree,
      nodes: tree.nodes.map((node) => ({ ...node, ...display(node.threadId) })),
      root: display(tree.threadId),
    });
    const locale = detectLocale(root);
    const labels = sidebarThreadTreeLabels(locale);

    const resolved = planned.map((row) => {
      const plan = plans.get(row.key) ?? PLAIN;
      return !row.renderable ||
        (plan.kind === "hidden" && broken.has(`${row.list}\u0000${plan.rootId}`))
        ? { row, plan: PLAIN }
        : { row, plan };
    });
    // Every list that shows a tree is measured before anything is written.
    measureSidebarThreadTreeRows(
      api.id,
      resolved
        .filter(({ plan }) => plan.kind === "root" || plan.kind === "virtual")
        .map(({ row }) => row.element),
    );

    const touched = new Set<HTMLElement>();
    for (const { row, plan } of resolved) {
      touched.add(row.element);
      if (plan.kind === "root" || plan.kind === "virtual") {
        setSidebarThreadTreeRowHidden(api, row.element, false);
        const render =
          plan.kind === "root" ? renderSidebarThreadTreeRoot : renderSidebarThreadTreeVirtual;
        render(api, row.element, viewOf(plan.tree), labels, handlers, locale);
        continue;
      }
      clearSidebarThreadTreeRow(api, row.element);
      setSidebarThreadTreeRowHidden(api, row.element, plan.kind === "hidden");
    }
    for (const { element } of mounted) {
      if (touched.has(element)) continue;
      clearSidebarThreadTreeRow(api, element);
      setSidebarThreadTreeRowHidden(api, element, false);
    }
    for (const previous of lastTouchedRows) {
      if (touched.has(previous) || !previous.isConnected) continue;
      clearSidebarThreadTreeRow(api, previous);
      setSidebarThreadTreeRowHidden(api, previous, false);
    }
    lastTouchedRows = touched;
  };

  const scheduleApply = (): void => {
    if (disposed || api.signal.aborted || applyScheduled) return;
    applyScheduled = true;
    if (typeof view.requestAnimationFrame === "function") {
      rafId = view.requestAnimationFrame(() => {
        rafId = undefined;
        apply();
      });
    } else {
      queueMicrotask(apply);
    }
  };

  const ObserverCtor = view.MutationObserver ?? globalThis.MutationObserver;
  const observer = ObserverCtor
    ? new ObserverCtor((mutations) => {
        if (disposed || api.signal.aborted) return;
        for (const mutation of mutations) {
          const target =
            mutation.target instanceof view.Element
              ? mutation.target
              : mutation.target.parentElement;
          if (!target) continue;
          // The module's own nodes must not start another pass.
          if (target.closest(SIDEBAR_TREE_OWNED_SELECTOR)) continue;
          if (mutation.attributeName === COMPOSER_THREAD_ATTRIBUTE) {
            scheduleApply();
            return;
          }
          const touchesSidebar =
            target.closest(SIDEBAR_SELECTOR) !== null ||
            target.closest('[role="listitem"]') !== null ||
            [...mutation.addedNodes, ...mutation.removedNodes].some(
              (node) =>
                node instanceof view.Element &&
                !node.matches(SIDEBAR_TREE_OWNED_SELECTOR) &&
                (node.matches(WATCHED_SELECTOR) || node.querySelector(WATCHED_SELECTOR) !== null),
            );
          if (!touchesSidebar) continue;
          if (
            mutation.type === "childList" &&
            [...mutation.addedNodes, ...mutation.removedNodes].every(
              (node) => node instanceof view.Element && node.matches(SIDEBAR_TREE_OWNED_SELECTOR),
            )
          )
            continue;
          scheduleApply();
          return;
        }
      })
    : null;

  observer?.observe(root.documentElement, {
    attributes: true,
    attributeFilter: [
      ACTIVE_ATTRIBUTE,
      TITLE_ATTRIBUTE,
      COMPOSER_THREAD_ATTRIBUTE,
      AGENT_ICON_ATTRIBUTE,
      "data-app-action-sidebar-project-collapsed",
      "data-app-action-sidebar-section-collapsed",
    ],
    childList: true,
    subtree: true,
  });

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    cancelScheduledApply();
    observer?.disconnect();
    clearSidebarThreadTree(api, root);
    lastTouchedRows.clear();
  };

  api.track(() => {
    cancelScheduledApply();
    observer?.disconnect();
    cancelSidebarThreadTreeMotion();
  });

  api.sidebar.observeRows((current) => {
    observedRows = current;
    apply();
  });
  api.threads.watchTree((current) => {
    snapshot = current;
    apply();
  });

  return cleanup;
}
