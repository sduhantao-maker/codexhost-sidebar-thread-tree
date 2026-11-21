(() => {
  // src/motion.ts
  var SIDEBAR_TREE_MOTION_ATTRIBUTE = "data-codexhost-sidebar-tree-motion";
  var ROW_FADE_MS = 100;
  var ROW_GLIDE_MS = 300;
  var ROW_GLIDE_EASING = "cubic-bezier(0.19, 1, 0.22, 1)";
  var SCROLL_SELECTOR = "[data-app-action-sidebar-scroll]";
  var ROW_KEY_ATTRIBUTE = "data-codexhost-sidebar-tree-key";
  var ROW_SELECTOR = `[${ROW_KEY_ATTRIBUTE}^="row:"], [${ROW_KEY_ATTRIBUTE}^="summary:"]`;
  var INHERITED_PROPERTIES = [
    "--cxh-icon-left",
    "--cxh-indent",
    "--cxh-row-h",
    "--cxh-row-radius",
    "--cxh-row-pad-end",
    "--cxh-title-gap",
    "--cxh-title-size",
    "--cxh-title-line",
    "--cxh-title-weight",
    "--cxh-title-color",
    "--cxh-summary-start",
    "font-family",
    "color"
  ];
  function ownerRowKey(key) {
    return key.startsWith("summary:") ? `row:${key.slice("summary:".length)}` : null;
  }
  var movements = /* @__PURE__ */ new Map();
  var exits = /* @__PURE__ */ new Set();
  function intersects(rect, viewport) {
    return rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left && rect.left < viewport.right;
  }
  function collectBlocks(element, view, out) {
    if (!(element instanceof view.HTMLElement) || element.hasAttribute(SIDEBAR_TREE_MOTION_ATTRIBUTE))
      return;
    if (view.getComputedStyle(element).display === "contents") {
      for (const child of element.children) collectBlocks(child, view, out);
      return;
    }
    out.set(element, element.getBoundingClientRect());
  }
  function captureSidebarThreadTreeMotion(item) {
    const view = item.ownerDocument.defaultView;
    const viewport = item.closest(SCROLL_SELECTOR);
    if (!view || !viewport || typeof item.animate !== "function" || view.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      return null;
    const bounds = viewport.getBoundingClientRect();
    const rows = /* @__PURE__ */ new Map();
    for (const element of item.querySelectorAll(ROW_SELECTOR)) {
      const key = element.getAttribute(ROW_KEY_ATTRIBUTE);
      if (!key) continue;
      const rect = element.getBoundingClientRect();
      let clone = null;
      if (intersects(rect, bounds)) {
        clone = element.cloneNode(true);
        for (const attribute of [...clone.attributes]) {
          const name = attribute.name;
          if (name.startsWith("data-") || name.startsWith("aria-") || name === "tabindex" || name === "role")
            clone.removeAttribute(name);
        }
        clone.inert = true;
        const style = view.getComputedStyle(element);
        for (const name of INHERITED_PROPERTIES)
          clone.style.setProperty(name, style.getPropertyValue(name));
        clone.style.opacity = style.opacity;
      }
      rows.set(key, { rect, clone });
    }
    const blocks = /* @__PURE__ */ new Map();
    for (let node = item; node && node !== viewport; node = node.parentElement) {
      for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling)
        collectBlocks(sibling, view, blocks);
    }
    return { item, viewport, rows, blocks };
  }
  function move(element, keyframes, duration, easing = "ease-out") {
    const animation = element.animate(keyframes, { duration, easing });
    movements.set(element, animation);
    animation.onfinish = () => {
      if (movements.get(element) === animation) movements.delete(element);
      animation.cancel();
    };
  }
  function glide(element, from, to) {
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx === 0 && dy === 0) return;
    move(
      element,
      [
        { transform: `translate(${String(dx)}px, ${String(dy)}px)` },
        { transform: "translate(0, 0)" }
      ],
      ROW_GLIDE_MS,
      ROW_GLIDE_EASING
    );
  }
  function clips(overflow) {
    return overflow !== "" && overflow !== "visible";
  }
  function visibleArea(item, viewport, bounds) {
    const view = item.ownerDocument.defaultView;
    let left = bounds.left + viewport.clientLeft;
    let top = bounds.top + viewport.clientTop;
    let right = left + viewport.clientWidth;
    let bottom = top + viewport.clientHeight;
    for (let node = item.parentElement; view && node && node !== viewport; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (!clips(style.overflowX) && !clips(style.overflowY)) continue;
      const rect = node.getBoundingClientRect();
      left = Math.max(left, rect.left);
      top = Math.max(top, rect.top);
      right = Math.min(right, rect.right);
      bottom = Math.min(bottom, rect.bottom);
    }
    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  }
  function cancelSidebarThreadTreeMotion() {
    for (const animation of movements.values()) {
      animation.onfinish = null;
      animation.cancel();
    }
    movements.clear();
    for (const overlay of exits) overlay.remove();
    exits.clear();
  }
  function playSidebarThreadTreeMotion(motion, mountOverlay) {
    const { item, viewport, rows, blocks } = motion;
    cancelSidebarThreadTreeMotion();
    if (!viewport.isConnected) return;
    const bounds = viewport.getBoundingClientRect();
    const present = /* @__PURE__ */ new Set();
    if (item.isConnected) {
      for (const element of item.querySelectorAll(ROW_SELECTOR)) {
        const key = element.getAttribute(ROW_KEY_ATTRIBUTE);
        if (!key) continue;
        present.add(key);
        const rect = element.getBoundingClientRect();
        const before = rows.get(key);
        if (!intersects(rect, bounds) && (!before || !intersects(before.rect, bounds))) continue;
        if (before) glide(element, before.rect, rect);
        else if (!rows.has(ownerRowKey(key) ?? ""))
          move(element, [{ opacity: 0 }, { opacity: 1 }], ROW_FADE_MS);
      }
    }
    for (const [element, before] of blocks) {
      if (!element.isConnected) continue;
      const rect = element.getBoundingClientRect();
      if (intersects(rect, bounds) || intersects(before, bounds)) glide(element, before, rect);
    }
    const leaving = [...rows].filter(
      ([key, row]) => !present.has(key) && row.clone !== null && !present.has(ownerRowKey(key) ?? "")
    );
    if (leaving.length === 0) return;
    const area = visibleArea(item.isConnected ? item : viewport, viewport, bounds);
    const ownerDocument = viewport.ownerDocument;
    const overlay = ownerDocument.createElement("div");
    overlay.setAttribute(SIDEBAR_TREE_MOTION_ATTRIBUTE, "");
    overlay.setAttribute("aria-hidden", "true");
    overlay.inert = true;
    Object.assign(overlay.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      width: `${String(area.width)}px`,
      height: `${String(area.height)}px`,
      overflow: "clip",
      pointerEvents: "none",
      zIndex: "2",
      contain: "strict"
    });
    if (mountOverlay) mountOverlay(overlay, viewport);
    else viewport.append(overlay);
    const placed = overlay.getBoundingClientRect();
    const left = area.left - placed.left;
    const top = area.top - placed.top;
    overlay.style.left = `${String(left)}px`;
    overlay.style.top = `${String(top)}px`;
    const originLeft = area.left;
    const originTop = area.top;
    exits.add(overlay);
    let remaining = leaving.length;
    for (const [, row] of leaving) {
      const clone = row.clone;
      Object.assign(clone.style, {
        position: "absolute",
        margin: "0",
        transform: "none",
        boxSizing: "border-box",
        left: `${String(row.rect.left - originLeft)}px`,
        top: `${String(row.rect.top - originTop)}px`,
        width: `${String(row.rect.width)}px`,
        height: `${String(row.rect.height)}px`
      });
      overlay.append(clone);
      const animation = clone.animate([{ opacity: clone.style.opacity || "1" }, { opacity: 0 }], {
        duration: ROW_FADE_MS,
        easing: "ease-out",
        fill: "forwards"
      });
      animation.onfinish = () => {
        remaining -= 1;
        if (remaining > 0) return;
        overlay.remove();
        exits.delete(overlay);
      };
    }
  }

  // src/tree.ts
  var STATUS_PRIORITY = {
    pending: 0,
    running: 1,
    unknown: 2,
    idle: 3
  };
  function mostUrgentSidebarThreadStatus(statuses) {
    let result = "idle";
    for (const status of statuses) {
      if (STATUS_PRIORITY[status] < STATUS_PRIORITY[result]) result = status;
    }
    return result;
  }
  var SIDEBAR_THREAD_TREE_MAX_INDENT_DEPTH = 3;
  var MAX_ANCESTRY = 64;
  function planSidebarThreadTree(input) {
    const { threads } = input;
    const ancestry = (threadId) => {
      const seen = /* @__PURE__ */ new Set([threadId]);
      let depth = 0;
      for (let current = Object.hasOwn(input.parents, threadId) ? input.parents[threadId] : void 0; current !== void 0; current = Object.hasOwn(input.parents, current) ? input.parents[current] : void 0) {
        if (seen.has(current) || depth >= MAX_ANCESTRY) return null;
        seen.add(current);
        depth += 1;
      }
      return depth;
    };
    const depths = /* @__PURE__ */ new Map();
    const parentOf = (threadId) => {
      if (!Object.hasOwn(input.parents, threadId) || input.parents[threadId] === void 0)
        return void 0;
      let depth = depths.get(threadId);
      if (depth === void 0) depths.set(threadId, depth = ancestry(threadId) ?? -1);
      return depth < 0 ? void 0 : input.parents[threadId];
    };
    const showable = (threadId) => {
      const thread = threads.get(threadId);
      return thread !== void 0 && !thread.archived;
    };
    const childrenOf = /* @__PURE__ */ new Map();
    for (const childId of Object.keys(input.parents)) {
      const parentId = parentOf(childId);
      if (parentId === void 0 || !showable(childId)) continue;
      let siblings = childrenOf.get(parentId);
      if (!siblings) childrenOf.set(parentId, siblings = []);
      siblings.push(childId);
    }
    for (const siblings of childrenOf.values()) {
      siblings.sort(
        (left, right) => (threads.get(right)?.order ?? 0) - (threads.get(left)?.order ?? 0) || (left < right ? -1 : left > right ? 1 : 0)
      );
    }
    const topOf = (threadId) => {
      let current = threadId;
      for (let parentId = parentOf(current); parentId !== void 0; parentId = parentOf(current)) {
        if (!showable(current) || !showable(parentId)) break;
        current = parentId;
      }
      return current;
    };
    const walk = (parentId, depth, emit, out) => {
      let count = 0;
      const statuses = [];
      for (const childId of childrenOf.get(parentId) ?? []) {
        const status = threads.get(childId)?.status ?? "idle";
        const expanded = input.expanded(childId);
        const node = {
          threadId: childId,
          depth,
          status,
          descendants: 0,
          expanded,
          rollup: "idle",
          activity: { running: 0, pending: 0 }
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
    const trees = /* @__PURE__ */ new Map();
    const treeOf = (rootId) => {
      let tree = trees.get(rootId);
      if (!tree) {
        const nodes = [];
        const expanded = input.expanded(rootId);
        const { count, statuses } = walk(rootId, 1, expanded, nodes);
        tree = {
          threadId: rootId,
          status: threads.get(rootId)?.status ?? "idle",
          descendants: count,
          expanded,
          rollup: mostUrgentSidebarThreadStatus(statuses),
          activity: activityOf(statuses),
          nodes
        };
        trees.set(rootId, tree);
      }
      return tree;
    };
    const plans = /* @__PURE__ */ new Map();
    const placed = /* @__PURE__ */ new Set();
    for (const row of input.rows) {
      const rootId = topOf(row.threadId);
      const tree = showable(rootId) ? treeOf(rootId) : null;
      if (!tree || tree.descendants === 0) {
        plans.set(row.key, { kind: "plain" });
        continue;
      }
      const group = `${row.list}\0${rootId}`;
      if (placed.has(group)) {
        plans.set(row.key, { kind: "hidden", rootId });
        continue;
      }
      placed.add(group);
      plans.set(row.key, { kind: row.threadId === rootId ? "root" : "virtual", tree });
    }
    return plans;
  }
  function activityOf(statuses) {
    let running = 0;
    let pending = 0;
    for (const status of statuses) {
      if (status === "running") running += 1;
      else if (status === "pending") pending += 1;
    }
    return { running, pending };
  }

  // src/dom.ts
  var SIDEBAR_TREE_TOGGLE_CLASS = "cxh-tree-toggle";
  var SIDEBAR_TREE_CHEVRON_CLASS = "cxh-tree-chevron";
  var SIDEBAR_TREE_SUMMARY_LINE_CLASS = "cxh-tree-summary-line";
  var SIDEBAR_TREE_SUMMARY_CLASS = "cxh-tree-summary";
  var SIDEBAR_TREE_CHILDREN_CLASS = "cxh-tree-children";
  var SIDEBAR_TREE_BRANCH_CLASS = "cxh-tree-branch";
  var SIDEBAR_TREE_ROW_CLASS = "cxh-tree-row";
  var SIDEBAR_TREE_IDENTITY_CLASS = "cxh-tree-identity";
  var SIDEBAR_TREE_TITLE_CLASS = "cxh-tree-title";
  var SIDEBAR_TREE_STATUS_CLASS = "cxh-tree-status";
  var SIDEBAR_TREE_VIRTUAL_CLASS = "cxh-tree-virtual";
  var SIDEBAR_TREE_INDENT_PX = 24;
  var SIDEBAR_TREE_ICON_PX = 14;
  var SIDEBAR_TREE_TOGGLE_ATTRIBUTE = "data-codexhost-sidebar-tree-toggle";
  var SIDEBAR_TREE_EXPAND_ATTRIBUTE = "data-codexhost-sidebar-tree-expand";
  var SIDEBAR_TREE_SUMMARY_ATTRIBUTE = "data-codexhost-sidebar-tree-summary";
  var SIDEBAR_TREE_CHILDREN_ATTRIBUTE = "data-codexhost-sidebar-tree-children";
  var SIDEBAR_TREE_VIRTUAL_ATTRIBUTE = "data-codexhost-sidebar-tree-virtual";
  var SIDEBAR_TREE_NODE_ATTRIBUTE = "data-codexhost-sidebar-tree-node";
  var SIDEBAR_TREE_KEY_ATTRIBUTE = "data-codexhost-sidebar-tree-key";
  var SIDEBAR_TREE_OWNED_SELECTOR = [
    SIDEBAR_TREE_TOGGLE_ATTRIBUTE,
    SIDEBAR_TREE_SUMMARY_ATTRIBUTE,
    SIDEBAR_TREE_CHILDREN_ATTRIBUTE,
    SIDEBAR_TREE_VIRTUAL_ATTRIBUTE,
    SIDEBAR_TREE_MOTION_ATTRIBUTE
  ].map((name) => `[${name}]`).join(", ");
  var SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  var PRESENTATION_ATTRIBUTE = "data-codexhost-sidebar-tree-presentation";
  var NATIVE_ROW_SELECTOR = "[data-app-action-sidebar-thread-row]";
  var AGENT_ICON_SELECTOR = "[data-codexhost-sidebar-agent-icon]";
  var ACTIVE_ATTRIBUTE = "data-app-action-sidebar-thread-active";
  var SELECTED_ATTRIBUTE = "data-app-action-sidebar-thread-selected";
  var CYCLE_ITEM_ATTRIBUTE = "data-sidebar-cycle-item";
  var DEFAULT_METRICS = {
    iconLeft: 32,
    titleLeft: 54,
    rowHeight: 30,
    radius: "10px",
    padEnd: 5,
    gap: 0,
    titleSize: "14px",
    titleLine: "20px",
    titleWeight: "inherit",
    titleColor: "inherit"
  };
  var metricsByList = /* @__PURE__ */ new WeakMap();
  var measuredInPass = /* @__PURE__ */ new WeakMap();
  var measuringPass = 0;
  var currentHandlers = /* @__PURE__ */ new WeakMap();
  var ISOLATED_EVENTS = [
    "pointerdown",
    "mousedown",
    "dblclick",
    "auxclick",
    "contextmenu",
    "dragstart"
  ];
  function stopNative(event) {
    event.stopPropagation();
  }
  function isolate(element, signal) {
    for (const type of ISOLATED_EVENTS) element.addEventListener(type, stopNative, { signal });
  }
  function pixels(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function setVariable(element, name, value) {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }
  function closestAttribute(target, attribute) {
    const view = target?.ownerDocument?.defaultView;
    return view && target instanceof view.Element ? target.closest(`[${attribute}]`) : null;
  }
  function ownedChild(parent, attribute) {
    for (const child of parent.children) {
      if (child.hasAttribute(attribute)) return child;
    }
    return null;
  }
  function nativeParts(row) {
    const trigger = row.querySelector("[data-thread-title-trigger]");
    const item = row.closest('[role="listitem"]');
    return trigger && item ? { trigger, item } : null;
  }
  function markAttribute(apiId, name) {
    return `data-cx-${apiId}-${name}`;
  }
  function setMark(api, target, name, present) {
    const has = target.hasAttribute(markAttribute(api.id, name));
    if (present && !has) api.dom.mark(target, name);
    else if (!present && has) api.dom.unmark(target, name);
  }
  function canRenderSidebarThreadTree(row) {
    return nativeParts(row) !== null;
  }
  function* laidOutRows(row, list) {
    if (row.getBoundingClientRect().height > 0) yield row;
    if (!list) return;
    for (const candidate of list.querySelectorAll(NATIVE_ROW_SELECTOR)) {
      if (candidate === row || candidate.closest('[role="listitem"]')?.parentElement !== list)
        continue;
      if (candidate.getBoundingClientRect().height > 0) yield candidate;
    }
  }
  function plainRow(row) {
    return row.getAttribute(ACTIVE_ATTRIBUTE) !== "true" && row.getAttribute(SELECTED_ATTRIBUTE) !== "true";
  }
  function metricsFor(apiId, row, item) {
    const list = item.parentElement;
    if (list && measuredInPass.get(list) === measuringPass)
      return metricsByList.get(list) ?? DEFAULT_METRICS;
    const view = row.ownerDocument.defaultView;
    let measured = null;
    let textRow = null;
    if (view) {
      for (const candidate of laidOutRows(row, list)) {
        measured ??= candidate;
        if (!plainRow(candidate)) continue;
        textRow = candidate;
        break;
      }
    }
    const measuredItem = measured?.closest('[role="listitem"]');
    if (!view || !measured || !measuredItem) {
      if (list) measuredInPass.set(list, measuringPass);
      return (list && metricsByList.get(list)) ?? DEFAULT_METRICS;
    }
    const itemRect = measuredItem.getBoundingClientRect();
    const rowRect = measured.getBoundingClientRect();
    const trigger = measured.querySelector("[data-thread-title-trigger]");
    const icon = measured.querySelector(AGENT_ICON_SELECTOR);
    const title = measured.querySelector("[data-thread-title]");
    const textTitle = (textRow ?? measured).querySelector("[data-thread-title]");
    const rowStyle = view.getComputedStyle(measured);
    const iconLeft = (icon ?? trigger)?.getBoundingClientRect().left ?? itemRect.left + DEFAULT_METRICS.iconLeft;
    const titleRect = title?.getBoundingClientRect();
    const titleStyle = textTitle ? view.getComputedStyle(textTitle) : null;
    const plainItem = !measuredItem.hasAttribute(markAttribute(apiId, "root-collapsed")) && !measuredItem.hasAttribute(markAttribute(apiId, "root-expanded")) && !measuredItem.hasAttribute(markAttribute(apiId, "anchor")) && !measuredItem.querySelector(SIDEBAR_TREE_OWNED_SELECTOR);
    const metrics = {
      iconLeft: Math.round(iconLeft - itemRect.left),
      titleLeft: Math.round((titleRect?.left ?? iconLeft + SIDEBAR_TREE_ICON_PX + 8) - itemRect.left),
      rowHeight: rowRect.height,
      radius: pixels(rowStyle.borderTopLeftRadius) > 0 ? rowStyle.borderTopLeftRadius : DEFAULT_METRICS.radius,
      padEnd: pixels(rowStyle.paddingInlineEnd) || DEFAULT_METRICS.padEnd,
      gap: plainItem ? Math.max(0, Math.round(itemRect.height - rowRect.height)) : (list && metricsByList.get(list)?.gap) ?? DEFAULT_METRICS.gap,
      titleSize: titleStyle?.fontSize || DEFAULT_METRICS.titleSize,
      titleLine: titleStyle?.lineHeight || DEFAULT_METRICS.titleLine,
      titleWeight: titleStyle?.fontWeight || DEFAULT_METRICS.titleWeight,
      titleColor: titleStyle?.color || DEFAULT_METRICS.titleColor
    };
    if (list) {
      metricsByList.set(list, metrics);
      measuredInPass.set(list, measuringPass);
    }
    return metrics;
  }
  function measureSidebarThreadTreeRows(apiId, rows) {
    measuringPass += 1;
    for (const row of rows) {
      const item = row.closest('[role="listitem"]');
      if (item) metricsFor(apiId, row, item);
    }
  }
  function applyMetrics(element, metrics) {
    setVariable(element, "--cxh-icon-left", `${String(metrics.iconLeft)}px`);
    setVariable(element, "--cxh-row-h", `${String(metrics.rowHeight)}px`);
    setVariable(element, "--cxh-row-radius", metrics.radius);
    setVariable(element, "--cxh-row-pad-end", `${String(metrics.padEnd)}px`);
    setVariable(element, "--cxh-gap", `${String(metrics.gap)}px`);
    setVariable(
      element,
      "--cxh-title-gap",
      `${String(Math.max(4, metrics.titleLeft - metrics.iconLeft - SIDEBAR_TREE_ICON_PX))}px`
    );
    setVariable(element, "--cxh-title-size", metrics.titleSize);
    setVariable(element, "--cxh-title-line", metrics.titleLine);
    setVariable(element, "--cxh-title-weight", metrics.titleWeight);
    setVariable(element, "--cxh-title-color", metrics.titleColor);
    setVariable(element, "--cxh-summary-start", `${String(Math.max(0, metrics.titleLeft - 8))}px`);
  }
  function indentOf(depth) {
    return `${String(Math.min(depth, SIDEBAR_THREAD_TREE_MAX_INDENT_DEPTH) * SIDEBAR_TREE_INDENT_PX)}px`;
  }
  function createAgentIconElement(harness, size, ownerDocument) {
    const sampled = harness.sampled;
    if (sampled) {
      const tag = sampled.tagName.toLowerCase();
      if (tag === "svg") {
        const clone = sampled.cloneNode(true);
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
          const sampledImage = sampled;
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
  function chevron(ownerDocument) {
    const element = ownerDocument.createElement("span");
    element.className = SIDEBAR_TREE_CHEVRON_CLASS;
    element.setAttribute("aria-hidden", "true");
    return element;
  }
  function spinner(ownerDocument) {
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
  function statusNode(ownerDocument, status, label) {
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
  function summaryParts(count, activity, labels) {
    const parts = [{ text: labels.children(count) }];
    if (activity.running > 0)
      parts.push({ text: ` \xB7 ${labels.running(activity.running)}`, activity: "running" });
    if (activity.pending > 0)
      parts.push({ text: ` \xB7 ${labels.pending(activity.pending)}`, activity: "pending" });
    return parts;
  }
  function summaryButton(ownerDocument, node, labels) {
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.className = SIDEBAR_TREE_SUMMARY_CLASS;
    button.setAttribute(SIDEBAR_TREE_EXPAND_ATTRIBUTE, node.threadId);
    button.setAttribute("aria-expanded", "false");
    const parts = summaryParts(node.descendants, node.activity, labels);
    button.setAttribute(
      "aria-label",
      labels.expandSummary(node.title, parts.map((part) => part.text).join(""))
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
  function summaryLine(ownerDocument, node, labels) {
    const line = ownerDocument.createElement("div");
    line.className = SIDEBAR_TREE_SUMMARY_LINE_CLASS;
    line.setAttribute(SIDEBAR_TREE_SUMMARY_ATTRIBUTE, node.threadId);
    line.setAttribute(SIDEBAR_TREE_KEY_ATTRIBUTE, `summary:${node.threadId}`);
    line.append(summaryButton(ownerDocument, node, labels));
    return line;
  }
  function treeRow(ownerDocument, node, labels) {
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
      const label = node.expanded ? labels.collapse(node.descendants) : labels.expand(node.descendants);
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
  function childrenGroup(ownerDocument, parentDepth) {
    const group = ownerDocument.createElement("div");
    group.className = SIDEBAR_TREE_CHILDREN_CLASS;
    group.setAttribute("role", "group");
    if (parentDepth < SIDEBAR_THREAD_TREE_MAX_INDENT_DEPTH) group.setAttribute("data-guide", "");
    group.style.setProperty("--cxh-guide-indent", indentOf(parentDepth));
    return group;
  }
  function branch(ownerDocument, node, labels) {
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
  function fillChildren(ownerDocument, group, nodes, labels) {
    const groups = [group];
    for (const node of nodes) {
      groups.length = Math.min(groups.length, node.depth);
      const parent = groups[node.depth - 1] ?? group;
      const { element, children } = branch(ownerDocument, node, labels);
      parent.append(element);
      if (children) groups[node.depth] = children;
    }
  }
  function presentationOf(view, withRoot, locale) {
    return JSON.stringify([
      locale,
      view.threadId,
      view.expanded,
      view.descendants,
      view.activity,
      withRoot ? [
        view.root.title,
        view.root.agent,
        view.root.current,
        view.status,
        view.root.harness.signature
      ] : view.root.title,
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
        node.activity
      ])
    ]);
  }
  function focusToggleOf(scope, threadId) {
    if (!scope?.isConnected) return;
    for (const toggle of scope.querySelectorAll(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`)) {
      if (toggle.getAttribute(SIDEBAR_TREE_TOGGLE_ATTRIBUTE) !== threadId) continue;
      toggle.focus({ preventScroll: true });
      return;
    }
  }
  function wireContainer(container, signal) {
    isolate(container, signal);
    container.addEventListener(
      "click",
      (event) => {
        const handlers = currentHandlers.get(container);
        event.stopPropagation();
        if (!handlers) return;
        const toggle = closestAttribute(event.target, SIDEBAR_TREE_TOGGLE_ATTRIBUTE);
        if (toggle) {
          event.preventDefault();
          handlers.toggle(toggle.getAttribute(SIDEBAR_TREE_TOGGLE_ATTRIBUTE) ?? "", toggle);
          return;
        }
        const expand = closestAttribute(event.target, SIDEBAR_TREE_EXPAND_ATTRIBUTE);
        if (expand) {
          const threadId2 = expand.getAttribute(SIDEBAR_TREE_EXPAND_ATTRIBUTE) ?? "";
          const focused = expand.ownerDocument.activeElement === expand;
          const scope = expand.closest('[role="listitem"]');
          handlers.toggle(threadId2, expand);
          if (focused) focusToggleOf(scope, threadId2);
          return;
        }
        const row = closestAttribute(event.target, SIDEBAR_TREE_NODE_ATTRIBUTE) ?? closestAttribute(event.target, SIDEBAR_TREE_SUMMARY_ATTRIBUTE);
        const threadId = row?.getAttribute(SIDEBAR_TREE_NODE_ATTRIBUTE) ?? row?.getAttribute(SIDEBAR_TREE_SUMMARY_ATTRIBUTE);
        if (row && threadId) handlers.open(threadId, row);
      },
      { signal }
    );
    container.addEventListener(
      "keydown",
      (event) => {
        const row = closestAttribute(event.target, SIDEBAR_TREE_NODE_ATTRIBUTE);
        if (!row || event.target !== row) {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          currentHandlers.get(container)?.open(row.getAttribute(SIDEBAR_TREE_NODE_ATTRIBUTE) ?? "", row);
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const rows = [...container.querySelectorAll(`[${SIDEBAR_TREE_NODE_ATTRIBUTE}]`)];
        const next = rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        next.focus();
      },
      { signal }
    );
  }
  function rebuild(container, presentation, build) {
    if (container.getAttribute(PRESENTATION_ATTRIBUTE) === presentation) return;
    container.setAttribute(PRESENTATION_ATTRIBUTE, presentation);
    const ownerDocument = container.ownerDocument;
    const active = ownerDocument.activeElement;
    const focusedRow = active && container.contains(active) ? closestAttribute(active, SIDEBAR_TREE_KEY_ATTRIBUTE) : null;
    const focusedKey = focusedRow?.getAttribute(SIDEBAR_TREE_KEY_ATTRIBUTE) ?? null;
    const toggleFocused = focusedKey !== null && closestAttribute(active, SIDEBAR_TREE_TOGGLE_ATTRIBUTE) !== null;
    const focusedExpand = active && container.contains(active) ? closestAttribute(active, SIDEBAR_TREE_EXPAND_ATTRIBUTE)?.getAttribute(
      SIDEBAR_TREE_EXPAND_ATTRIBUTE
    ) ?? null : null;
    container.replaceChildren(...build());
    if (focusedKey === null) {
      if (focusedExpand === null) return;
      for (const expand of container.querySelectorAll(
        `[${SIDEBAR_TREE_EXPAND_ATTRIBUTE}]`
      )) {
        if (expand.getAttribute(SIDEBAR_TREE_EXPAND_ATTRIBUTE) !== focusedExpand) continue;
        expand.focus({ preventScroll: true });
        return;
      }
      return;
    }
    for (const candidate of container.querySelectorAll(
      `[${SIDEBAR_TREE_KEY_ATTRIBUTE}]`
    )) {
      if (candidate.getAttribute(SIDEBAR_TREE_KEY_ATTRIBUTE) !== focusedKey) continue;
      const control = toggleFocused ? candidate.querySelector(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`) : candidate.tabIndex >= 0 ? candidate : candidate.querySelector("button");
      (control ?? candidate).focus({ preventScroll: true });
      return;
    }
  }
  function createToggle(ownerDocument, signal) {
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
      { signal }
    );
    toggle.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const control = event.currentTarget;
        const threadId = control.getAttribute(SIDEBAR_TREE_TOGGLE_ATTRIBUTE);
        if (threadId) currentHandlers.get(control)?.toggle(threadId, control);
      },
      { signal }
    );
    return toggle;
  }
  function placeToggle(api, row, trigger, view, labels, handlers) {
    const ownerDocument = row.ownerDocument;
    const toggle = row.querySelector(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`) ?? createToggle(ownerDocument, api.signal);
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
    const icon = trigger.querySelector(AGENT_ICON_SELECTOR) ?? row.querySelector(AGENT_ICON_SELECTOR);
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
  function renderSidebarThreadTreeRoot(api, row, view, labels, handlers, locale) {
    const parts = nativeParts(row);
    if (!parts || view.descendants === 0) {
      clearSidebarThreadTreeRow(api, row);
      return false;
    }
    const { trigger, item } = parts;
    const ownerDocument = row.ownerDocument;
    clearVirtual(api, item);
    const metrics = metricsFor(api.id, row, item);
    placeToggle(api, row, trigger, view, labels, handlers);
    setMark(api, item, "root-expanded", view.expanded);
    setMark(api, item, "root-collapsed", !view.expanded);
    const attribute = view.expanded ? SIDEBAR_TREE_CHILDREN_ATTRIBUTE : SIDEBAR_TREE_SUMMARY_ATTRIBUTE;
    ownedChild(
      item,
      view.expanded ? SIDEBAR_TREE_SUMMARY_ATTRIBUTE : SIDEBAR_TREE_CHILDREN_ATTRIBUTE
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
    applyMetrics(container, metrics);
    if (item.lastElementChild !== container) api.dom.mount(container, item, "append");
    rebuild(container, presentationOf(view, false, locale), () => {
      if (!view.expanded) {
        return [
          summaryButton(
            ownerDocument,
            {
              threadId: view.threadId,
              title: view.root.title,
              descendants: view.descendants,
              activity: view.activity
            },
            labels
          )
        ];
      }
      const holder = ownerDocument.createElement("div");
      fillChildren(ownerDocument, holder, view.nodes, labels);
      return [...holder.childNodes];
    });
    return true;
  }
  function renderSidebarThreadTreeVirtual(api, row, view, labels, handlers, locale) {
    const parts = nativeParts(row);
    if (!parts || view.descendants === 0) {
      clearSidebarThreadTreeRow(api, row);
      return false;
    }
    const { item } = parts;
    const ownerDocument = row.ownerDocument;
    clearNativeRoot(api, row, item);
    const metrics = metricsFor(api.id, row, item);
    setMark(api, item, "anchor", true);
    let container = ownedChild(item, SIDEBAR_TREE_VIRTUAL_ATTRIBUTE);
    if (!container) {
      container = ownerDocument.createElement("div");
      container.className = SIDEBAR_TREE_VIRTUAL_CLASS;
      container.setAttribute("role", "group");
      wireContainer(container, api.signal);
    }
    if (container.getAttribute(SIDEBAR_TREE_VIRTUAL_ATTRIBUTE) !== view.threadId)
      container.setAttribute(SIDEBAR_TREE_VIRTUAL_ATTRIBUTE, view.threadId);
    currentHandlers.set(container, handlers);
    applyMetrics(container, metrics);
    if (item.firstElementChild !== container) api.dom.mount(container, item, "prepend");
    rebuild(container, presentationOf(view, true, locale), () => {
      const { element, children } = branch(
        ownerDocument,
        {
          threadId: view.threadId,
          depth: 0,
          status: view.status,
          descendants: view.descendants,
          expanded: view.expanded,
          rollup: view.rollup,
          activity: view.activity,
          ...view.root
        },
        labels
      );
      if (children) fillChildren(ownerDocument, children, view.nodes, labels);
      return [element];
    });
    return true;
  }
  function clearNativeRoot(api, row, item) {
    row.querySelector(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`)?.remove();
    ownedChild(item, SIDEBAR_TREE_SUMMARY_ATTRIBUTE)?.remove();
    ownedChild(item, SIDEBAR_TREE_CHILDREN_ATTRIBUTE)?.remove();
    setMark(api, item, "root-collapsed", false);
    setMark(api, item, "root-expanded", false);
  }
  function clearVirtual(api, item) {
    ownedChild(item, SIDEBAR_TREE_VIRTUAL_ATTRIBUTE)?.remove();
    setMark(api, item, "anchor", false);
  }
  function clearSidebarThreadTreeRow(api, row) {
    const item = row.closest('[role="listitem"]');
    if (!item) {
      row.querySelector(`[${SIDEBAR_TREE_TOGGLE_ATTRIBUTE}]`)?.remove();
      return;
    }
    clearNativeRoot(api, row, item);
    clearVirtual(api, item);
  }
  function setSidebarThreadTreeRowHidden(api, row, hidden) {
    const item = row.closest('[role="listitem"]');
    if (!item) return;
    setMark(api, item, "hidden", hidden);
  }
  function clearSidebarThreadTree(api, root) {
    cancelSidebarThreadTreeMotion();
    if (!api.signal.aborted) {
      const marks = ["hidden", "root-collapsed", "root-expanded", "anchor"];
      for (const name of marks) {
        const attr = markAttribute(api.id, name);
        for (const item of root.querySelectorAll(`[${attr}]`)) {
          api.dom.unmark(item, name);
        }
      }
    }
    for (const node of root.querySelectorAll(SIDEBAR_TREE_OWNED_SELECTOR)) node.remove();
  }

  // src/sidebar-tree.ts
  var SIDEBAR_SELECTOR = "[data-app-action-sidebar-scroll]";
  var AGENT_ICON_ATTRIBUTE = "data-codexhost-sidebar-agent-icon";
  var ACTIVE_ATTRIBUTE2 = "data-app-action-sidebar-thread-active";
  var TITLE_ATTRIBUTE = "data-app-action-sidebar-thread-title";
  var COMPOSER_THREAD_ATTRIBUTE = "data-above-composer-conversation-id";
  var WATCHED_SELECTOR = `${SIDEBAR_SELECTOR}, [${COMPOSER_THREAD_ATTRIBUTE}]`;
  var MAX_REMEMBERED_EXPANDED = 500;
  var PLAIN = { kind: "plain" };
  var SIDEBAR_THREAD_TREE_EXPANDED_KEY = "codexhost.sidebar-thread-tree.expanded.v1";
  function sidebarThreadTreeLabels(locale) {
    const chinese = locale === "zh-CN";
    return {
      expand: (count) => chinese ? `\u5C55\u5F00 ${count} \u4E2A\u5B50\u4F1A\u8BDD` : `Expand ${count} child sessions`,
      collapse: (count) => chinese ? `\u6536\u8D77 ${count} \u4E2A\u5B50\u4F1A\u8BDD` : `Collapse ${count} child sessions`,
      status: (status) => status === "pending" ? chinese ? "\u7B49\u5F85\u5904\u7406" : "Waiting for you" : status === "running" ? chinese ? "\u6B63\u5728\u8FD0\u884C" : "Running" : status === "unknown" ? chinese ? "\u72B6\u6001\u672A\u77E5" : "Unknown" : "",
      children: (count) => chinese ? `${count} \u4E2A\u5B50\u4F1A\u8BDD` : `${count} child sessions`,
      running: (count) => chinese ? `${count} \u8FD0\u884C\u4E2D` : `${count} running`,
      pending: (count) => chinese ? `${count} \u5F85\u6279\u51C6` : `${count} needs approval`,
      expandSummary: (title, summary) => chinese ? `${title}\uFF0C${summary}\uFF0C\u5C55\u5F00` : `${title}, ${summary}, expand`
    };
  }
  function readExpanded(storage) {
    try {
      const value = JSON.parse(storage?.getItem(SIDEBAR_THREAD_TREE_EXPANDED_KEY) ?? "[]");
      if (Array.isArray(value))
        return new Set(value.filter((id) => typeof id === "string" && id.length > 0));
    } catch {
    }
    return /* @__PURE__ */ new Set();
  }
  function detectLocale(doc) {
    const lang = doc.documentElement.lang.trim() || doc.defaultView?.navigator.language || "";
    return /^zh\b/iu.test(lang) ? "zh-CN" : "en";
  }
  function mapTreeStatus(status) {
    if (status === "waiting") return "pending";
    if (status === "running") return "running";
    if (status === "unknown") return "unknown";
    return "idle";
  }
  function defaultIsRowListVisible(row) {
    const list = row.closest('[role="listitem"]')?.parentElement;
    if (!list) return false;
    if (list.getClientRects().length > 0) return true;
    const doc = row.ownerDocument;
    return (doc.body ?? doc.documentElement).getClientRects().length === 0;
  }
  function collectSampledIcons(rows) {
    const icons = /* @__PURE__ */ new Map();
    for (const row of rows) {
      if (!row.isConnected()) continue;
      const host = row.element.querySelector(`[${AGENT_ICON_ATTRIBUTE}]`);
      if (!host) continue;
      const harnessId = host.getAttribute(AGENT_ICON_ATTRIBUTE);
      if (!harnessId || icons.has(harnessId)) continue;
      const graphic = host.querySelector(":scope > img, :scope > svg");
      if (graphic) icons.set(harnessId, graphic);
    }
    return icons;
  }
  function iconSignature(sampled, iconUrl) {
    if (sampled) {
      const tag = sampled.tagName.toLowerCase();
      if (tag === "img") {
        const img = sampled;
        return `img:${img.getAttribute("src") ?? ""}:${img.style.borderRadius}:${img.style.background}:${img.style.padding}`;
      }
      if (tag === "svg") return `svg:${sampled.innerHTML}`;
    }
    if (iconUrl) return `url:${iconUrl}`;
    return "fallback";
  }
  function activate(api, options = {}) {
    const root = options.root ?? document;
    const view = root.defaultView ?? window;
    const storage = options.storage !== void 0 ? options.storage : (() => {
      try {
        return view.localStorage;
      } catch {
        return null;
      }
    })();
    const isRowListVisible = options.isRowListVisible ?? defaultIsRowListVisible;
    let disposed = false;
    let observedRows = [];
    let snapshot;
    const expanded = readExpanded(storage);
    let expandedForThreadId = null;
    let applyScheduled = false;
    let rafId;
    const listIds = /* @__PURE__ */ new WeakMap();
    let nextListId = 0;
    let lastTouchedRows = /* @__PURE__ */ new Set();
    const saveExpanded = () => {
      try {
        storage?.setItem(
          SIDEBAR_THREAD_TREE_EXPANDED_KEY,
          JSON.stringify([...expanded].slice(-MAX_REMEMBERED_EXPANDED))
        );
      } catch {
      }
    };
    const localMountedRows = () => {
      const itemCounts = /* @__PURE__ */ new Map();
      for (const row of observedRows) {
        if (!row.isConnected()) continue;
        const item = row.element.closest('[role="listitem"]');
        if (item) itemCounts.set(item, (itemCounts.get(item) ?? 0) + 1);
      }
      const sharedItems = /* @__PURE__ */ new Set();
      for (const [item, count] of itemCounts) {
        if (count !== 1) sharedItems.add(item);
      }
      const mounted = [];
      for (const row of observedRows) {
        if (!row.isLocal || !row.threadId || !row.isConnected()) continue;
        mounted.push({ element: row.element, threadId: row.threadId });
      }
      return { mounted, sharedItems };
    };
    const byThread = (rows) => {
      const map = /* @__PURE__ */ new Map();
      for (const { element, threadId } of rows) {
        const list = map.get(threadId);
        if (list) list.push(element);
        else map.set(threadId, [element]);
      }
      return map;
    };
    const listOf = (row) => {
      const list = row.closest('[role="listitem"]')?.parentElement ?? row;
      let id = listIds.get(list);
      if (id === void 0) listIds.set(list, id = String(nextListId += 1));
      return id;
    };
    const navigate = (threadId) => {
      void api.navigate.openThread(threadId).catch((error) => {
        if (!api.signal.aborted) console.warn("codexhost could not open the delegated Thread", error);
      });
    };
    const openThreadId = (rows) => {
      const shown = /* @__PURE__ */ new Set();
      const all = /* @__PURE__ */ new Set();
      for (const portal of root.querySelectorAll(`[${COMPOSER_THREAD_ATTRIBUTE}]`)) {
        const threadId = portal.getAttribute(COMPOSER_THREAD_ATTRIBUTE);
        if (!threadId) continue;
        all.add(threadId);
        if (portal.getClientRects().length > 0) shown.add(threadId);
      }
      const composers = shown.size > 0 ? shown : all;
      if (composers.size === 1) return [...composers][0] ?? null;
      for (const [threadId, list] of rows) {
        if (list.some((row) => row.getAttribute(ACTIVE_ATTRIBUTE2) === "true")) return threadId;
      }
      return null;
    };
    const cancelScheduledApply = () => {
      if (!applyScheduled) return;
      applyScheduled = false;
      if (rafId !== void 0 && typeof view.cancelAnimationFrame === "function") {
        view.cancelAnimationFrame(rafId);
        rafId = void 0;
      }
    };
    const toggle = (threadId, source) => {
      if (disposed || api.signal.aborted) return;
      const item = source.closest('[role="listitem"]');
      const motion = item ? captureSidebarThreadTreeMotion(item) : null;
      if (expanded.has(threadId)) expanded.delete(threadId);
      else expanded.add(threadId);
      saveExpanded();
      apply();
      if (motion) {
        playSidebarThreadTreeMotion(
          motion,
          (overlay, viewport) => api.dom.mount(overlay, viewport, "append")
        );
      }
    };
    const handlers = { toggle, open: navigate };
    const apply = () => {
      cancelScheduledApply();
      if (disposed || api.signal.aborted || !snapshot) return;
      const parents = snapshot.parents;
      const nodes = snapshot.nodes;
      const { mounted, sharedItems } = localMountedRows();
      const rows = byThread(mounted);
      const sampledIcons = collectSampledIcons(observedRows);
      const current = openThreadId(rows);
      if (current === null || !Object.hasOwn(parents, current)) expandedForThreadId = null;
      else if (current !== expandedForThreadId) {
        expandedForThreadId = current;
        let changed = false;
        const seen = /* @__PURE__ */ new Set([current]);
        for (let parentId = parents[current]; parentId !== void 0 && !seen.has(parentId); parentId = Object.hasOwn(parents, parentId) ? parents[parentId] : void 0) {
          seen.add(parentId);
          if (!expanded.has(parentId)) {
            expanded.add(parentId);
            changed = true;
          }
        }
        if (changed) saveExpanded();
      }
      const planned = [];
      for (const row of mounted) {
        if (!isRowListVisible(row.element)) continue;
        const item = row.element.closest('[role="listitem"]');
        const renderable = item !== null && item !== row.element && item.parentElement !== null && !sharedItems.has(item) && canRenderSidebarThreadTree(row.element);
        planned.push({
          ...row,
          key: String(planned.length),
          list: listOf(row.element),
          renderable
        });
      }
      const threads = /* @__PURE__ */ new Map();
      for (const [threadId, node] of Object.entries(nodes)) {
        threads.set(threadId, {
          status: mapTreeStatus(node.status),
          archived: node.archived,
          order: 0
        });
      }
      const plans = planSidebarThreadTree({
        parents,
        threads,
        rows: planned,
        expanded: (threadId) => expanded.has(threadId)
      });
      const broken = /* @__PURE__ */ new Set();
      for (const row of planned) {
        const plan = plans.get(row.key);
        if (!row.renderable && (plan?.kind === "root" || plan?.kind === "virtual"))
          broken.add(`${row.list}\0${plan.tree.threadId}`);
      }
      const harnessInfo = (harnessId) => {
        const described = api.harnesses.describe(harnessId);
        const name = described?.name ?? (harnessId === "codex" ? "Codex" : harnessId);
        const sampled = sampledIcons.get(harnessId);
        const iconUrl = described?.icon;
        return {
          name,
          ...iconUrl ? { iconUrl } : {},
          ...sampled ? { sampled } : {},
          signature: `${harnessId}|${name}|${iconSignature(sampled, iconUrl)}`
        };
      };
      const nativeTitle = (threadId) => rows.get(threadId)?.[0]?.getAttribute(TITLE_ATTRIBUTE)?.trim() || void 0;
      const display = (threadId) => {
        const node = Object.hasOwn(nodes, threadId) ? nodes[threadId] : void 0;
        const harnessId = node?.harnessId ?? "codex";
        const harness = harnessInfo(harnessId);
        return {
          title: nativeTitle(threadId) ?? (node?.title?.trim() || void 0) ?? harness.name,
          agent: harnessId,
          harness,
          current: threadId === current
        };
      };
      const viewOf = (tree) => ({
        ...tree,
        nodes: tree.nodes.map((node) => ({ ...node, ...display(node.threadId) })),
        root: display(tree.threadId)
      });
      const locale = detectLocale(root);
      const labels = sidebarThreadTreeLabels(locale);
      const resolved = planned.map((row) => {
        const plan = plans.get(row.key) ?? PLAIN;
        return !row.renderable || plan.kind === "hidden" && broken.has(`${row.list}\0${plan.rootId}`) ? { row, plan: PLAIN } : { row, plan };
      });
      measureSidebarThreadTreeRows(
        api.id,
        resolved.filter(({ plan }) => plan.kind === "root" || plan.kind === "virtual").map(({ row }) => row.element)
      );
      const touched = /* @__PURE__ */ new Set();
      for (const { row, plan } of resolved) {
        touched.add(row.element);
        if (plan.kind === "root" || plan.kind === "virtual") {
          setSidebarThreadTreeRowHidden(api, row.element, false);
          const render = plan.kind === "root" ? renderSidebarThreadTreeRoot : renderSidebarThreadTreeVirtual;
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
    const scheduleApply = () => {
      if (disposed || api.signal.aborted || applyScheduled) return;
      applyScheduled = true;
      if (typeof view.requestAnimationFrame === "function") {
        rafId = view.requestAnimationFrame(() => {
          rafId = void 0;
          apply();
        });
      } else {
        queueMicrotask(apply);
      }
    };
    const ObserverCtor = view.MutationObserver ?? globalThis.MutationObserver;
    const observer = ObserverCtor ? new ObserverCtor((mutations) => {
      if (disposed || api.signal.aborted) return;
      for (const mutation of mutations) {
        const target = mutation.target instanceof view.Element ? mutation.target : mutation.target.parentElement;
        if (!target) continue;
        if (target.closest(SIDEBAR_TREE_OWNED_SELECTOR)) continue;
        if (mutation.attributeName === COMPOSER_THREAD_ATTRIBUTE) {
          scheduleApply();
          return;
        }
        const touchesSidebar = target.closest(SIDEBAR_SELECTOR) !== null || target.closest('[role="listitem"]') !== null || [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) => node instanceof view.Element && !node.matches(SIDEBAR_TREE_OWNED_SELECTOR) && (node.matches(WATCHED_SELECTOR) || node.querySelector(WATCHED_SELECTOR) !== null)
        );
        if (!touchesSidebar) continue;
        if (mutation.type === "childList" && [...mutation.addedNodes, ...mutation.removedNodes].every(
          (node) => node instanceof view.Element && node.matches(SIDEBAR_TREE_OWNED_SELECTOR)
        ))
          continue;
        scheduleApply();
        return;
      }
    }) : null;
    observer?.observe(root.documentElement, {
      attributes: true,
      attributeFilter: [
        ACTIVE_ATTRIBUTE2,
        TITLE_ATTRIBUTE,
        COMPOSER_THREAD_ATTRIBUTE,
        AGENT_ICON_ATTRIBUTE,
        "data-app-action-sidebar-project-collapsed",
        "data-app-action-sidebar-section-collapsed"
      ],
      childList: true,
      subtree: true
    });
    const cleanup = () => {
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

  // src/index.ts
  define({ activate });
})();
