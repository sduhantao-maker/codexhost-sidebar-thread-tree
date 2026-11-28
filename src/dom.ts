import type { DesktopExtensionApiV1 } from "@codexhost/shared-contracts";
import { handoffRail } from "./handoff.js";
import { SIDEBAR_TREE_MOTION_ATTRIBUTE, cancelSidebarThreadTreeMotion } from "./motion.js";
import {
  SIDEBAR_THREAD_TREE_MAX_INDENT_DEPTH,
  type SidebarThreadTreeActivity,
  type SidebarThreadTreeNode,
  type SidebarThreadTreeRoot,
  type SidebarThreadTreeStatus,
} from "./tree.js";

/**
 * DOM for the delegated-children tree of Codex Desktop's sidebar. Native nodes are never moved,
 * wrapped or cloned, and native elements are only decorated or hidden through `api.dom.mark` +
 * `desktop.css` so disabling the extension restores the native sidebar cleanly.
 *
 * On a native root row, a toggle is laid over its Agent icon, and the summary line or the
 * children are mounted in the row's own listitem, after Desktop's content. A tree drawn in place
 * of a member's row lives in that member's listitem, whose native content is hidden via the
 * `anchor` mark; a native row shown elsewhere in a tree has its listitem hidden via the `hidden`
 * mark.
 *
 * A handoff group adds the trees of the Threads the first one continues, at its level: after the
 * first tree in a native root's listitem, or after it in the tree drawn in place of a member's
 * row. Their rail is drawn by `desktop.css` from `data-handoff` attributes on the elements it
 * passes, as the tree guides are.
 */

export const SIDEBAR_TREE_TOGGLE_CLASS = "cxh-tree-toggle";
export const SIDEBAR_TREE_CHEVRON_CLASS = "cxh-tree-chevron";
export const SIDEBAR_TREE_SUMMARY_LINE_CLASS = "cxh-tree-summary-line";
export const SIDEBAR_TREE_SUMMARY_CLASS = "cxh-tree-summary";
export const SIDEBAR_TREE_CHILDREN_CLASS = "cxh-tree-children";
export const SIDEBAR_TREE_BRANCH_CLASS = "cxh-tree-branch";
export const SIDEBAR_TREE_ROW_CLASS = "cxh-tree-row";
export const SIDEBAR_TREE_IDENTITY_CLASS = "cxh-tree-identity";
export const SIDEBAR_TREE_TITLE_CLASS = "cxh-tree-title";
export const SIDEBAR_TREE_STATUS_CLASS = "cxh-tree-status";
export const SIDEBAR_TREE_VIRTUAL_CLASS = "cxh-tree-virtual";
export const SIDEBAR_TREE_ACTIONS_CLASS = "cxh-tree-actions";
export const SIDEBAR_TREE_ACTION_CLASS = "cxh-tree-action";
export const SIDEBAR_TREE_HANDOFF_CLASS = "cxh-tree-handoff";

/** Each level indents children by the Web tree's 24px. */
export const SIDEBAR_TREE_INDENT_PX = 24;
/** The Agent icon codexhost puts on sidebar rows (`renderer-sidebar-agent-icons`). */
export const SIDEBAR_TREE_ICON_PX = 14;

export const SIDEBAR_TREE_TOGGLE_ATTRIBUTE = "data-codexhost-sidebar-tree-toggle";
export const SIDEBAR_TREE_EXPAND_ATTRIBUTE = "data-codexhost-sidebar-tree-expand";
export const SIDEBAR_TREE_SUMMARY_ATTRIBUTE = "data-codexhost-sidebar-tree-summary";
export const SIDEBAR_TREE_CHILDREN_ATTRIBUTE = "data-codexhost-sidebar-tree-children";
export const SIDEBAR_TREE_VIRTUAL_ATTRIBUTE = "data-codexhost-sidebar-tree-virtual";
export const SIDEBAR_TREE_NODE_ATTRIBUTE = "data-codexhost-sidebar-tree-node";
/** A button on a codexhost row that stands in for one of Desktop's own row actions. */
export const SIDEBAR_TREE_ACTION_ATTRIBUTE = "data-codexhost-sidebar-tree-action";
/**
 * The button on a codexhost row whose Thread has no Desktop row: it opens Desktop's own menu of
 * that Thread (rename, pin, archive, delete) instead.
 */
export const SIDEBAR_TREE_MENU_ATTRIBUTE = "data-codexhost-sidebar-tree-menu";
/** Identity of codexhost rows across rebuilds, for focus and for expand and collapse motion. */
export const SIDEBAR_TREE_KEY_ATTRIBUTE = "data-codexhost-sidebar-tree-key";
/** The trees that follow a native root's own tree in its handoff group. */
export const SIDEBAR_TREE_HANDOFF_ATTRIBUTE = "data-codexhost-sidebar-tree-handoff";
/** Where an element sits on the handoff rail: `first`, `middle` or `last`. */
export const SIDEBAR_TREE_RAIL_ATTRIBUTE = "data-handoff";
/** The element after a native root row, which starts the rail at that row's icon. */
export const SIDEBAR_TREE_RAIL_HEAD_ATTRIBUTE = "data-handoff-head";
/** Every node this module adds carries one of these, so observers can ignore its own writes. */
export const SIDEBAR_TREE_OWNED_SELECTOR = [
  SIDEBAR_TREE_TOGGLE_ATTRIBUTE,
  SIDEBAR_TREE_SUMMARY_ATTRIBUTE,
  SIDEBAR_TREE_CHILDREN_ATTRIBUTE,
  SIDEBAR_TREE_VIRTUAL_ATTRIBUTE,
  SIDEBAR_TREE_HANDOFF_ATTRIBUTE,
  SIDEBAR_TREE_MOTION_ATTRIBUTE,
]
  .map((name) => `[${name}]`)
  .join(", ");

export type SidebarTreeMarkName = "hidden" | "root-collapsed" | "root-expanded" | "anchor";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const PRESENTATION_ATTRIBUTE = "data-codexhost-sidebar-tree-presentation";
const NATIVE_ROW_SELECTOR = "[data-app-action-sidebar-thread-row]";
/** Desktop's own buttons on a row (pin, archive), not the row's main button. */
const NATIVE_ACTION_SELECTOR = "button[aria-label]:not([data-interactive-row-button])";
const NATIVE_TITLE_SELECTOR = "[data-thread-title]";
const AGENT_ICON_SELECTOR = "[data-codexhost-sidebar-agent-icon]";
const ACTIVE_ATTRIBUTE = "data-app-action-sidebar-thread-active";
const SELECTED_ATTRIBUTE = "data-app-action-sidebar-thread-selected";
/**
 * Desktop's next and previous Thread commands step through the visible rows carrying this and
 * start from the one marked `aria-current="page"`; rows codexhost draws join them in place.
 */
const CYCLE_ITEM_ATTRIBUTE = "data-sidebar-cycle-item";

export interface SidebarHarnessIcon {
  name: string;
  iconUrl?: string;
  sampled?: Element;
  signature: string;
}

/** What a tree row shows besides its place in the tree. */
export interface SidebarThreadTreeDisplay {
  title: string;
  agent: string;
  harness: SidebarHarnessIcon;
  /** The Thread the main view currently shows. */
  current: boolean;
}

export type SidebarThreadTreeNodeView = SidebarThreadTreeNode & SidebarThreadTreeDisplay;

export interface SidebarThreadTreeView extends Omit<SidebarThreadTreeRoot, "nodes"> {
  nodes: SidebarThreadTreeNodeView[];
  /** The root as a codexhost row, used when the tree stands in for another member's row. */
  root: SidebarThreadTreeDisplay;
  /** The trees of the Threads this one continues after context handoffs, in display order. */
  handoff?: SidebarThreadTreeView[];
}

export interface SidebarThreadTreeLabels {
  expand(count: number): string;
  collapse(count: number): string;
  status(status: SidebarThreadTreeStatus): string;
  children(count: number): string;
  running(count: number): string;
  pending(count: number): string;
  expandSummary(title: string, summary: string): string;
  /** The button that opens Desktop's own menu of a Thread without a Desktop row. */
  actions: string;
}

export interface SidebarThreadTreeHandlers {
  /** `source` is the element the user acted on, so motion can follow its list. */
  toggle(threadId: string, source: Element): void;
  /** A press on a Thread's row or on the rest of its row block. */
  open(threadId: string, source: Element): void;
  /**
   * The Thread's own Desktop row when Desktop has it mounted, even hidden. Rows codexhost draws
   * hand Desktop's row actions (pin, rename, archive) to it, so they act as Desktop's own do.
   */
  native(threadId: string): HTMLElement | null;
  /**
   * Opens Desktop's own menu of a Thread that has no Desktop row, such as a delegated Thread
   * started in a folder that is not a project: the menu Desktop shows for the open Thread.
   */
  menu(threadId: string, source: Element): void;
}

interface TreeMetrics {
  iconLeft: number;
  titleLeft: number;
  rowHeight: number;
  radius: string;
  padEnd: number;
  gap: number;
  titleSize: string;
  titleLine: string;
  titleWeight: string;
  titleColor: string;
}

const DEFAULT_METRICS: TreeMetrics = {
  iconLeft: 32,
  titleLeft: 54,
  rowHeight: 30,
  radius: "10px",
  padEnd: 5,
  gap: 0,
  titleSize: "14px",
  titleLine: "20px",
  titleWeight: "inherit",
  titleColor: "inherit",
};

/** Lists share row metrics; a list's last measurement serves rows that are not laid out. */
const metricsByList = new WeakMap<Element, TreeMetrics>();
/** The measuring pass each list was last measured in; a pass measures a list once. */
const measuredInPass = new WeakMap<Element, number>();
let measuringPass = 0;
/** The handlers of the latest render: Desktop remounts rows, so no render may keep its own. */
const currentHandlers = new WeakMap<Element, SidebarThreadTreeHandlers>();
/** The wording of the latest render, for controls added on hover. */
const currentLabels = new WeakMap<Element, SidebarThreadTreeLabels>();

/**
 * Events on codexhost controls and rows that must not reach Desktop: its rows navigate on
 * press, and the row, its listitem and the list carry drag, rename and context-menu handling.
 * The ends of gestures (`pointerup`, `mouseup`) pass, so a drag started elsewhere can end here.
 * Context menus and title double-clicks are replayed on the Thread's own row instead.
 */
const ISOLATED_EVENTS = [
  "pointerdown",
  "mousedown",
  "dblclick",
  "auxclick",
  "contextmenu",
  "dragstart",
];

function stopNative(event: Event): void {
  event.stopPropagation();
}

function isolate(element: HTMLElement, signal: AbortSignal): void {
  for (const type of ISOLATED_EVENTS) element.addEventListener(type, stopNative, { signal });
}

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function setVariable(element: HTMLElement, name: string, value: string): void {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

function closestAttribute(target: EventTarget | null, attribute: string): HTMLElement | null {
  const view = (target as Node | null)?.ownerDocument?.defaultView;
  return view && target instanceof view.Element
    ? target.closest<HTMLElement>(`[${attribute}]`)
    : null;
}

function ownedChild(parent: Element, attribute: string): HTMLElement | null {
  for (const child of parent.children) {
    if (child.hasAttribute(attribute)) return child as HTMLElement;
  }
  return null;
}

/** Desktop's own action buttons on a native row (pin, archive), in Desktop's order. */
function nativeActions(native: HTMLElement): HTMLButtonElement[] {
  return [...native.querySelectorAll<HTMLButtonElement>(NATIVE_ACTION_SELECTOR)].filter(
    (button) =>
      button.querySelector("svg") !== null && !button.closest(SIDEBAR_TREE_OWNED_SELECTOR),
  );
}

/** The button that opens Desktop's own menu of a Thread without a Desktop row. */
function menuButton(ownerDocument: Document, label: string): HTMLButtonElement {
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.className = SIDEBAR_TREE_ACTION_CLASS;
  button.setAttribute(SIDEBAR_TREE_MENU_ATTRIBUTE, "");
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-haspopup", "menu");
  button.title = label;
  const icon = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.setAttribute("fill", "currentColor");
  icon.setAttribute("aria-hidden", "true");
  for (const cx of [5, 10, 15]) {
    const dot = ownerDocument.createElementNS(SVG_NAMESPACE, "circle");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", "10");
    dot.setAttribute("r", "1.5");
    icon.append(dot);
  }
  button.append(icon);
  return button;
}

/**
 * Shows Desktop's own row actions on a row codexhost draws: each button mirrors one of the
 * Thread's native row, with its label and icon, so the row offers what a native row offers. A
 * Thread Desktop has no row for gets one button instead, which opens Desktop's own menu of it.
 */
function syncActions(row: HTMLElement, native: HTMLElement | null, menuLabel: string): void {
  const actions = native ? nativeActions(native) : [];
  let box = row.querySelector<HTMLElement>(`:scope > .${SIDEBAR_TREE_ACTIONS_CLASS}`);
  // A Desktop row without actions, such as one whose actions Desktop disabled, offers none.
  if (native && actions.length === 0) {
    box?.remove();
    return;
  }
  const labels = actions.map((action) => action.getAttribute("aria-label") ?? "");
  const signature = native ? labels.join("\u0000") : `menu\u0000${menuLabel}`;
  if (box?.dataset.signature === signature) return;
  const ownerDocument = row.ownerDocument;
  if (!box) {
    box = ownerDocument.createElement("span");
    box.className = SIDEBAR_TREE_ACTIONS_CLASS;
    row.append(box);
  }
  box.dataset.signature = signature;
  if (!native) {
    box.replaceChildren(menuButton(ownerDocument, menuLabel));
    return;
  }
  box.replaceChildren(
    ...actions.map((action, index) => {
      const label = labels[index] ?? "";
      const button = ownerDocument.createElement("button");
      button.type = "button";
      button.className = SIDEBAR_TREE_ACTION_CLASS;
      button.setAttribute(SIDEBAR_TREE_ACTION_ATTRIBUTE, label);
      button.setAttribute("aria-label", label);
      button.title = label;
      const icon = action.querySelector("svg")?.cloneNode(true) as Element | undefined;
      if (icon) {
        icon.setAttribute("aria-hidden", "true");
        button.append(icon);
      }
      return button;
    }),
  );
}

/** Presses the native action a mirrored button stands for, looked up again at press time. */
function pressNativeAction(native: HTMLElement | null, label: string): void {
  if (!native) return;
  nativeActions(native)
    .find((action) => action.getAttribute("aria-label") === label)
    ?.click();
}

/** Replays a gesture on the Thread's own Desktop row, which handles it as one of its own. */
function replay(target: Element, type: "contextmenu" | "dblclick", from: MouseEvent): void {
  const view = target.ownerDocument.defaultView;
  if (!view) return;
  target.dispatchEvent(
    new view.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: from.detail,
      screenX: from.screenX,
      screenY: from.screenY,
      clientX: from.clientX,
      clientY: from.clientY,
      button: from.button,
      buttons: from.buttons,
      ctrlKey: from.ctrlKey,
      shiftKey: from.shiftKey,
      altKey: from.altKey,
      metaKey: from.metaKey,
    }),
  );
}

function nativeParts(row: HTMLElement): { trigger: HTMLElement; item: HTMLElement } | null {
  const trigger = row.querySelector<HTMLElement>("[data-thread-title-trigger]");
  const item = row.closest<HTMLElement>('[role="listitem"]');
  return trigger && item ? { trigger, item } : null;
}

function markAttribute(apiId: string, name: SidebarTreeMarkName): string {
  return `data-cx-${apiId}-${name}`;
}

function setMark(
  api: DesktopExtensionApiV1,
  target: Element,
  name: SidebarTreeMarkName,
  present: boolean,
): void {
  const has = target.hasAttribute(markAttribute(api.id, name));
  if (present && !has) api.dom.mark(target, name);
  else if (!present && has) api.dom.unmark(target, name);
}

/** Whether a native row has the parts the tree is attached to. */
export function canRenderSidebarThreadTree(row: HTMLElement): boolean {
  return nativeParts(row) !== null;
}

/** Laid-out native rows of `list`, `row` itself first. */
function* laidOutRows(row: HTMLElement, list: Element | null): Generator<HTMLElement> {
  if (row.getBoundingClientRect().height > 0) yield row;
  if (!list) return;
  for (const candidate of list.querySelectorAll<HTMLElement>(NATIVE_ROW_SELECTOR)) {
    if (candidate === row || candidate.closest('[role="listitem"]')?.parentElement !== list)
      continue;
    if (candidate.getBoundingClientRect().height > 0) yield candidate;
  }
}

/** Whether Desktop shows a row's title as it shows any row: the open row has its own colour. */
function plainRow(row: HTMLElement): boolean {
  return (
    row.getAttribute(ACTIVE_ATTRIBUTE) !== "true" && row.getAttribute(SELECTED_ATTRIBUTE) !== "true"
  );
}

/**
 * Measures the rows of `item`'s list, once per measuring pass: the geometry from a laid-out row,
 * the title text from an ordinary one. A list that is not laid out reuses its last measurement.
 */
function metricsFor(apiId: string, row: HTMLElement, item: HTMLElement): TreeMetrics {
  const list = item.parentElement;
  if (list && measuredInPass.get(list) === measuringPass)
    return metricsByList.get(list) ?? DEFAULT_METRICS;
  const view = row.ownerDocument.defaultView;
  let measured: HTMLElement | null = null;
  let textRow: HTMLElement | null = null;
  if (view) {
    for (const candidate of laidOutRows(row, list)) {
      measured ??= candidate;
      if (!plainRow(candidate)) continue;
      textRow = candidate;
      break;
    }
  }
  const measuredItem = measured?.closest<HTMLElement>('[role="listitem"]');
  if (!view || !measured || !measuredItem) {
    // Nothing of the list is laid out; the pass keeps what it found instead of looking again.
    if (list) measuredInPass.set(list, measuringPass);
    return (list && metricsByList.get(list)) ?? DEFAULT_METRICS;
  }
  const itemRect = measuredItem.getBoundingClientRect();
  const rowRect = measured.getBoundingClientRect();
  const trigger = measured.querySelector<HTMLElement>("[data-thread-title-trigger]");
  const icon = measured.querySelector<HTMLElement>(AGENT_ICON_SELECTOR);
  const title = measured.querySelector<HTMLElement>("[data-thread-title]");
  const textTitle = (textRow ?? measured).querySelector<HTMLElement>("[data-thread-title]");
  const rowStyle = view.getComputedStyle(measured);
  const iconLeft =
    (icon ?? trigger)?.getBoundingClientRect().left ?? itemRect.left + DEFAULT_METRICS.iconLeft;
  const titleRect = title?.getBoundingClientRect();
  const titleStyle = textTitle ? view.getComputedStyle(textTitle) : null;
  const plainItem =
    !measuredItem.hasAttribute(markAttribute(apiId, "root-collapsed")) &&
    !measuredItem.hasAttribute(markAttribute(apiId, "root-expanded")) &&
    !measuredItem.hasAttribute(markAttribute(apiId, "anchor")) &&
    !measuredItem.querySelector(SIDEBAR_TREE_OWNED_SELECTOR);
  const metrics: TreeMetrics = {
    iconLeft: Math.round(iconLeft - itemRect.left),
    titleLeft: Math.round((titleRect?.left ?? iconLeft + SIDEBAR_TREE_ICON_PX + 8) - itemRect.left),
    rowHeight: rowRect.height,
    radius:
      pixels(rowStyle.borderTopLeftRadius) > 0
        ? rowStyle.borderTopLeftRadius
        : DEFAULT_METRICS.radius,
    padEnd: pixels(rowStyle.paddingInlineEnd) || DEFAULT_METRICS.padEnd,
    gap: plainItem
      ? Math.max(0, Math.round(itemRect.height - rowRect.height))
      : ((list && metricsByList.get(list)?.gap) ?? DEFAULT_METRICS.gap),
    titleSize: titleStyle?.fontSize || DEFAULT_METRICS.titleSize,
    titleLine: titleStyle?.lineHeight || DEFAULT_METRICS.titleLine,
    titleWeight: titleStyle?.fontWeight || DEFAULT_METRICS.titleWeight,
    titleColor: titleStyle?.color || DEFAULT_METRICS.titleColor,
  };
  if (list) {
    metricsByList.set(list, metrics);
    measuredInPass.set(list, measuringPass);
  }
  return metrics;
}

/**
 * Starts a rendering pass by measuring the lists of `rows` before anything is written, so the
 * pass reads layout once instead of once per tree.
 */
export function measureSidebarThreadTreeRows(apiId: string, rows: Iterable<HTMLElement>): void {
  measuringPass += 1;
  for (const row of rows) {
    const item = row.closest<HTMLElement>('[role="listitem"]');
    if (item) metricsFor(apiId, row, item);
  }
}

function applyMetrics(element: HTMLElement, metrics: TreeMetrics): void {
  setVariable(element, "--cxh-icon-left", `${String(metrics.iconLeft)}px`);
  setVariable(element, "--cxh-row-h", `${String(metrics.rowHeight)}px`);
  setVariable(element, "--cxh-row-radius", metrics.radius);
  setVariable(element, "--cxh-row-pad-end", `${String(metrics.padEnd)}px`);
  setVariable(element, "--cxh-gap", `${String(metrics.gap)}px`);
  setVariable(
    element,
    "--cxh-title-gap",
    `${String(Math.max(4, metrics.titleLeft - metrics.iconLeft - SIDEBAR_TREE_ICON_PX))}px`,
  );
  setVariable(element, "--cxh-title-size", metrics.titleSize);
  setVariable(element, "--cxh-title-line", metrics.titleLine);
  setVariable(element, "--cxh-title-weight", metrics.titleWeight);
  setVariable(element, "--cxh-title-color", metrics.titleColor);
  // The summary text starts under the title, as in the Web sidebar.
  setVariable(element, "--cxh-summary-start", `${String(Math.max(0, metrics.titleLeft - 8))}px`);
  // The handoff rail runs left of the icon column, with the tree guides' elbow where it fits.
  const rail = handoffRail(metrics.iconLeft);
  setVariable(element, "--cxh-rail-x", `${String(rail.x)}px`);
  setVariable(element, "--cxh-rail-w", `${String(rail.width)}px`);
}

function indentOf(depth: number): string {
  return `${String(Math.min(depth, SIDEBAR_THREAD_TREE_MAX_INDENT_DEPTH) * SIDEBAR_TREE_INDENT_PX)}px`;
}

function createAgentIconElement(
  harness: SidebarHarnessIcon,
  size: number,
  ownerDocument: Document,
): Element {
  const sampled = harness.sampled;
  if (sampled) {
    const tag = sampled.tagName.toLowerCase();
    if (tag === "svg") {
      const clone = sampled.cloneNode(true) as SVGElement;
      clone.setAttribute("aria-hidden", "true");
      clone.style.width = `${String(size)}px`;
      clone.style.height = `${String(size)}px`;
      clone.style.flex = "none";
      return clone;
    }
    if (tag === "img") {
      const src = sampled.getAttribute("src");
      if (src) {
        const image = ownerDocument.createElement("img");
        image.src = src;
        image.alt = "";
        image.draggable = false;
        image.style.width = `${String(size)}px`;
        image.style.height = `${String(size)}px`;
        image.style.objectFit = "contain";
        image.style.flex = "none";
        const sampledImage = sampled as HTMLImageElement;
        if (sampledImage.style.borderRadius)
          image.style.borderRadius = sampledImage.style.borderRadius;
        if (sampledImage.style.background) image.style.background = sampledImage.style.background;
        if (sampledImage.style.padding) {
          image.style.boxSizing = "border-box";
          image.style.padding = sampledImage.style.padding;
        }
        return image;
      }
    }
  }
  if (harness.iconUrl) {
    const image = ownerDocument.createElement("img");
    image.src = harness.iconUrl;
    image.alt = "";
    image.draggable = false;
    image.style.width = `${String(size)}px`;
    image.style.height = `${String(size)}px`;
    image.style.objectFit = "contain";
    image.style.flex = "none";
    return image;
  }
  const fallback = ownerDocument.createElement("span");
  fallback.setAttribute("aria-hidden", "true");
  fallback.textContent = harness.name.slice(0, 1).toUpperCase();
  fallback.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:${String(size)}px;height:${String(size)}px;flex:none;font-size:${String(Math.round(size * 0.7))}px`;
  return fallback;
}

function chevron(ownerDocument: Document): HTMLElement {
  const element = ownerDocument.createElement("span");
  element.className = SIDEBAR_TREE_CHEVRON_CLASS;
  element.setAttribute("aria-hidden", "true");
  return element;
}

function spinner(ownerDocument: Document): SVGSVGElement {
  const svg = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.25");
  svg.setAttribute("stroke-linecap", "round");
  const track = ownerDocument.createElementNS(SVG_NAMESPACE, "circle");
  track.setAttribute("cx", "12");
  track.setAttribute("cy", "12");
  track.setAttribute("r", "8");
  track.setAttribute("opacity", "0.3");
  const arc = ownerDocument.createElementNS(SVG_NAMESPACE, "path");
  arc.setAttribute("d", "M12 4a8 8 0 1 1-8 8");
  svg.append(track, arc);
  return svg;
}

function statusNode(
  ownerDocument: Document,
  status: SidebarThreadTreeStatus,
  label: string,
): HTMLElement | null {
  if (status === "idle") return null;
  const node = ownerDocument.createElement("span");
  node.className = SIDEBAR_TREE_STATUS_CLASS;
  node.dataset.status = status;
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", label);
  node.title = label;
  if (status === "running") node.append(spinner(ownerDocument));
  return node;
}

interface SummaryPart {
  text: string;
  activity?: "running" | "pending";
}

/** The Web sidebar's summary: the count, then running and waiting work when there is any. */
function summaryParts(
  count: number,
  activity: SidebarThreadTreeActivity,
  labels: SidebarThreadTreeLabels,
): SummaryPart[] {
  const parts: SummaryPart[] = [{ text: labels.children(count) }];
  if (activity.running > 0)
    parts.push({ text: ` · ${labels.running(activity.running)}`, activity: "running" });
  if (activity.pending > 0)
    parts.push({ text: ` · ${labels.pending(activity.pending)}`, activity: "pending" });
  return parts;
}

/** The expand button of a collapsed row's summary line. */
function summaryButton(
  ownerDocument: Document,
  node: {
    threadId: string;
    title: string;
    descendants: number;
    activity: SidebarThreadTreeActivity;
  },
  labels: SidebarThreadTreeLabels,
): HTMLElement {
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.className = SIDEBAR_TREE_SUMMARY_CLASS;
  button.setAttribute(SIDEBAR_TREE_EXPAND_ATTRIBUTE, node.threadId);
  button.setAttribute("aria-expanded", "false");
  const parts = summaryParts(node.descendants, node.activity, labels);
  button.setAttribute(
    "aria-label",
    labels.expandSummary(node.title, parts.map((part) => part.text).join("")),
  );
  for (const part of parts) {
    if (!part.activity) {
      button.append(part.text);
      continue;
    }
    const span = ownerDocument.createElement("span");
    span.dataset.activity = part.activity;
    span.textContent = part.text;
    button.append(span);
  }
  return button;
}

/** The line under a collapsed codexhost row: part of that row's block. */
function summaryLine(
  ownerDocument: Document,
  node: {
    threadId: string;
    title: string;
    descendants: number;
    activity: SidebarThreadTreeActivity;
  },
  labels: SidebarThreadTreeLabels,
): HTMLElement {
  const line = ownerDocument.createElement("div");
  line.className = SIDEBAR_TREE_SUMMARY_LINE_CLASS;
  line.setAttribute(SIDEBAR_TREE_SUMMARY_ATTRIBUTE, node.threadId);
  line.setAttribute(SIDEBAR_TREE_KEY_ATTRIBUTE, `summary:${node.threadId}`);
  line.append(summaryButton(ownerDocument, node, labels));
  return line;
}

function treeRow(
  ownerDocument: Document,
  node: {
    threadId: string;
    depth: number;
    status: SidebarThreadTreeStatus;
    descendants: number;
    expanded: boolean;
  } & SidebarThreadTreeDisplay,
  labels: SidebarThreadTreeLabels,
): HTMLElement {
  const row = ownerDocument.createElement("div");
  row.className = SIDEBAR_TREE_ROW_CLASS;
  row.setAttribute(SIDEBAR_TREE_NODE_ATTRIBUTE, node.threadId);
  row.setAttribute(SIDEBAR_TREE_KEY_ATTRIBUTE, `row:${node.threadId}`);
  row.setAttribute(CYCLE_ITEM_ATTRIBUTE, "");
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(node.depth + 1));
  row.tabIndex = 0;
  if (node.current) row.setAttribute("aria-current", "page");

  const identity = ownerDocument.createElement(node.descendants > 0 ? "button" : "span");
  identity.className = SIDEBAR_TREE_IDENTITY_CLASS;
  identity.append(createAgentIconElement(node.harness, SIDEBAR_TREE_ICON_PX, ownerDocument));
  if (node.descendants > 0) {
    const label = node.expanded
      ? labels.collapse(node.descendants)
      : labels.expand(node.descendants);
    identity.setAttribute("type", "button");
    identity.setAttribute(SIDEBAR_TREE_TOGGLE_ATTRIBUTE, node.threadId);
    identity.setAttribute("aria-expanded", String(node.expanded));
    identity.setAttribute("aria-label", label);
    identity.title = label;
    identity.append(chevron(ownerDocument));
    row.setAttribute("aria-expanded", String(node.expanded));
  } else {
    identity.setAttribute("aria-hidden", "true");
  }

  const title = ownerDocument.createElement("span");
  title.className = SIDEBAR_TREE_TITLE_CLASS;
  title.textContent = node.title;
  title.title = node.title;
  row.append(identity, title);
  const status = statusNode(ownerDocument, node.status, labels.status(node.status));
  if (status) row.append(status);
  return row;
}

function childrenGroup(ownerDocument: Document, parentDepth: number): HTMLElement {
  const group = ownerDocument.createElement("div");
  group.className = SIDEBAR_TREE_CHILDREN_CLASS;
  group.setAttribute("role", "group");
  if (parentDepth < SIDEBAR_THREAD_TREE_MAX_INDENT_DEPTH) group.setAttribute("data-guide", "");
  group.style.setProperty("--cxh-guide-indent", indentOf(parentDepth));
  return group;
}

/** A row with its summary or its children: the unit the guides hang from. */
function branch(
  ownerDocument: Document,
  node: SidebarThreadTreeNodeView,
  labels: SidebarThreadTreeLabels,
): { element: HTMLElement; children: HTMLElement | null } {
  const element = ownerDocument.createElement("div");
  element.className = SIDEBAR_TREE_BRANCH_CLASS;
  element.style.setProperty("--cxh-indent", indentOf(node.depth));
  element.append(treeRow(ownerDocument, node, labels));
  if (node.descendants === 0) return { element, children: null };
  if (!node.expanded) {
    element.append(summaryLine(ownerDocument, node, labels));
    return { element, children: null };
  }
  const children = childrenGroup(ownerDocument, node.depth);
  element.append(children);
  return { element, children };
}

/** Nests the planner's display-order nodes into branches under `group` (children of depth 0). */
function fillChildren(
  ownerDocument: Document,
  group: HTMLElement,
  nodes: readonly SidebarThreadTreeNodeView[],
  labels: SidebarThreadTreeLabels,
): void {
  const groups: HTMLElement[] = [group];
  for (const node of nodes) {
    groups.length = Math.min(groups.length, node.depth);
    const parent = groups[node.depth - 1] ?? group;
    const { element, children } = branch(ownerDocument, node, labels);
    parent.append(element);
    if (children) groups[node.depth] = children;
  }
}

function presentationValue(view: SidebarThreadTreeView, withRoot: boolean): unknown[] {
  return [
    view.threadId,
    view.expanded,
    view.descendants,
    view.activity,
    withRoot
      ? [
          view.root.title,
          view.root.agent,
          view.root.current,
          view.status,
          view.root.harness.signature,
        ]
      : view.root.title,
    view.nodes.map((node) => [
      node.threadId,
      node.depth,
      node.title,
      node.agent,
      node.harness.signature,
      node.status,
      node.current,
      node.descendants,
      node.expanded,
      node.activity,
    ]),
  ];
}

function presentationOf(view: SidebarThreadTreeView, withRoot: boolean, locale: string): string {
  return JSON.stringify([locale, ...presentationValue(view, withRoot)]);
}

function unitsPresentation(units: readonly SidebarThreadTreeView[], locale: string): string {
  return JSON.stringify([locale, units.map((unit) => presentationValue(unit, true))]);
}

type RailPlace = "first" | "middle" | "last";

function railPlace(index: number, count: number, startsRail: boolean): RailPlace {
  if (index === 0 && startsRail) return "first";
  return index === count - 1 ? "last" : "middle";
}

/** A tree drawn whole at the top level: its root as a codexhost row, then its summary or children. */
function unitBranch(
  ownerDocument: Document,
  unit: SidebarThreadTreeView,
  labels: SidebarThreadTreeLabels,
  place: RailPlace | null,
): HTMLElement {
  const { element, children } = branch(
    ownerDocument,
    {
      threadId: unit.threadId,
      depth: 0,
      status: unit.status,
      descendants: unit.descendants,
      expanded: unit.expanded,
      rollup: unit.rollup,
      activity: unit.activity,
      ...unit.root,
    },
    labels,
  );
  if (children) fillChildren(ownerDocument, children, unit.nodes, labels);
  if (place) element.setAttribute(SIDEBAR_TREE_RAIL_ATTRIBUTE, place);
  return element;
}

/** After expanding from a summary, which leaves the DOM, focus stays on its Thread's toggle. */
function focusToggleOf(scope: Element | null, threadId: string): void {
  if (!scope?.isConnected) return;
  for (const toggle of scope.querySelectorAll<HTMLElement>(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`)) {
    if (toggle.getAttribute(SIDEBAR_TREE_TOGGLE_ATTRIBUTE) !== threadId) continue;
    toggle.focus({ preventScroll: true });
    return;
  }
}

/** Delegated handling for everything codexhost draws inside one container. */
function wireContainer(container: HTMLElement, signal: AbortSignal): void {
  isolate(container, signal);
  const rowOf = (target: EventTarget | null) => {
    const row =
      closestAttribute(target, SIDEBAR_TREE_NODE_ATTRIBUTE) ??
      closestAttribute(target, SIDEBAR_TREE_SUMMARY_ATTRIBUTE);
    const threadId =
      row?.getAttribute(SIDEBAR_TREE_NODE_ATTRIBUTE) ??
      row?.getAttribute(SIDEBAR_TREE_SUMMARY_ATTRIBUTE);
    return row && threadId ? { row, threadId } : null;
  };
  // Desktop's own row actions come from the Thread's native row whenever the pointer or focus
  // reaches a codexhost row, so they always match what Desktop offers for that Thread.
  const offerActions = (event: Event): void => {
    const found = rowOf(event.target);
    const labels = currentLabels.get(container);
    if (!found || !labels || !found.row.hasAttribute(SIDEBAR_TREE_NODE_ATTRIBUTE)) return;
    syncActions(
      found.row,
      currentHandlers.get(container)?.native(found.threadId) ?? null,
      labels.actions,
    );
  };
  container.addEventListener("mouseover", offerActions, { signal });
  container.addEventListener("focusin", offerActions, { signal });
  // A secondary press opens Desktop's own menu for that Thread (pin, rename, archive, delete).
  // Desktop places a row's menu at the pointer, so it opens where the press happened. A Thread
  // without a Desktop row has no such menu; Desktop's menu of the open Thread stands in for it.
  container.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      const found = rowOf(event.target);
      if (!found) return;
      const handlers = currentHandlers.get(container);
      const native = handlers?.native(found.threadId);
      if (native) replay(native, "contextmenu", event);
      else handlers?.menu(found.threadId, found.row);
    },
    { signal },
  );
  // Double-clicking the open Thread's title renames it, as on a native row.
  container.addEventListener(
    "dblclick",
    (event) => {
      if (
        closestAttribute(event.target, SIDEBAR_TREE_TOGGLE_ATTRIBUTE) ||
        closestAttribute(event.target, SIDEBAR_TREE_ACTION_ATTRIBUTE) ||
        closestAttribute(event.target, SIDEBAR_TREE_MENU_ATTRIBUTE)
      )
        return;
      const row = closestAttribute(event.target, SIDEBAR_TREE_NODE_ATTRIBUTE);
      const threadId = row?.getAttribute(SIDEBAR_TREE_NODE_ATTRIBUTE);
      if (!row || !threadId || row.getAttribute("aria-current") !== "page") return;
      const title = currentHandlers
        .get(container)
        ?.native(threadId)
        ?.querySelector(NATIVE_TITLE_SELECTOR);
      if (title) replay(title, "dblclick", event);
    },
    { signal },
  );
  container.addEventListener(
    "click",
    (event) => {
      const handlers = currentHandlers.get(container);
      event.stopPropagation();
      if (!handlers) return;
      const menu = closestAttribute(event.target, SIDEBAR_TREE_MENU_ATTRIBUTE);
      if (menu) {
        event.preventDefault();
        const threadId = closestAttribute(menu, SIDEBAR_TREE_NODE_ATTRIBUTE)?.getAttribute(
          SIDEBAR_TREE_NODE_ATTRIBUTE,
        );
        if (threadId) handlers.menu(threadId, menu);
        return;
      }
      const action = closestAttribute(event.target, SIDEBAR_TREE_ACTION_ATTRIBUTE);
      if (action) {
        event.preventDefault();
        const threadId = closestAttribute(action, SIDEBAR_TREE_NODE_ATTRIBUTE)?.getAttribute(
          SIDEBAR_TREE_NODE_ATTRIBUTE,
        );
        if (threadId)
          pressNativeAction(
            handlers.native(threadId),
            action.getAttribute(SIDEBAR_TREE_ACTION_ATTRIBUTE) ?? "",
          );
        return;
      }
      const toggle = closestAttribute(event.target, SIDEBAR_TREE_TOGGLE_ATTRIBUTE);
      if (toggle) {
        event.preventDefault();
        handlers.toggle(toggle.getAttribute(SIDEBAR_TREE_TOGGLE_ATTRIBUTE) ?? "", toggle);
        return;
      }
      const expand = closestAttribute(event.target, SIDEBAR_TREE_EXPAND_ATTRIBUTE);
      if (expand) {
        const threadId = expand.getAttribute(SIDEBAR_TREE_EXPAND_ATTRIBUTE) ?? "";
        const focused = expand.ownerDocument.activeElement === expand;
        const scope = expand.closest('[role="listitem"]');
        handlers.toggle(threadId, expand);
        if (focused) focusToggleOf(scope, threadId);
        return;
      }
      // The rest of a row's block, its summary line included, acts as the row.
      const row =
        closestAttribute(event.target, SIDEBAR_TREE_NODE_ATTRIBUTE) ??
        closestAttribute(event.target, SIDEBAR_TREE_SUMMARY_ATTRIBUTE);
      const threadId =
        row?.getAttribute(SIDEBAR_TREE_NODE_ATTRIBUTE) ??
        row?.getAttribute(SIDEBAR_TREE_SUMMARY_ATTRIBUTE);
      if (row && threadId) handlers.open(threadId, row);
    },
    { signal },
  );
  container.addEventListener(
    "keydown",
    (event) => {
      const row = closestAttribute(event.target, SIDEBAR_TREE_NODE_ATTRIBUTE);
      if (!row || event.target !== row) {
        // Keys on codexhost controls stay with them; Desktop's row handles keys of its own.
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        currentHandlers
          .get(container)
          ?.open(row.getAttribute(SIDEBAR_TREE_NODE_ATTRIBUTE) ?? "", row);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const rows = [...container.querySelectorAll<HTMLElement>(`[${SIDEBAR_TREE_NODE_ATTRIBUTE}]`)];
      const next = rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      next.focus();
    },
    { signal },
  );
}

/** Rebuilds `container` when what it shows changed; keyboard focus stays on the same control. */
function rebuild(container: HTMLElement, presentation: string, build: () => Node[]): void {
  if (container.getAttribute(PRESENTATION_ATTRIBUTE) === presentation) return;
  container.setAttribute(PRESENTATION_ATTRIBUTE, presentation);
  const ownerDocument = container.ownerDocument;
  const active = ownerDocument.activeElement;
  const focusedRow =
    active && container.contains(active)
      ? closestAttribute(active, SIDEBAR_TREE_KEY_ATTRIBUTE)
      : null;
  const focusedKey = focusedRow?.getAttribute(SIDEBAR_TREE_KEY_ATTRIBUTE) ?? null;
  const toggleFocused =
    focusedKey !== null && closestAttribute(active, SIDEBAR_TREE_TOGGLE_ATTRIBUTE) !== null;
  // A summary button outside any row, such as a native root's, is found again by its Thread.
  const focusedExpand =
    active && container.contains(active)
      ? (closestAttribute(active, SIDEBAR_TREE_EXPAND_ATTRIBUTE)?.getAttribute(
          SIDEBAR_TREE_EXPAND_ATTRIBUTE,
        ) ?? null)
      : null;
  container.replaceChildren(...build());
  if (focusedKey === null) {
    if (focusedExpand === null) return;
    for (const expand of container.querySelectorAll<HTMLElement>(
      `[${SIDEBAR_TREE_EXPAND_ATTRIBUTE}]`,
    )) {
      if (expand.getAttribute(SIDEBAR_TREE_EXPAND_ATTRIBUTE) !== focusedExpand) continue;
      expand.focus({ preventScroll: true });
      return;
    }
    return;
  }
  for (const candidate of container.querySelectorAll<HTMLElement>(
    `[${SIDEBAR_TREE_KEY_ATTRIBUTE}]`,
  )) {
    if (candidate.getAttribute(SIDEBAR_TREE_KEY_ATTRIBUTE) !== focusedKey) continue;
    const control = toggleFocused
      ? candidate.querySelector<HTMLElement>(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`)
      : candidate.tabIndex >= 0
        ? candidate
        : candidate.querySelector<HTMLElement>("button");
    (control ?? candidate).focus({ preventScroll: true });
    return;
  }
}

function createToggle(ownerDocument: Document, signal: AbortSignal): HTMLElement {
  const toggle = ownerDocument.createElement("button");
  toggle.type = "button";
  toggle.className = SIDEBAR_TREE_TOGGLE_CLASS;
  toggle.append(chevron(ownerDocument));
  isolate(toggle, signal);
  toggle.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    },
    { signal },
  );
  toggle.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const control = event.currentTarget as HTMLElement;
      const threadId = control.getAttribute(SIDEBAR_TREE_TOGGLE_ATTRIBUTE);
      if (threadId) currentHandlers.get(control)?.toggle(threadId, control);
    },
    { signal },
  );
  return toggle;
}

/** Toggle over the Agent icon of a native row; the icon and title never move. */
function placeToggle(
  api: DesktopExtensionApiV1,
  row: HTMLElement,
  trigger: HTMLElement,
  view: SidebarThreadTreeView,
  labels: SidebarThreadTreeLabels,
  handlers: SidebarThreadTreeHandlers,
): void {
  const ownerDocument = row.ownerDocument;
  const toggle =
    row.querySelector<HTMLElement>(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`) ??
    createToggle(ownerDocument, api.signal);
  currentHandlers.set(toggle, handlers);
  const label = view.expanded ? labels.collapse(view.descendants) : labels.expand(view.descendants);
  if (toggle.getAttribute(SIDEBAR_TREE_TOGGLE_ATTRIBUTE) !== view.threadId)
    toggle.setAttribute(SIDEBAR_TREE_TOGGLE_ATTRIBUTE, view.threadId);
  if (toggle.getAttribute("aria-expanded") !== String(view.expanded))
    toggle.setAttribute("aria-expanded", String(view.expanded));
  if (toggle.getAttribute("aria-label") !== label) {
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  }
  const icon =
    trigger.querySelector<HTMLElement>(AGENT_ICON_SELECTOR) ??
    row.querySelector<HTMLElement>(AGENT_ICON_SELECTOR);
  // Position against the row's coordinate system so Desktop layout changes cannot shift it.
  if (icon) {
    if (icon.previousElementSibling !== toggle) api.dom.mount(toggle, icon, "before");
  } else if (trigger.firstElementChild !== toggle) {
    api.dom.mount(toggle, trigger, "prepend");
  }
  const rowRect = row.getBoundingClientRect();
  if (rowRect.height === 0) return;
  const target = (icon ?? trigger).getBoundingClientRect();
  setVariable(toggle, "left", `${String(Math.round(target.left - rowRect.left))}px`);
  setVariable(toggle, "top", `${String(Math.round((rowRect.height - 20) / 2))}px`);
}

/**
 * Shows `view` on a native root row: the icon toggle and the summary or the children, then the
 * trees of the Threads it continues after context handoffs, with their rail.
 */
export function renderSidebarThreadTreeRoot(
  api: DesktopExtensionApiV1,
  row: HTMLElement,
  view: SidebarThreadTreeView,
  labels: SidebarThreadTreeLabels,
  handlers: SidebarThreadTreeHandlers,
  locale: string,
): boolean {
  const parts = nativeParts(row);
  const handoff = view.handoff ?? [];
  if (!parts || (view.descendants === 0 && handoff.length === 0)) {
    clearSidebarThreadTreeRow(api, row);
    return false;
  }
  const { trigger, item } = parts;
  const ownerDocument = row.ownerDocument;
  clearVirtual(api, item);
  const metrics = metricsFor(api.id, row, item);

  let tree: HTMLElement | null = null;
  if (view.descendants === 0) {
    clearNativeRoot(api, row, item);
  } else {
    placeToggle(api, row, trigger, view, labels, handlers);
    setMark(api, item, "root-expanded", view.expanded);
    setMark(api, item, "root-collapsed", !view.expanded);

    const attribute = view.expanded
      ? SIDEBAR_TREE_CHILDREN_ATTRIBUTE
      : SIDEBAR_TREE_SUMMARY_ATTRIBUTE;
    ownedChild(
      item,
      view.expanded ? SIDEBAR_TREE_SUMMARY_ATTRIBUTE : SIDEBAR_TREE_CHILDREN_ATTRIBUTE,
    )?.remove();
    let container = ownedChild(item, attribute);
    if (!container) {
      container = ownerDocument.createElement("div");
      if (view.expanded) {
        container.className = SIDEBAR_TREE_CHILDREN_CLASS;
        container.setAttribute("role", "group");
        container.setAttribute("data-guide", "");
        container.style.setProperty("--cxh-guide-indent", "0px");
      } else {
        container.className = SIDEBAR_TREE_SUMMARY_LINE_CLASS;
      }
      wireContainer(container, api.signal);
    }
    if (container.getAttribute(attribute) !== view.threadId)
      container.setAttribute(attribute, view.threadId);
    currentHandlers.set(container, handlers);
    currentLabels.set(container, labels);
    applyMetrics(container, metrics);
    rebuild(container, presentationOf(view, false, locale), () => {
      if (!view.expanded) {
        return [
          summaryButton(
            ownerDocument,
            {
              threadId: view.threadId,
              title: view.root.title,
              descendants: view.descendants,
              activity: view.activity,
            },
            labels,
          ),
        ];
      }
      const holder = ownerDocument.createElement("div");
      fillChildren(ownerDocument, holder, view.nodes, labels);
      return [...holder.childNodes];
    });
    tree = container;
  }

  let group = ownedChild(item, SIDEBAR_TREE_HANDOFF_ATTRIBUTE);
  if (handoff.length === 0) {
    group?.remove();
    group = null;
  } else {
    if (!group) {
      group = ownerDocument.createElement("div");
      group.className = SIDEBAR_TREE_HANDOFF_CLASS;
      group.setAttribute("role", "group");
      wireContainer(group, api.signal);
    }
    if (group.getAttribute(SIDEBAR_TREE_HANDOFF_ATTRIBUTE) !== view.threadId)
      group.setAttribute(SIDEBAR_TREE_HANDOFF_ATTRIBUTE, view.threadId);
    currentHandlers.set(group, handlers);
    currentLabels.set(group, labels);
    applyMetrics(group, metrics);
    const units = handoff;
    rebuild(group, unitsPresentation(units, locale), () =>
      units.map((unit, index) =>
        unitBranch(ownerDocument, unit, labels, railPlace(index, units.length, false)),
      ),
    );
  }

  // The rail starts at the row's icon, on the first element after the row.
  const head = handoff.length > 0 ? (tree ?? group) : null;
  for (const element of [tree, group]) {
    if (element) element.toggleAttribute(SIDEBAR_TREE_RAIL_HEAD_ATTRIBUTE, element === head);
  }
  // React may re-insert the row's own content after these; keep codexhost content last, in order.
  const owned = [tree, group].filter((element): element is HTMLElement => element !== null);
  const tail = [...item.children].slice(-owned.length);
  if (owned.some((element, index) => tail[index] !== element)) {
    for (const element of owned) api.dom.mount(element, item, "append");
  }
  return true;
}

/**
 * Shows `view` in place of a member's row, whose native content is hidden meanwhile, followed by
 * the trees of the Threads it continues after context handoffs, with their rail.
 */
export function renderSidebarThreadTreeVirtual(
  api: DesktopExtensionApiV1,
  row: HTMLElement,
  view: SidebarThreadTreeView,
  labels: SidebarThreadTreeLabels,
  handlers: SidebarThreadTreeHandlers,
  locale: string,
): boolean {
  const parts = nativeParts(row);
  const handoff = view.handoff ?? [];
  if (!parts || (view.descendants === 0 && handoff.length === 0)) {
    clearSidebarThreadTreeRow(api, row);
    return false;
  }
  const { item } = parts;
  const ownerDocument = row.ownerDocument;
  clearNativeRoot(api, row, item);
  clearHandoff(item);
  // Measure before the native content is hidden; afterwards the list's measurement is reused.
  const metrics = metricsFor(api.id, row, item);
  setMark(api, item, "anchor", true);
  let container = ownedChild(item, SIDEBAR_TREE_VIRTUAL_ATTRIBUTE);
  if (!container) {
    container = ownerDocument.createElement("div");
    container.className = SIDEBAR_TREE_VIRTUAL_CLASS;
    // Its root row is a treeitem, which needs a group or tree around it.
    container.setAttribute("role", "group");
    wireContainer(container, api.signal);
  }
  if (container.getAttribute(SIDEBAR_TREE_VIRTUAL_ATTRIBUTE) !== view.threadId)
    container.setAttribute(SIDEBAR_TREE_VIRTUAL_ATTRIBUTE, view.threadId);
  container.toggleAttribute(SIDEBAR_TREE_RAIL_ATTRIBUTE, handoff.length > 0);
  currentHandlers.set(container, handlers);
  currentLabels.set(container, labels);
  applyMetrics(container, metrics);
  if (item.firstElementChild !== container) api.dom.mount(container, item, "prepend");
  const presentation =
    handoff.length === 0
      ? presentationOf(view, true, locale)
      : unitsPresentation([view, ...handoff], locale);
  rebuild(container, presentation, () => {
    const units = [view, ...handoff];
    return units.map((unit, index) =>
      unitBranch(
        ownerDocument,
        unit,
        labels,
        handoff.length === 0 ? null : railPlace(index, units.length, true),
      ),
    );
  });
  return true;
}

function clearNativeRoot(api: DesktopExtensionApiV1, row: HTMLElement, item: HTMLElement): void {
  row.querySelector(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`)?.remove();
  ownedChild(item, SIDEBAR_TREE_SUMMARY_ATTRIBUTE)?.remove();
  ownedChild(item, SIDEBAR_TREE_CHILDREN_ATTRIBUTE)?.remove();
  setMark(api, item, "root-collapsed", false);
  setMark(api, item, "root-expanded", false);
}

function clearHandoff(item: HTMLElement): void {
  ownedChild(item, SIDEBAR_TREE_HANDOFF_ATTRIBUTE)?.remove();
}

function clearVirtual(api: DesktopExtensionApiV1, item: HTMLElement): void {
  ownedChild(item, SIDEBAR_TREE_VIRTUAL_ATTRIBUTE)?.remove();
  setMark(api, item, "anchor", false);
}

/** Removes everything this module added to one native row and its listitem. */
export function clearSidebarThreadTreeRow(api: DesktopExtensionApiV1, row: HTMLElement): void {
  const item = row.closest<HTMLElement>('[role="listitem"]');
  if (!item) {
    row.querySelector(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`)?.remove();
    return;
  }
  clearNativeRoot(api, row, item);
  clearHandoff(item);
  clearVirtual(api, item);
}

/** Hides or restores the listitem of a native row whose Thread is shown in a tree above it. */
export function setSidebarThreadTreeRowHidden(
  api: DesktopExtensionApiV1,
  row: HTMLElement,
  hidden: boolean,
): void {
  const item = row.closest<HTMLElement>('[role="listitem"]');
  if (!item) return;
  setMark(api, item, "hidden", hidden);
}

/** Cancels active motion when tearing down. Mounted DOM and marks are reclaimed by the host. */
export function clearSidebarThreadTree(api: DesktopExtensionApiV1, root: ParentNode): void {
  cancelSidebarThreadTreeMotion();
  if (!api.signal.aborted) {
    const marks: SidebarTreeMarkName[] = ["hidden", "root-collapsed", "root-expanded", "anchor"];
    for (const name of marks) {
      const attr = markAttribute(api.id, name);
      for (const item of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
        api.dom.unmark(item, name);
      }
    }
  }
  for (const node of root.querySelectorAll(SIDEBAR_TREE_OWNED_SELECTOR)) node.remove();
}
