// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebExtensionApi } from "@codexhost/shared-contracts";
import { activateWebHandoffs, threadIdOfRowKey, webTimeLabel } from "../src/web/handoff-web.js";

const ID = "sidebar-thread-tree";
const NOW = Date.UTC(2026, 10, 28, 8, 0, 0);
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  document.body.replaceChildren();
  document.documentElement.lang = "";
  Reflect.deleteProperty(navigator, "serviceWorker");
});

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await new Promise((done) => setTimeout(done, 20));
}

/** A Web sidebar list, built like codexhost Web's (`Rows.tsx`, `ThreadTreeControls.tsx`). */
function webSidebar(): HTMLElement {
  const region = document.createElement("div");
  region.setAttribute("data-cx-region", "sidebar");
  const list = document.createElement("div");
  list.setAttribute("role", "group");
  region.append(list);
  document.body.append(region);
  return list;
}

function webRow(list: HTMLElement, threadId: string, title: string, agent: string) {
  const branch = document.createElement("div");
  branch.className = "branch";
  branch.setAttribute("data-thread-branch", "true");
  const hover = document.createElement("span");
  hover.className = "hover-card";
  const row = document.createElement("div");
  row.setAttribute("data-row-key", `recent:${threadId}`);
  row.setAttribute("data-thread-depth", "0");
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-selected", "false");
  row.setAttribute("tabindex", "-1");
  row.setAttribute("draggable", "true");
  row.className = "sessionRow";
  row.innerHTML = `<div class="sessionMain"><span class="slot"><div data-slot="sidebar.session.row.identity" style="display: contents;"><span data-harness-id="${agent}" role="img" aria-label="${agent}"><svg></svg></span></div><span class="statusOverlay"><div data-slot="sidebar.session.row.leading" style="display: contents;"></div></span></span><span data-session-title="true" class="title"><span class="titleText">${title}</span></span><span class="trailing"><span class="time">5分钟</span><span class="rowActions"><span><button type="button" aria-label="actions" aria-haspopup="menu" aria-expanded="false"></button></span><span class="quickActions"><button type="button" aria-label="归档会话"></button></span></span></span></div>`;
  hover.append(row);
  branch.append(hover);
  list.append(branch);
  return { branch, row };
}

function webApi(answer: unknown) {
  const abort = new AbortController();
  const disposers: Array<() => void> = [];
  const invoke = vi.fn(async (_method: string, _params?: unknown) => answer);
  const api: WebExtensionApi = {
    id: ID,
    apiVersion: 1,
    signal: abort.signal,
    dom: {
      mount(target, position = "append") {
        if (typeof target === "string") return undefined;
        const container = document.createElement("div");
        container.setAttribute("data-cx-web-ext-mount", ID);
        target[position](container);
        return { container, dispose: () => container.remove() };
      },
      mark: (target, name) => target.setAttribute(`data-cx-ext-${ID}-${name}`, ""),
      unmark: (target, name) => target.removeAttribute(`data-cx-ext-${ID}-${name}`),
    },
    track: (dispose) => {
      disposers.push(() => void dispose());
    },
    backend: { invoke: invoke as WebExtensionApi["backend"]["invoke"] },
  };
  const stop = activateWebHandoffs(api, { now: () => NOW });
  cleanups.push(() => {
    stop();
    abort.abort();
    for (const dispose of disposers) dispose();
  });
  return { api, invoke, stop };
}

const hidden = (element: Element) => element.hasAttribute(`data-cx-ext-${ID}-hidden`);

describe("context handoffs on Web", () => {
  it("reads Web's row keys and writes Web's relative time", () => {
    expect(threadIdOfRowKey("recent:abc")).toBe("abc");
    expect(threadIdOfRowKey("session:abc")).toBe("abc");
    expect(threadIdOfRowKey("workspace:codex-project:x")).toBeNull();
    expect(webTimeLabel(NOW - 30_000, NOW, true)).toBe("刚刚");
    expect(webTimeLabel(NOW - 2 * 86_400_000, NOW, true)).toBe("2天");
    expect(webTimeLabel(NOW - 3 * 3_600_000, NOW, false)).toBe("3h");
  });

  it("mirrors the older Thread right after the one that received context, and hands it presses", async () => {
    const list = webSidebar();
    const claude = webRow(list, "claude", "评估第三方支付 SDK", "claude-code");
    const other = webRow(list, "other", "整理支付接入文档", "claude-code");
    const codex = webRow(list, "codex", "评估第三方支付 SDK", "codex");
    webApi({ links: [{ target: "claude", source: "codex", at: 5 }], threads: {} });
    await settle();

    expect(hidden(codex.branch)).toBe(true);
    expect(hidden(other.branch)).toBe(false);
    const group = claude.branch.querySelector<HTMLElement>(".cxh-handoff");
    expect(group?.getAttribute("data-mode")).toBe("root");
    expect(claude.branch.lastElementChild).toBe(group);
    const unit = group?.querySelector<HTMLElement>(".cxh-handoff-unit");
    expect(unit?.getAttribute("data-handoff")).toBe("last");
    // Web's keyboard and motion code never take the mirror for one of its rows.
    expect(group?.querySelector("[data-row-key]")).toBeNull();
    const mirror = unit?.querySelector<HTMLElement>('[data-cxh-row-key="recent:codex"]');
    expect(mirror?.textContent).toContain("评估第三方支付 SDK");
    expect(mirror?.hasAttribute("draggable")).toBe(false);

    const presses: string[] = [];
    codex.row.addEventListener("click", () => presses.push("row"));
    codex.row.addEventListener("contextmenu", (event) =>
      presses.push(`menu@${String(event.clientX)},${String(event.clientY)}`),
    );
    const archive = codex.row.querySelector<HTMLButtonElement>('[aria-label="归档会话"]');
    archive?.addEventListener("click", () => presses.push("archive"));

    mirror?.querySelector<HTMLElement>(".titleText")?.click();
    mirror?.querySelector<HTMLElement>('[aria-label="归档会话"]')?.click();
    mirror?.querySelector(".titleText")?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 50,
      }),
    );
    mirror?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.click();
    // The archive button's click bubbles to Web's row, as a press on Web's own button does.
    expect(presses).toEqual(["row", "archive", "row", "menu@40,50", "menu@0,0"]);

    // The mirror follows Web's row.
    const nativeTitle = codex.row.querySelector(".titleText");
    if (nativeTitle) nativeTitle.textContent = "改名后的标题";
    await settle();
    expect(group?.querySelector('[data-cxh-row-key="recent:codex"]')?.textContent).toContain(
      "改名后的标题",
    );
  });

  it("draws a Thread Web shows nowhere from what the backend says, and opens it when selected", async () => {
    document.documentElement.lang = "zh-CN";
    const worker = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", { value: worker, configurable: true });
    const opened: unknown[] = [];
    worker.addEventListener("message", (event) => opened.push((event as MessageEvent).data));
    const list = webSidebar();
    const claude = webRow(list, "claude", "评估第三方支付 SDK", "claude-code");
    webRow(list, "other", "别的会话", "codex");
    const { invoke } = webApi({
      links: [{ target: "claude", source: "codex", at: 5 }],
      threads: {
        codex: {
          title: "评估第三方支付 SDK",
          agent: "codex",
          status: "idle",
          updatedAt: NOW - 86_400_000,
        },
      },
    });
    await settle();

    expect(invoke).toHaveBeenLastCalledWith("handoffs", { describe: ["codex"] });
    const drawn = claude.branch.querySelector<HTMLElement>('[data-cxh-row-key="handoff:codex"]');
    expect(drawn).not.toBeNull();
    expect(drawn?.querySelector(".titleText")?.textContent).toBe("评估第三方支付 SDK");
    expect(drawn?.querySelector(".time")?.textContent).toBe("1天");
    // The agent icon is copied from a row of the same agent, and Web's row buttons are left out.
    expect(drawn?.querySelector("[data-harness-id]")?.getAttribute("data-harness-id")).toBe(
      "codex",
    );
    expect(drawn?.querySelector(".rowActions")).toBeNull();

    drawn?.click();
    expect(opened).toEqual([{ type: "codexhost/open-session", sessionId: "codex" }]);
  });

  it("shows the whole group where the older Thread stands when it sorts first, and cleans up", async () => {
    const list = webSidebar();
    const codex = webRow(list, "codex", "Plan the run", "codex");
    const claude = webRow(list, "claude", "Plan the run", "claude-code");
    const { stop } = webApi({ links: [{ target: "claude", source: "codex", at: 5 }], threads: {} });
    await settle();

    expect(codex.branch.hasAttribute(`data-cx-ext-${ID}-anchor`)).toBe(true);
    expect(hidden(claude.branch)).toBe(true);
    const group = codex.branch.querySelector<HTMLElement>(".cxh-handoff");
    expect(group?.getAttribute("data-mode")).toBe("virtual");
    const places = [...(group?.querySelectorAll<HTMLElement>(".cxh-handoff-unit") ?? [])].map(
      (unit) => [
        unit.querySelector("[data-cxh-row-key]")?.getAttribute("data-cxh-row-key"),
        unit.getAttribute("data-handoff"),
      ],
    );
    expect(places).toEqual([
      ["recent:claude", "first"],
      ["recent:codex", "last"],
    ]);

    stop();
    expect(codex.branch.querySelector(".cxh-handoff")).toBeNull();
    expect(codex.branch.hasAttribute(`data-cx-ext-${ID}-anchor`)).toBe(false);
    expect(hidden(claude.branch)).toBe(false);
  });
});

describe("the Web rail's place", () => {
  it("is measured from the rows as laid out, not mid-glide", async () => {
    const list = webSidebar();
    const claude = webRow(list, "claude", "Plan the run", "claude-code");
    webRow(list, "codex", "Plan the run", "codex");
    const icon = claude.row.querySelector<HTMLElement>("[data-harness-id]");
    // Layout as Web lays it out: the list at y=100, a 32px row, its 14px icon 9px down, the group
    // 2px after the row.
    const layout = (element: HTMLElement) => {
      if (element === list) return { top: 100, left: 12, height: 200, parent: null };
      if (element === claude.branch) return { top: 0, left: 0, height: 68, parent: list };
      if (element === claude.row) return { top: 0, left: 0, height: 32, parent: claude.branch };
      if (element === icon) return { top: 9, left: 8, height: 14, parent: claude.row };
      if (element.classList.contains("cxh-handoff"))
        return { top: 34, left: 0, height: 32, parent: claude.branch };
      return { top: 0, left: 0, height: 0, parent: null };
    };
    const spies = [
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return layout(this).top;
      }),
      vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return layout(this).left;
      }),
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return layout(this).height;
      }),
      vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return layout(this).parent;
      }),
      // Web's row is still gliding from 44px higher: its client rect is not where it lands.
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
        this: Element,
      ) {
        const shift = this === claude.row || this === icon ? -44 : 0;
        const box = this instanceof HTMLElement ? layout(this) : { top: 0, left: 0, height: 0 };
        return new DOMRect(box.left, 100 + box.top + shift, 200, box.height);
      }),
    ];
    try {
      webApi({ links: [{ target: "claude", source: "codex", at: 5 }], threads: {} });
      await settle();
      const group = claude.branch.querySelector<HTMLElement>(".cxh-handoff");
      expect(group?.style.getPropertyValue("--cxh-rail-head")).toBe("18px");
      expect(group?.style.getPropertyValue("--cxh-icon-cy")).toBe("16px");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
