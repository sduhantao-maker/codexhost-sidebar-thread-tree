// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HANDOFF_POLL_MS,
  HandoffSource,
  MAX_HANDOFF_CHAIN,
  handoffChains,
  handoffMembers,
  handoffRail,
  parseHandoffSnapshot,
  type HandoffLink,
} from "../src/handoff.js";

afterEach(() => {
  vi.useRealTimers();
});

const link = (target: string, source: string, at: number): HandoffLink => ({ target, source, at });

describe("handoff chains", () => {
  it("orders a chain from the Thread that received context most recently to where it started", () => {
    const chains = handoffChains([link("b", "a", 10), link("c", "b", 20)], () => true);
    expect(chains).toEqual([["c", "b", "a"]]);
  });

  it("keeps branching handoffs from one Thread together, newest first", () => {
    const chains = handoffChains([link("b", "a", 10), link("c", "a", 30)], () => true);
    expect(chains).toEqual([["c", "b", "a"]]);
  });

  it("stays joined through a Thread that is left out, and drops chains of one", () => {
    const links = [link("b", "a", 10), link("c", "b", 20), link("y", "x", 5)];
    const shown = new Set(["a", "c", "x"]);
    expect(handoffChains(links, (id) => shown.has(id))).toEqual([["c", "a"]]);
  });

  it("caps a chain at its newest Threads", () => {
    const links = Array.from({ length: MAX_HANDOFF_CHAIN + 4 }, (_, index) =>
      link(`t${String(index + 1)}`, `t${String(index)}`, index + 1),
    );
    const [chain] = handoffChains(links, () => true);
    expect(chain).toHaveLength(MAX_HANDOFF_CHAIN);
    expect(chain?.[0]).toBe(`t${String(MAX_HANDOFF_CHAIN + 4)}`);
  });

  it("lists every Thread a link touches", () => {
    expect([...handoffMembers([link("b", "a", 1), link("c", "b", 2)])].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("the backend's answer", () => {
  it("keeps well-formed links and descriptions only", () => {
    const snapshot = parseHandoffSnapshot({
      links: [
        { target: "b", source: "a", at: 5 },
        { target: "b", source: "z", at: 6 },
        { target: "c", source: "c", at: 1 },
        { target: "", source: "a" },
        "junk",
        { target: "d", source: "a", at: Number.NaN },
      ],
      threads: {
        a: { title: "Plan", agent: "codex", status: "running", updatedAt: 42 },
        b: { title: 7, status: "dancing" },
      },
    });
    expect(snapshot.links).toEqual([
      { target: "b", source: "a", at: 5 },
      { target: "d", source: "a", at: 0 },
    ]);
    expect(snapshot.threads).toEqual({
      a: { title: "Plan", agent: "codex", status: "running", updatedAt: 42 },
      b: {},
    });
    expect(parseHandoffSnapshot(null)).toEqual({ links: [], threads: {} });
  });
});

describe("the handoff rail", () => {
  it("uses the tree guides' elbow where there is room", () => {
    expect(handoffRail(32)).toEqual({ x: 15.5, width: 10.5 });
  });

  it("runs tighter where little space is left of the icons", () => {
    expect(handoffRail(8, -3)).toEqual({ x: -3, width: 8 });
    expect(handoffRail(5, 1).width).toBeGreaterThanOrEqual(4);
  });
});

describe("HandoffSource", () => {
  const answer = { links: [{ target: "b", source: "a", at: 1 }], threads: {} };

  it("asks once at a time, again when the wanted Threads change, and polls", async () => {
    vi.useFakeTimers();
    let resolve: (value: unknown) => void = () => undefined;
    const invoke = vi.fn(
      () =>
        new Promise<unknown>((done) => {
          resolve = done;
        }),
    );
    const onChange = vi.fn();
    const source = new HandoffSource({ invoke, onChange, visible: () => true, timers: window });
    source.start();
    source.refresh();
    expect(invoke).toHaveBeenCalledTimes(1);
    resolve(answer);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(source.snapshot.links).toHaveLength(1);
    resolve(answer);
    await Promise.resolve();
    source.want(["a"]);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    expect(invoke).toHaveBeenLastCalledWith("handoffs", { describe: ["a"] });
    resolve(answer);
    await Promise.resolve();
    // The same wanted Threads do not ask again.
    source.want(["a"]);
    expect(invoke).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(HANDOFF_POLL_MS);
    expect(invoke).toHaveBeenCalledTimes(4);
    source.dispose();
  });

  it("retries a failed call soon, then less often", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn(() => Promise.reject(new Error("backend is starting")));
    const source = new HandoffSource({
      invoke,
      onChange: () => undefined,
      visible: () => false,
      timers: window,
    });
    source.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invoke).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(invoke).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(3);
    source.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
