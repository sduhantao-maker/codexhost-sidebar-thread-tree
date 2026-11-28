// src/handoff.ts
var EMPTY_HANDOFFS = { links: [], threads: {} };
var HANDOFFS_METHOD = "handoffs";
var MAX_HANDOFF_CHAIN = 16;
var MAX_DESCRIBED_THREADS = 64;
var HANDOFF_POLL_MS = 15e3;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmpty(value, max = 512) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value : void 0;
}
var STATUSES = /* @__PURE__ */ new Set(["running", "waiting", "idle", "unknown"]);
function parseHandoffSnapshot(value) {
  if (!isRecord(value)) return EMPTY_HANDOFFS;
  const links = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of Array.isArray(value.links) ? value.links : []) {
    if (!isRecord(entry)) continue;
    const target = nonEmpty(entry.target, 256);
    const source = nonEmpty(entry.source, 256);
    if (!target || !source || target === source || seen.has(target)) continue;
    seen.add(target);
    const at = typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0;
    links.push({ target, source, at });
  }
  const threads = {};
  if (isRecord(value.threads)) {
    for (const [threadId, entry] of Object.entries(value.threads)) {
      if (!isRecord(entry) || !nonEmpty(threadId, 256)) continue;
      const info = {};
      const title = nonEmpty(entry.title, 4096);
      const agent = nonEmpty(entry.agent, 128);
      if (title) info.title = title;
      if (agent) info.agent = agent;
      if (typeof entry.status === "string" && STATUSES.has(entry.status))
        info.status = entry.status;
      if (typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt))
        info.updatedAt = entry.updatedAt;
      threads[threadId] = info;
    }
  }
  return { links, threads };
}
function sameHandoffs(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function handoffMembers(links) {
  const members = /* @__PURE__ */ new Set();
  for (const { target, source } of links) members.add(target).add(source);
  return members;
}
function handoffChains(links, include) {
  const parent = /* @__PURE__ */ new Map();
  const find = (id) => {
    let root = id;
    for (let next = parent.get(root); next !== void 0 && next !== root; next = parent.get(root))
      root = next;
    for (let node = id; node !== root; ) {
      const next = parent.get(node) ?? root;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const arrival = /* @__PURE__ */ new Map();
  for (const { target, source, at } of links) {
    if (!parent.has(target)) parent.set(target, target);
    if (!parent.has(source)) parent.set(source, source);
    const a = find(target);
    const b = find(source);
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    arrival.set(target, Math.max(arrival.get(target) ?? Number.NEGATIVE_INFINITY, at));
  }
  const groups = /* @__PURE__ */ new Map();
  for (const id of parent.keys()) {
    if (!include(id)) continue;
    const root = find(id);
    let members = groups.get(root);
    if (!members) groups.set(root, members = []);
    members.push(id);
  }
  const chains = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort(
      (left, right) => (arrival.get(right) ?? Number.NEGATIVE_INFINITY) - (arrival.get(left) ?? Number.NEGATIVE_INFINITY) || (left < right ? -1 : left > right ? 1 : 0)
    );
    chains.push(members.slice(0, MAX_HANDOFF_CHAIN));
  }
  return chains;
}
var RETRY_FIRST_MS = 1e3;
var HandoffSource = class {
  constructor(options) {
    this.options = options;
  }
  options;
  snapshot = EMPTY_HANDOFFS;
  #wanted = [];
  #asked = null;
  #running = false;
  #again = false;
  #retryMs = 0;
  #retryTimer;
  #pollTimer;
  #disposed = false;
  start() {
    this.refresh();
    this.#pollTimer = this.options.timers.setInterval(() => {
      if (this.options.visible()) this.refresh();
    }, HANDOFF_POLL_MS);
  }
  /** The Threads the surface cannot show without the backend's description. */
  want(threadIds) {
    const wanted = [...new Set(threadIds)].sort().slice(0, MAX_DESCRIBED_THREADS);
    this.#wanted = wanted;
    if (wanted.join("\0") !== this.#asked) this.refresh();
  }
  refresh() {
    if (this.#disposed) return;
    if (this.#running) {
      this.#again = true;
      return;
    }
    if (this.#retryTimer !== void 0) {
      this.options.timers.clearTimeout(this.#retryTimer);
      this.#retryTimer = void 0;
    }
    this.#running = true;
    const describe = this.#wanted;
    this.#asked = describe.join("\0");
    void this.options.invoke(HANDOFFS_METHOD, { describe }).then(
      (value) => {
        this.#retryMs = 0;
        if (this.#disposed) return;
        const next = parseHandoffSnapshot(value);
        if (sameHandoffs(next, this.snapshot)) return;
        this.snapshot = next;
        this.options.onChange();
      },
      () => {
        if (this.#disposed) return;
        this.#retryMs = Math.min(
          HANDOFF_POLL_MS,
          this.#retryMs === 0 ? RETRY_FIRST_MS : this.#retryMs * 2
        );
        this.#retryTimer = this.options.timers.setTimeout(() => {
          this.#retryTimer = void 0;
          this.refresh();
        }, this.#retryMs);
      }
    ).finally(() => {
      this.#running = false;
      if (!this.#again) return;
      this.#again = false;
      this.refresh();
    });
  }
  dispose() {
    this.#disposed = true;
    if (this.#pollTimer !== void 0) this.options.timers.clearInterval(this.#pollTimer);
    if (this.#retryTimer !== void 0) this.options.timers.clearTimeout(this.#retryTimer);
    this.#pollTimer = void 0;
    this.#retryTimer = void 0;
  }
};
var RAIL_ELBOW_PX = 10.5;
var RAIL_GAP_PX = 6;
var RAIL_MIN_GAP_PX = 3;
var RAIL_MIN_ELBOW_PX = 4;
function handoffRail(iconLeft, minX = 1) {
  let gap = RAIL_GAP_PX;
  let x = iconLeft - gap - RAIL_ELBOW_PX;
  if (x < minX) {
    gap = Math.max(RAIL_MIN_GAP_PX, iconLeft - minX - RAIL_ELBOW_PX);
    x = Math.max(minX, iconLeft - gap - RAIL_ELBOW_PX);
  }
  const width = Math.max(RAIL_MIN_ELBOW_PX, iconLeft - gap - x);
  return { x: Math.round(x * 2) / 2, width: Math.round(width * 2) / 2 };
}

// src/web/handoff-web.ts
var BRANCH_SELECTOR = "[data-thread-branch]";
var ROW_SELECTOR = "[data-row-key]";
var ICON_SELECTOR = "[data-harness-id]";
var TITLE_SELECTOR = "[data-session-title]";
var SUMMARY_SELECTOR = "[data-thread-summary]";
var LEADING_SLOT_SELECTOR = '[data-slot="sidebar.session.row.leading"]';
var MOUNT_ATTRIBUTE = "data-cx-web-ext-mount";
var MOUNT_SELECTOR = `[${MOUNT_ATTRIBUTE}]`;
var SIDEBAR_REGION_SELECTOR = '[data-cx-region="sidebar"]';
var MIRROR_KEY_ATTRIBUTE = "data-cxh-row-key";
var GROUP_CLASS = "cxh-handoff";
var UNIT_CLASS = "cxh-handoff-unit";
var RAIL_ATTRIBUTE = "data-handoff";
var ROW_GAP_PX = 2;
var ICON_PX = 14;
function closestElement(target, selector) {
  const node = target;
  const element = node?.nodeType === 1 ? node : node?.parentElement ?? null;
  return element?.closest(selector) ?? null;
}
function threadIdOfRowKey(key) {
  if (!key) return null;
  const colon = key.indexOf(":");
  if (colon <= 0) return null;
  const kind = key.slice(0, colon);
  if (kind === "workspace" || kind === "section" || kind === "host") return null;
  const id = key.slice(colon + 1);
  return id.trim() ? id : null;
}
function webTimeLabel(at, now, chinese) {
  const MIN = 6e4;
  const HOUR = 36e5;
  const DAY = 864e5;
  const diff = Math.max(0, now - at);
  const unit = (n, zh, en) => chinese ? `${String(n)}${zh}` : `${String(n)}${en}`;
  if (diff < MIN) return chinese ? "\u521A\u521A" : "now";
  if (diff < HOUR) return unit(Math.floor(diff / MIN), "\u5206\u949F", "min");
  if (diff < DAY) return unit(Math.floor(diff / HOUR), "\u5C0F\u65F6", "h");
  if (diff < 30 * DAY) return unit(Math.floor(diff / DAY), "\u5929", "d");
  if (diff < 365 * DAY) return unit(Math.floor(diff / (30 * DAY)), "\u4E2A\u6708", "mo");
  return unit(Math.floor(diff / (365 * DAY)), "\u5E74", "y");
}
function pathFrom(ancestor, node) {
  const path = [];
  for (let current = node; current !== ancestor; current = current.parentElement) {
    if (!current?.parentElement) return null;
    path.unshift([...current.parentElement.children].indexOf(current));
  }
  return path;
}
function follow(root, path) {
  let current = root;
  for (const index of path) {
    current = current?.children[index];
    if (!current) return null;
  }
  return current ?? null;
}
function layoutOffset(element) {
  let x = 0;
  let y = 0;
  for (let node = element; node; node = node.offsetParent) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}
function mirrorOf(native) {
  const copy = native.cloneNode(true);
  for (const mount of copy.querySelectorAll(MOUNT_SELECTOR)) mount.remove();
  for (const element of [copy, ...copy.querySelectorAll("*")]) {
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
function activateWebHandoffs(api, options = {}) {
  const root = options.root ?? document;
  const view = root.defaultView ?? window;
  const now = options.now ?? Date.now;
  let disposed = false;
  let applyScheduled = false;
  let rafId;
  const groups = /* @__PURE__ */ new Map();
  const mirrors = /* @__PURE__ */ new Map();
  const marks = /* @__PURE__ */ new Map();
  const resizeObserver = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(() => {
    scheduleApply();
  }) : null;
  const observedHosts = /* @__PURE__ */ new Set();
  const setMark = (element, mark) => {
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
    timers: view
  });
  const openSession = (threadId) => {
    const container = view.navigator.serviceWorker;
    if (container && typeof container.dispatchEvent === "function") {
      container.dispatchEvent(
        new view.MessageEvent("message", {
          data: { type: "codexhost/open-session", sessionId: threadId }
        })
      );
      return;
    }
    const url = new URL(view.location.href);
    url.searchParams.set("session", threadId);
    view.location.assign(url.href);
  };
  let nextMirrorId = 0;
  const mirrorSignature = (native) => {
    let mirror = mirrors.get(native);
    if (!mirror) {
      const state = {
        id: nextMirrorId += 1,
        version: 0,
        observer: new view.MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === "attributes" && mutation.attributeName?.startsWith("data-cx-"))
              continue;
            const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
            if (target?.closest(MOUNT_SELECTOR)) continue;
            if (mutation.type === "childList" && [...mutation.addedNodes, ...mutation.removedNodes].every(
              (node) => node.nodeType === 1 && node.matches(MOUNT_SELECTOR)
            ))
              continue;
            state.version += 1;
            scheduleApply();
            return;
          }
        })
      };
      state.observer.observe(native, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
      mirrors.set(native, state);
      mirror = state;
    }
    return `${String(mirror.id)}.${String(mirror.version)}`;
  };
  const nativeBranches = () => {
    const scope = root.querySelector(SIDEBAR_REGION_SELECTOR) ?? root;
    const lists = /* @__PURE__ */ new Map();
    for (const branch of scope.querySelectorAll(BRANCH_SELECTOR)) {
      if (branch.closest(MOUNT_SELECTOR)) continue;
      const list = branch.parentElement;
      if (!list || list.closest(BRANCH_SELECTOR)) continue;
      const row = branch.querySelector(ROW_SELECTOR);
      const threadId = threadIdOfRowKey(row?.getAttribute("data-row-key") ?? null);
      if (!row || !threadId) continue;
      let entries = lists.get(list);
      if (!entries) lists.set(list, entries = []);
      entries.push({ branch, threadId });
    }
    return lists;
  };
  const chineseLocale = () => /^zh\b/iu.test(root.documentElement.lang || view.navigator.language || "");
  const sampledIcon = (agent) => {
    if (!agent) return null;
    for (const icon of root.querySelectorAll(ICON_SELECTOR)) {
      if (icon.getAttribute("data-harness-id") === agent && !icon.closest(MOUNT_SELECTOR))
        return icon;
    }
    return null;
  };
  const templateRow = () => {
    let fallback = null;
    for (const row of root.querySelectorAll(
      `${ROW_SELECTOR}[data-thread-depth="0"]`
    )) {
      if (row.closest(MOUNT_SELECTOR) || !row.closest(BRANCH_SELECTOR)) continue;
      fallback ??= row;
      if (row.getAttribute("aria-selected") !== "true" && !row.hasAttribute("aria-expanded"))
        return row;
    }
    return fallback;
  };
  const drawnBranch = (threadId, info) => {
    const template = templateRow();
    const templateBranch = template?.closest(BRANCH_SELECTOR);
    if (!template || !templateBranch) return null;
    const branch = templateBranch.cloneNode(false);
    let holder = branch;
    const chain = [];
    for (let node = template.parentElement; node && node !== templateBranch; node = node.parentElement)
      chain.unshift(node);
    for (const wrapper of chain) {
      const copy = wrapper.cloneNode(false);
      holder.append(copy);
      holder = copy;
    }
    holder.append(template.cloneNode(true));
    const mirror = mirrorOf(branch);
    const row = mirror.querySelector(`[${MIRROR_KEY_ATTRIBUTE}]`);
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
    const title = row.querySelector(TITLE_SELECTOR);
    const titleText = title?.firstElementChild ?? title;
    if (titleText) titleText.textContent = info.title ?? "";
    const trailing = title?.nextElementSibling;
    const time = trailing?.firstElementChild;
    if (trailing && time) {
      for (const sibling of [...trailing.children]) if (sibling !== time) sibling.remove();
      time.removeAttribute("data-session-status");
      time.textContent = info.updatedAt === void 0 ? "" : webTimeLabel(info.updatedAt, now(), chineseLocale());
    }
    return mirror;
  };
  const counterpart = (wrapper, native, target) => {
    const copy = wrapper.firstElementChild;
    if (!copy) return null;
    const path = pathFrom(copy, target);
    return path ? follow(native, path) : null;
  };
  const unitOf = (group, wrapper) => group.units.find((unit) => group.wrappers.get(unit.threadId) === wrapper);
  const groupOf = (container) => {
    for (const group of groups.values()) if (group.mount.container === container) return group;
    return void 0;
  };
  const menuAt = (row, x, y) => {
    row.dispatchEvent(
      new view.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        button: 2
      })
    );
  };
  const wire = (container) => {
    const signal = api.signal;
    for (const type of ["pointerdown", "mousedown", "dblclick", "dragstart"]) {
      container.addEventListener(type, (event) => event.stopPropagation(), { signal });
    }
    container.addEventListener(
      "click",
      (event) => {
        const wrapper = closestElement(event.target, `.${UNIT_CLASS}`);
        const group = groupOf(container);
        const unit = wrapper && group ? unitOf(group, wrapper) : void 0;
        if (!wrapper || !unit) return;
        event.preventDefault();
        event.stopPropagation();
        if (!unit.native) {
          openSession(unit.threadId);
          return;
        }
        const target = event.target;
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
      { signal }
    );
    container.addEventListener(
      "contextmenu",
      (event) => {
        const wrapper = closestElement(event.target, `.${UNIT_CLASS}`);
        const group = groupOf(container);
        const unit = wrapper && group ? unitOf(group, wrapper) : void 0;
        if (!wrapper || !unit) return;
        event.preventDefault();
        event.stopPropagation();
        if (!unit.native) return;
        const row = counterpart(wrapper, unit.native, event.target)?.closest(
          ROW_SELECTOR
        );
        if (row) menuAt(row, event.clientX, event.clientY);
      },
      { signal }
    );
  };
  const disposeGroup = (key) => {
    const group = groups.get(key);
    if (!group) return;
    groups.delete(key);
    group.mount.dispose();
  };
  const measure = (group) => {
    const container = group.mount.container;
    if (container.offsetHeight === 0) return;
    const firstWrapper = container.querySelector(`.${UNIT_CLASS}`);
    const sampleRow = group.mode === "root" ? group.host.querySelector(ROW_SELECTOR) : firstWrapper?.querySelector(`[${MIRROR_KEY_ATTRIBUTE}]`);
    const icon = sampleRow?.querySelector(ICON_SELECTOR) ?? sampleRow;
    if (!sampleRow || !icon) return;
    const box = layoutOffset(container);
    const rowTop = layoutOffset(sampleRow).y;
    const iconBox = layoutOffset(icon);
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
    const set = (name, value) => {
      if (container.style.getPropertyValue(name) !== value)
        container.style.setProperty(name, value);
    };
    set("--cxh-rail-x", `${String(rail.x)}px`);
    set("--cxh-rail-w", `${String(rail.width)}px`);
    set("--cxh-icon-cy", `${String(Math.round((iconCenter - rowTop) * 2) / 2)}px`);
    if (group.mode === "root")
      set("--cxh-rail-head", `${String(Math.max(0, Math.round((box.y - iconCenter) * 2) / 2))}px`);
  };
  const listIds = /* @__PURE__ */ new WeakMap();
  let nextListId = 0;
  const listKey = (list) => {
    let id = listIds.get(list);
    if (id === void 0) listIds.set(list, id = String(nextListId += 1));
    return id;
  };
  const renderUnits = (group, info, mirrored) => {
    const container = group.mount.container;
    const count = group.units.length;
    const wrappers = [];
    const next = /* @__PURE__ */ new Map();
    group.units.forEach((unit, index) => {
      let wrapper = group.wrappers.get(unit.threadId);
      if (!wrapper) {
        wrapper = root.createElement("div");
        wrapper.className = UNIT_CLASS;
      }
      const place = index === 0 && group.mode === "virtual" ? "first" : index === count - 1 ? "last" : "middle";
      if (wrapper.getAttribute(RAIL_ATTRIBUTE) !== place)
        wrapper.setAttribute(RAIL_ATTRIBUTE, place);
      let signature;
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
          Math.floor(now() / 6e4)
        )}`;
        if (wrapper.dataset.signature !== signature || wrapper.dataset.native !== "0") {
          const drawn = drawnBranch(unit.threadId, described);
          wrapper.replaceChildren(...drawn ? [drawn] : []);
          wrapper.dataset.native = "0";
        }
      }
      wrapper.dataset.signature = signature;
      wrappers.push(wrapper);
      next.set(unit.threadId, wrapper);
    });
    group.wrappers = next;
    const current = [...container.children];
    if (current.length !== wrappers.length || wrappers.some((wrapper, index) => current[index] !== wrapper))
      container.replaceChildren(...wrappers);
    const gap = `${String(ROW_GAP_PX)}px`;
    if (container.style.getPropertyValue("--cxh-gap") !== gap)
      container.style.setProperty("--cxh-gap", gap);
  };
  const apply = () => {
    applyScheduled = false;
    if (rafId !== void 0) {
      view.cancelAnimationFrame?.(rafId);
      rafId = void 0;
    }
    if (disposed || api.signal.aborted) return;
    const lists = nativeBranches();
    const shown = /* @__PURE__ */ new Set();
    for (const entries of lists.values()) for (const { threadId } of entries) shown.add(threadId);
    const handoffs = source.snapshot;
    source.want([...handoffMembers(handoffs.links)].filter((threadId) => !shown.has(threadId)));
    const info = (threadId) => Object.hasOwn(handoffs.threads, threadId) ? handoffs.threads[threadId] : void 0;
    const chains = handoffChains(handoffs.links, () => true);
    const nextMarks = /* @__PURE__ */ new Map();
    const liveGroups = /* @__PURE__ */ new Set();
    const mirrored = /* @__PURE__ */ new Set();
    const hosts = /* @__PURE__ */ new Set();
    for (const [list, entries] of lists) {
      const position = /* @__PURE__ */ new Map();
      const branchOf = /* @__PURE__ */ new Map();
      entries.forEach(({ branch, threadId }, index) => {
        if (branchOf.has(threadId)) return;
        branchOf.set(threadId, branch);
        position.set(threadId, index);
      });
      for (const chain of chains) {
        const present = chain.filter((threadId) => branchOf.has(threadId));
        if (present.length === 0) continue;
        const drawable = chain.filter(
          (threadId) => branchOf.has(threadId) || Boolean(info(threadId)?.title)
        );
        if (drawable.length < 2) continue;
        const topmost = present.reduce(
          (best, threadId) => (position.get(threadId) ?? 0) < (position.get(best) ?? 0) ? threadId : best
        );
        const head = drawable[0] ?? topmost;
        const mode = topmost === head ? "root" : "virtual";
        const host = branchOf.get(topmost);
        if (!host) continue;
        const key = `${listKey(list)}\0${head}`;
        liveGroups.add(key);
        hosts.add(host);
        const units = (mode === "root" ? drawable.slice(1) : drawable).map((threadId) => ({
          threadId,
          native: branchOf.get(threadId) ?? null
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
        if (group && (group.host !== host || group.mode !== mode || !group.mount.container.isConnected)) {
          disposeGroup(key);
          group = void 0;
        }
        if (!group) {
          const mount = api.dom.mount(host, "append");
          if (!mount) continue;
          mount.container.classList.add(GROUP_CLASS);
          mount.container.setAttribute("role", "group");
          mount.container.setAttribute("data-mode", mode);
          wire(mount.container);
          group = { key, host, mode, mount, wrappers: /* @__PURE__ */ new Map(), units };
          groups.set(key, group);
        }
        group.units = units;
        renderUnits(group, info, mirrored);
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
  const scheduleApply = () => {
    if (disposed || applyScheduled) return;
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
  const touchesSidebar = (mutation, target) => target.closest(SIDEBAR_REGION_SELECTOR) !== null || [...mutation.addedNodes, ...mutation.removedNodes].some(
    (node) => node.nodeType === 1 && (node.matches(SIDEBAR_REGION_SELECTOR) || node.querySelector(`${SIDEBAR_REGION_SELECTOR}, ${BRANCH_SELECTOR}`) !== null)
  );
  const observer = new view.MutationObserver((mutations) => {
    if (disposed) return;
    for (const mutation of mutations) {
      const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
      if (!target || target.closest(MOUNT_SELECTOR)) continue;
      if (!touchesSidebar(mutation, target)) continue;
      if (mutation.type === "attributes" && mutation.attributeName?.startsWith("data-cx-"))
        continue;
      if (mutation.type === "childList" && [...mutation.addedNodes, ...mutation.removedNodes].every(
        (node) => node.nodeType === 1 && node.matches(MOUNT_SELECTOR)
      ))
        continue;
      scheduleApply();
      return;
    }
  });
  observer.observe(root.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-row-key", "data-thread-branch", "aria-selected", "lang"]
  });
  source.start();
  const timer = view.setInterval(scheduleApply, 6e4);
  root.addEventListener(
    "visibilitychange",
    () => {
      if (root.visibilityState === "visible") source.refresh();
    },
    { signal: api.signal }
  );
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    source.dispose();
    view.clearInterval(timer);
    if (rafId !== void 0) view.cancelAnimationFrame?.(rafId);
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

// src/web/index.ts
function activate(api) {
  return activateWebHandoffs(api);
}
export {
  activate
};
