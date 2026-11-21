/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop tree toggle CSS", () => {
  it("stays clickable inside a native pointer-events:none row", () => {
    const css = readFileSync(new URL("../src/desktop.css", import.meta.url), "utf8");
    const toggleRule = css.match(/\.cxh-tree-toggle\s*\{([\s\S]*?)\}/u)?.[1];

    expect(toggleRule).toContain("all: unset;");
    expect(toggleRule).toContain("pointer-events: auto;");
  });
});
