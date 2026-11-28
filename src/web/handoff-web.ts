import type { WebExtensionApi, WebExtensionMount } from "@codexhost/shared-contracts";
import {
  HandoffSource,
  handoffChains,
  handoffMembers,
  handoffRail,
  type HandoffThreadInfo,
} from "../handoff.js";

/**
 * Context handoffs in codexhost Web's sidebar.
 *
 * Web draws the delegation tree itself. This keeps Threads that continue one another after a
 * context handoff next to each other in each sidebar list, as on Desktop: where the topmost of
 * them stands, the Thread that received context most recently first, every one at its own level,
 * joined on their left by the tree guides' line.
 *
 * Web's rows are never moved. When the first Thread's own row is the topmost, it stays where it
 * is and the others follow inside its branch; otherwise the topmost branch shows the whole group
 * instead of its own content. A Thread whose row Web shows elsewhere in the list is hidden there
 * and mirrored in the group: the mirror is rebuilt whenever Web changes the row, and a press, a
 * secondary press or a press on one of its buttons goes to Web's own row. A Thread Web shows
 * nowhere in the list (for example beyond "Show more") gets a row drawn after Web's rows from
 * what the backend says of it; selecting it opens that Thread.
 */

const BRANCH_SELECTOR = "[data-thread-branch]";
const ROW_SELECTOR = "[data-row-key]";
const ICON_SELECTOR = "[data-harness-id]";
const TITLE_SELECTOR = "[data-session-title]";
const SUMMARY_SELECTOR = "[data-thread-summary]";
const LEADING_SLOT_SELECTOR = '[data-slot="sidebar.session.row.leading"]';
const MOUNT_ATTRIBUTE = "data-cx-web-ext-mount";
const MOUNT_SELECTOR = `[${MOUNT_ATTRIBUTE}]`;
const SIDEBAR_REGION_SELECTOR = '[data-cx-region="sidebar"]';
/** Mirrors keep Web's row key under this name, so Web's keyboard and motion code skip them. */
const MIRROR_KEY_ATTRIBUTE = "data-cxh-row-key";
const GROUP_CLASS = "cxh-handoff";
const UNIT_CLASS = "cxh-handoff-unit";
const RAIL_ATTRIBUTE = "data-handoff";
const ROW_GAP_PX = 2;
/** Web's sidebar agent icons (`SessionHarnessIcon`). */
const ICON_PX = 14;

type Mark = "hidden" | "anchor";

interface Unit {
  threadId: string;
  /** Web's branch of this Thread in the list; none when Web does not show it there. */
  native: HTMLElement | null;
}

interface Group {
  key: string;
  host: HTMLElement;
  mode: "root" | "virtual";
  mount: WebExtensionMount;
  /** The rendered wrapper of each unit, by its Thread. */
  wrappers: Map<string, HTMLElement>;
  units: Unit[];
}

interface Mirror {
  observer: MutationObserver;
  /** Unique per element of Web's: Web may replace a branch with a new element. */
  id: number;
  version: number;
}

export interface WebHandoffOptions {
  root?: Document;
  now?: () => number;
}

function closestElement(target: EventTarget | null, selector: string): HTMLElement | null {
  const node = target as Node | null;
  const element = node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
  return element?.closest<HTMLElement>(selector) ?? null;
}

/** The Thread of a Web row key such as `recent:<id>` or `session:<id>`. */
export function threadIdOfRowKey(key: string | null): string | null {
  if (!key) return null;
  const colon = key.indexOf(":");
  if (colon <= 0) return null;
  const kind = key.slice(0, colon);
  if (kind === "workspace" || kind === "section" || kind === "host") return null;
  const id = key.slice(colon + 1);
  return id.trim() ? id : null;
}

/** Web's own relative time: "刚刚", "5分钟", "3小时"… or "now", "5min", "3h"… */
export function webTimeLabel(at: number, now: number, chinese: boolean): string {
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const diff = Math.max(0, now - at);
  const unit = (n: number, zh: string, en: string) =>
    chinese ? `${String(n)}${zh}` : `${String(n)}${en}`;
  if (diff < MIN) return chinese ? "刚刚" : "now";
  if (diff < HOUR) return unit(Math.floor(diff / MIN), "分钟", "min");
  if (diff < DAY) return unit(Math.floor(diff / HOUR), "小时", "h");
  if (diff < 30 * DAY) return unit(Math.floor(diff / DAY), "天", "d");
  if (diff < 365 * DAY) return unit(Math.floor(diff / (30 * DAY)), "个月", "mo");
  return unit(Math.floor(diff / (365 * DAY)), "年", "y");
}

/** The path of child positions from `ancestor` down to `node`, or null when outside it. */
function pathFrom(ancestor: Element, node: Element): number[] | null {
  const path: number[] = [];
  for (let current: Element | null = node; current !== ancestor; current = current.parentElement) {
    if (!current?.parentElement) return null;
    path.unshift([...current.parentElement.children].indexOf(current));
  }
  return path;
}

function follow(root: Element, path: readonly number[]): Element | null {
  let current: Element | undefined = root;
  for (const index of path) {
    current = current?.children[index];
    if (!current) return null;
  }
  return current ?? null;
}

/**
 * Where `element`'s box sits as laid out, from its offsets: unlike its client rect, this leaves
 * out transforms, such as the ones Web glides moved rows with.
 */
export function layoutOffset(element: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.offsetParent as HTMLElement | null
  ) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}

/** A deep copy of Web's branch that Web's own code does not take for one of its rows. */
function mirrorOf(native: HTMLElement): HTMLElement {
  const copy = native.cloneNode(true) as HTMLElement;
  for (const mount of copy.querySelectorAll(MOUNT_SELECTOR)) mount.remove();
  for (const element of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
    for (const name of [...element.getAttributeNames()]) {
      if (name.startsWith("data-cx-ext-")) element.removeAttribute(name);
    }
    element.removeAttribute("id");
    element.removeAttribute("aria-controls");
    element.removeAttribute("draggable");
    if (element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
    const key = element.getAttribute("data-row-key");
    if (key !== null) {
      element.removeAttribute("data-row-key");
      element.setAttribute(MIRROR_KEY_ATTRIBUTE, key);
    }
  }
  return copy;
}

export function activateWebHandoffs(
  api: WebExtensionApi,
  options: WebHandoffOptions = {},
): () => void {
  const root = options.root ?? document;
  const view = root.defaultView ?? window;
  const now = options.now ?? Date.now;
  let disposed = false;
  let applyScheduled = false;
  let rafId: number | undefined;
  const groups = new Map<string, Group>();
  const mirrors = new Map<HTMLElement, Mirror>();
  const marks = new Map<Element, Mark>();
  const resizeObserver =
    typeof view.ResizeObserver === "function"
      ? new view.ResizeObserver(() => {
          scheduleApply();
        })
      : null;
  const observedHosts = new Set<HTMLElement>();

  const setMark = (element: Element, mark: Mark | null): void => {
    const current = marks.get(element);
    if (current === mark) return;
    if (current) api.dom.unmark(element, current);
    if (mark) {
      api.dom.mark(element, mark);
      marks.set(element, mark);
    } else {
      marks.delete(element);
    }
  };

  const source = new HandoffSource({
    invoke: (method, params) => api.backend.invoke(method, params),
    onChange: () => {
      scheduleApply();
    },
    visible: () => root.visibilityState !== "hidden",
    timers: view,
  });

  /** Opens a Thread as a notification click does: Web's own `codexhost/open-session` message. */
  const openSession = (threadId: string): void => {
    const container = view.navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (container && typeof container.dispatchEvent === "function") {
      container.dispatchEvent(
        new view.MessageEvent("message", {
          data: { type: "codexhost/open-session", sessionId: threadId },
        }),
      );
      return;
    }
    const url = new URL(view.location.href);
    url.searchParams.set("session", threadId);
    view.location.assign(url.href);
  };

  let nextMirrorId = 0;
  /** Changes whenever Web changes `native`, so its mirror is rebuilt. */
  const mirrorSignature = (native: HTMLElement): string => {
    let mirror = mirrors.get(native);
    if (!mirror) {
      const state: Mirror = {
        id: (nextMirrorId += 1),
        version: 0,
        observer: new view.MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === "attributes" && mutation.attributeName?.startsWith("data-cx-"))
              continue;
            const target =
              mutation.target.nodeType === 1
                ? (mutation.target as Element)
                : mutation.target.parentElement;
            if (target?.closest(MOUNT_SELECTOR)) continue;
            if (
              mutation.type === "childList" &&
              [...mutation.addedNodes, ...mutation.removedNodes].every(
                (node) => node.nodeType === 1 && (node as Element).matches(MOUNT_SELECTOR),
              )
            )
              continue;
            state.version += 1;
            scheduleApply();
            return;
          }
        }),
      };
      state.observer.observe(native, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      mirrors.set(native, state);
      mirror = state;
    }
    return `${String(mirror.id)}.${String(mirror.version)}`;
  };

  /** Sidebar rows Web shows: each top-level branch with its Thread, by list, in order. */
  const nativeBranches = (): Map<Element, { branch: HTMLElement; threadId: string }[]> => {
    const scope = root.querySelector(SIDEBAR_REGION_SELECTOR) ?? root;
    const lists = new Map<Element, { branch: HTMLElement; threadId: string }[]>();
    for (const branch of scope.querySelectorAll<HTMLElement>(BRANCH_SELECTOR)) {
      if (branch.closest(MOUNT_SELECTOR)) continue;
      const list = branch.parentElement;
      if (!list || list.closest(BRANCH_SELECTOR)) continue;
      const row = branch.querySelector<HTMLElement>(ROW_SELECTOR);
      const threadId = threadIdOfRowKey(row?.getAttribute("data-row-key") ?? null);
      if (!row || !threadId) continue;
      let entries = lists.get(list);
      if (!entries) lists.set(list, (entries = []));
      entries.push({ branch, threadId });
    }
    return lists;
  };

  const chineseLocale = (): boolean =>
    /^zh\b/iu.test(root.documentElement.lang || view.navigator.language || "");

  /** An icon Web draws for `agent` elsewhere in the sidebar. */
  const sampledIcon = (agent: string | undefined): Element | null => {
    if (!agent) return null;
    for (const icon of root.querySelectorAll(ICON_SELECTOR)) {
      if (icon.getAttribute("data-harness-id") === agent && !icon.closest(MOUNT_SELECTOR))
        return icon;
    }
    return null;
  };

  /** A plain top-level row of Web's to copy the look of a row from. */
  const templateRow = (): HTMLElement | null => {
    let fallback: HTMLElement | null = null;
    for (const row of root.querySelectorAll<HTMLElement>(
      `${ROW_SELECTOR}[data-thread-depth="0"]`,
    )) {
      if (row.closest(MOUNT_SELECTOR) || !row.closest(BRANCH_SELECTOR)) continue;
      fallback ??= row;
      if (row.getAttribute("aria-selected") !== "true" && !row.hasAttribute("aria-expanded"))
        return row;
    }
    return fallback;
  };

  /** A row for a Thread Web shows nowhere in the list, in the look of Web's rows. */
  const drawnBranch = (threadId: string, info: HandoffThreadInfo): HTMLElement | null => {
    const template = templateRow();
    const templateBranch = template?.closest<HTMLElement>(BRANCH_SELECTOR);
    if (!template || !templateBranch) return null;
    const branch = templateBranch.cloneNode(false) as HTMLElement;
    let holder: HTMLElement = branch;
    // Keep the wrappers between the branch and its row (Web's hover card).
    const chain: HTMLElement[] = [];
    for (
      let node = template.parentElement;
      node && node !== templateBranch;
      node = node.parentElement
    )
      chain.unshift(node);
    for (const wrapper of chain) {
      const copy = wrapper.cloneNode(false) as HTMLElement;
      holder.append(copy);
      holder = copy;
    }
    holder.append(template.cloneNode(true));
    const mirror = mirrorOf(branch);
    const row = mirror.querySelector<HTMLElement>(`[${MIRROR_KEY_ATTRIBUTE}]`);
    if (!row) return null;
    row.setAttribute(MIRROR_KEY_ATTRIBUTE, `handoff:${threadId}`);
    row.setAttribute("aria-selected", "false");
    row.removeAttribute("aria-current");
    row.removeAttribute("aria-expanded");
    for (const element of row.querySelectorAll(SUMMARY_SELECTOR)) element.remove();
    for (const element of row.querySelectorAll(LEADING_SLOT_SELECTOR)) element.replaceChildren();
    const icon = row.querySelector(ICON_SELECTOR);
    const sample = sampledIcon(info.agent);
    if (icon) {
      if (sample) icon.replaceWith(sample.cloneNode(true));
      else {
        // The icon Web serves for every agent (`/harness-icons/<id>`), without its framing.
        const agent = info.agent ?? "codex";
        icon.setAttribute("data-harness-id", agent);
        icon.setAttribute("aria-label", agent);
        icon.setAttribute("title", agent);
        const image = root.createElement("img");
        image.src = new URL(`harness-icons/${encodeURIComponent(agent)}`, root.baseURI).href;
        image.width = ICON_PX;
        image.height = ICON_PX;
        image.alt = "";
        image.draggable = false;
        icon.replaceChildren(image);
      }
    }
    const title = row.querySelector<HTMLElement>(TITLE_SELECTOR);
    const titleText = title?.firstElementChild ?? title;
    if (titleText) titleText.textContent = info.title ?? "";
    // The trailing cell: the time first, then Web's row buttons, which act on Web's own row.
    const trailing = title?.nextElementSibling;
    const time = trailing?.firstElementChild;
    if (trailing && time) {
      for (const sibling of [...trailing.children]) if (sibling !== time) sibling.remove();
      time.removeAttribute("data-session-status");
      time.textContent =
        info.updatedAt === undefined ? "" : webTimeLabel(info.updatedAt, now(), chineseLocale());
    }
    return mirror;
  };

  /** The element of Web's branch at the place `target` has in its mirror. */
  const counterpart = (
    wrapper: HTMLElement,
    native: HTMLElement,
    target: Element,
  ): Element | null => {
    const copy = wrapper.firstElementChild;
    if (!copy) return null;
    const path = pathFrom(copy, target);
    return path ? follow(native, path) : null;
  };

  const unitOf = (group: Group, wrapper: HTMLElement): Unit | undefined =>
    group.units.find((unit) => group.wrappers.get(unit.threadId) === wrapper);

  const groupOf = (container: HTMLElement): Group | undefined => {
    for (const group of groups.values()) if (group.mount.container === container) return group;
    return undefined;
  };

  /** Opens Web's own menu of a row at a point, as a secondary press on that row does. */
  const menuAt = (row: Element, x: number, y: number): void => {
    row.dispatchEvent(
      new view.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        button: 2,
      }),
    );
  };

  const wire = (container: HTMLElement): void => {
    const signal = api.signal;
    for (const type of ["pointerdown", "mousedown", "dblclick", "dragstart"]) {
      container.addEventListener(type, (event) => event.stopPropagation(), { signal });
    }
    container.addEventListener(
      "click",
      (event) => {
        const wrapper = closestElement(event.target, `.${UNIT_CLASS}`);
        const group = groupOf(container);
        const unit = wrapper && group ? unitOf(group, wrapper) : undefined;
        if (!wrapper || !unit) return;
        event.preventDefault();
        event.stopPropagation();
        if (!unit.native) {
          openSession(unit.threadId);
          return;
        }
        const target = event.target as Element;
        const menu = closestElement(target, '[aria-haspopup="menu"]');
        if (menu && wrapper.contains(menu)) {
          const row = counterpart(wrapper, unit.native, menu)?.closest(ROW_SELECTOR);
          const rect = menu.getBoundingClientRect();
          if (row) menuAt(row, rect.left, rect.bottom);
          return;
        }
        const native = counterpart(wrapper, unit.native, target);
        if (native instanceof view.HTMLElement) native.click();
      },
      { signal },
    );
    container.addEventListener(
      "contextmenu",
      (event) => {
        const wrapper = closestElement(event.target, `.${UNIT_CLASS}`);
        const group = groupOf(container);
        const unit = wrapper && group ? unitOf(group, wrapper) : undefined;
        if (!wrapper || !unit) return;
        event.preventDefault();
        event.stopPropagation();
        if (!unit.native) return;
        const row = counterpart(wrapper, unit.native, event.target as Element)?.closest(
          ROW_SELECTOR,
        );
        if (row) menuAt(row, event.clientX, event.clientY);
      },
      { signal },
    );
  };

  const disposeGroup = (key: string): void => {
    const group = groups.get(key);
    if (!group) return;
    groups.delete(key);
    group.mount.dispose();
  };

  /**
   * Places the rail from the rows as laid out; it does not change their layout. Positions come
   * from layout offsets, which leave transforms out: Web glides moved rows into place with a
   * transform, and a rail measured mid-glide would keep the row's old place after it lands.
   */
  const measure = (group: Group): void => {
    const container = group.mount.container;
    if (container.offsetHeight === 0) return;
    const firstWrapper = container.querySelector<HTMLElement>(`.${UNIT_CLASS}`);
    const sampleRow =
      group.mode === "root"
        ? group.host.querySelector<HTMLElement>(ROW_SELECTOR)
        : firstWrapper?.querySelector<HTMLElement>(`[${MIRROR_KEY_ATTRIBUTE}]`);
    const icon = sampleRow?.querySelector<HTMLElement>(ICON_SELECTOR) ?? sampleRow;
    if (!sampleRow || !icon) return;
    const box = layoutOffset(container);
    const rowTop = layoutOffset(sampleRow).y;
    const iconBox = layoutOffset(icon);
    // The rail may run into the list's padding, up to the first ancestor that clips.
    let clip = Number.NEGATIVE_INFINITY;
    for (let node = container.parentElement; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflow === "visible") continue;
      clip = layoutOffset(node).x + node.clientLeft;
      break;
    }
    const iconLeft = iconBox.x - box.x;
    const minX = Number.isFinite(clip) ? clip - box.x + 1 : iconLeft - 30;
    const rail = handoffRail(iconLeft, minX);
    const iconCenter = iconBox.y + icon.offsetHeight / 2;
    const set = (name: string, value: string) => {
      if (container.style.getPropertyValue(name) !== value)
        container.style.setProperty(name, value);
    };
    set("--cxh-rail-x", `${String(rail.x)}px`);
    set("--cxh-rail-w", `${String(rail.width)}px`);
    set("--cxh-icon-cy", `${String(Math.round((iconCenter - rowTop) * 2) / 2)}px`);
    if (group.mode === "root")
      set("--cxh-rail-head", `${String(Math.max(0, Math.round((box.y - iconCenter) * 2) / 2))}px`);
  };

  const listIds = new WeakMap<Element, string>();
  let nextListId = 0;
  const listKey = (list: Element): string => {
    let id = listIds.get(list);
    if (id === undefined) listIds.set(list, (id = String((nextListId += 1))));
    return id;
  };

  const renderUnits = (
    group: Group,
    info: (threadId: string) => HandoffThreadInfo | undefined,
    mirrored: Set<HTMLElement>,
  ): void => {
    const container = group.mount.container;
    const count = group.units.length;
    const wrappers: HTMLElement[] = [];
    const next = new Map<string, HTMLElement>();
    group.units.forEach((unit, index) => {
      let wrapper = group.wrappers.get(unit.threadId);
      if (!wrapper) {
        wrapper = root.createElement("div");
        wrapper.className = UNIT_CLASS;
      }
      const place =
        index === 0 && group.mode === "virtual" ? "first" : index === count - 1 ? "last" : "middle";
      if (wrapper.getAttribute(RAIL_ATTRIBUTE) !== place)
        wrapper.setAttribute(RAIL_ATTRIBUTE, place);
      let signature: string;
      if (unit.native) {
        mirrored.add(unit.native);
        signature = `mirror:${mirrorSignature(unit.native)}`;
        if (wrapper.dataset.signature !== signature || wrapper.dataset.native !== "1") {
          wrapper.replaceChildren(mirrorOf(unit.native));
          wrapper.dataset.native = "1";
        }
      } else {
        const described = info(unit.threadId) ?? {};
        signature = `drawn:${JSON.stringify(described)}:${chineseLocale() ? "zh" : "en"}:${String(
          Math.floor(now() / 60_000),
        )}`;
        if (wrapper.dataset.signature !== signature || wrapper.dataset.native !== "0") {
          const drawn = drawnBranch(unit.threadId, described);
          wrapper.replaceChildren(...(drawn ? [drawn] : []));
          wrapper.dataset.native = "0";
        }
      }
      wrapper.dataset.signature = signature;
      wrappers.push(wrapper);
      next.set(unit.threadId, wrapper);
    });
    group.wrappers = next;
    const current = [...container.children];
    if (
      current.length !== wrappers.length ||
      wrappers.some((wrapper, index) => current[index] !== wrapper)
    )
      container.replaceChildren(...wrappers);
    const gap = `${String(ROW_GAP_PX)}px`;
    if (container.style.getPropertyValue("--cxh-gap") !== gap)
      container.style.setProperty("--cxh-gap", gap);
  };

  const apply = (): void => {
    applyScheduled = false;
    if (rafId !== undefined) {
      view.cancelAnimationFrame?.(rafId);
      rafId = undefined;
    }
    if (disposed || api.signal.aborted) return;

    const lists = nativeBranches();
    const shown = new Set<string>();
    for (const entries of lists.values()) for (const { threadId } of entries) shown.add(threadId);
    const handoffs = source.snapshot;
    // Threads Web shows in no list are drawn from what the backend says of them.
    source.want([...handoffMembers(handoffs.links)].filter((threadId) => !shown.has(threadId)));
    const info = (threadId: string): HandoffThreadInfo | undefined =>
      Object.hasOwn(handoffs.threads, threadId) ? handoffs.threads[threadId] : undefined;

    const chains = handoffChains(handoffs.links, () => true);
    const nextMarks = new Map<Element, Mark>();
    const liveGroups = new Set<string>();
    const mirrored = new Set<HTMLElement>();
    const hosts = new Set<HTMLElement>();

    for (const [list, entries] of lists) {
      const position = new Map<string, number>();
      const branchOf = new Map<string, HTMLElement>();
      entries.forEach(({ branch, threadId }, index) => {
        if (branchOf.has(threadId)) return;
        branchOf.set(threadId, branch);
        position.set(threadId, index);
      });
      for (const chain of chains) {
        const present = chain.filter((threadId) => branchOf.has(threadId));
        if (present.length === 0) continue;
        const drawable = chain.filter(
          (threadId) => branchOf.has(threadId) || Boolean(info(threadId)?.title),
        );
        if (drawable.length < 2) continue;
        const topmost = present.reduce((best, threadId) =>
          (position.get(threadId) ?? 0) < (position.get(best) ?? 0) ? threadId : best,
        );
        const head = drawable[0] ?? topmost;
        const mode = topmost === head ? "root" : "virtual";
        const host = branchOf.get(topmost);
        if (!host) continue;
        const key = `${listKey(list)}\u0000${head}`;
        liveGroups.add(key);
        hosts.add(host);
        const units: Unit[] = (mode === "root" ? drawable.slice(1) : drawable).map((threadId) => ({
          threadId,
          native: branchOf.get(threadId) ?? null,
        }));
        for (const threadId of present) {
          const branch = branchOf.get(threadId);
          if (!branch) continue;
          if (branch === host) {
            if (mode === "virtual") nextMarks.set(branch, "anchor");
          } else {
            nextMarks.set(branch, "hidden");
          }
        }
        let group = groups.get(key);
        if (
          group &&
          (group.host !== host || group.mode !== mode || !group.mount.container.isConnected)
        ) {
          disposeGroup(key);
          group = undefined;
        }
        if (!group) {
          const mount = api.dom.mount(host, "append");
          if (!mount) continue;
          mount.container.classList.add(GROUP_CLASS);
          mount.container.setAttribute("role", "group");
          mount.container.setAttribute("data-mode", mode);
          wire(mount.container);
          group = { key, host, mode, mount, wrappers: new Map(), units };
          groups.set(key, group);
        }
        group.units = units;
        renderUnits(group, info, mirrored);
        // Web may add its own children after the group; the group stays last in the branch.
        if (host.lastElementChild !== group.mount.container) host.append(group.mount.container);
      }
    }

    for (const key of [...groups.keys()]) if (!liveGroups.has(key)) disposeGroup(key);
    for (const [element, mark] of nextMarks) setMark(element, mark);
    for (const element of [...marks.keys()]) if (!nextMarks.has(element)) setMark(element, null);
    for (const [native, mirror] of mirrors) {
      if (mirrored.has(native)) continue;
      mirror.observer.disconnect();
      mirrors.delete(native);
    }
    for (const host of observedHosts) {
      if (hosts.has(host)) continue;
      resizeObserver?.unobserve(host);
      observedHosts.delete(host);
    }
    for (const host of hosts) {
      if (observedHosts.has(host)) continue;
      resizeObserver?.observe(host);
      observedHosts.add(host);
    }
    for (const group of groups.values()) measure(group);
  };

  const scheduleApply = (): void => {
    if (disposed || applyScheduled) return;
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

  /** Whether a change can concern the sidebar's rows: inside the sidebar, or bringing it. */
  const touchesSidebar = (mutation: MutationRecord, target: Element): boolean =>
    target.closest(SIDEBAR_REGION_SELECTOR) !== null ||
    [...mutation.addedNodes, ...mutation.removedNodes].some(
      (node) =>
        node.nodeType === 1 &&
        ((node as Element).matches(SIDEBAR_REGION_SELECTOR) ||
          (node as Element).querySelector(`${SIDEBAR_REGION_SELECTOR}, ${BRANCH_SELECTOR}`) !==
            null),
    );

  const observer = new view.MutationObserver((mutations) => {
    if (disposed) return;
    for (const mutation of mutations) {
      const target =
        mutation.target.nodeType === 1
          ? (mutation.target as Element)
          : mutation.target.parentElement;
      if (!target || target.closest(MOUNT_SELECTOR)) continue;
      if (!touchesSidebar(mutation, target)) continue;
      if (mutation.type === "attributes" && mutation.attributeName?.startsWith("data-cx-"))
        continue;
      if (
        mutation.type === "childList" &&
        [...mutation.addedNodes, ...mutation.removedNodes].every(
          (node) => node.nodeType === 1 && (node as Element).matches(MOUNT_SELECTOR),
        )
      )
        continue;
      scheduleApply();
      return;
    }
  });
  observer.observe(root.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-row-key", "data-thread-branch", "aria-selected", "lang"],
  });

  source.start();
  // Drawn rows show a relative time; a pass a minute keeps it current.
  const timer = view.setInterval(scheduleApply, 60_000);
  root.addEventListener(
    "visibilitychange",
    () => {
      if (root.visibilityState === "visible") source.refresh();
    },
    { signal: api.signal },
  );

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    source.dispose();
    view.clearInterval(timer);
    if (rafId !== undefined) view.cancelAnimationFrame?.(rafId);
    observer.disconnect();
    resizeObserver?.disconnect();
    for (const mirror of mirrors.values()) mirror.observer.disconnect();
    mirrors.clear();
    for (const key of [...groups.keys()]) disposeGroup(key);
    if (!api.signal.aborted) for (const element of [...marks.keys()]) setMark(element, null);
    marks.clear();
  };
  api.track(dispose);
  return dispose;
}
