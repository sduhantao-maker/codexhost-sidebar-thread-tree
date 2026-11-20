/**
 * The part of codexhost's `@codexhost/shared-contracts` this extension is built against: the
 * Desktop extension API v1 and the Thread tree it reads. Copied from BytePioneer-AI/codex-host
 * (`packages/shared-contracts`, LGPL-3.0-only) so the extension builds on its own.
 *
 * The bundle uses only the types. The tests use the schemas to check their fixtures.
 */
import { z } from "zod";

const opaqueIdSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Identifier must not be empty or whitespace",
});

export const harnessIdSchema = opaqueIdSchema.brand<"HarnessId">();
export type HarnessId = z.infer<typeof harnessIdSchema>;

export const hostThreadIdSchema = opaqueIdSchema.brand<"HostThreadId">();
export type HostThreadId = z.infer<typeof hostThreadIdSchema>;

export const THREAD_TREE_MAX_NODES = 5000;

export const threadTreeStatusSchema = z.enum(["running", "waiting", "idle", "unknown"]);
export type ThreadTreeStatus = z.infer<typeof threadTreeStatusSchema>;

export const threadTreeNodeSchema = z.strictObject({
  harnessId: harnessIdSchema,
  title: z.string().optional(),
  status: threadTreeStatusSchema,
  archived: z.boolean(),
});
export type ThreadTreeNode = z.infer<typeof threadTreeNodeSchema>;

export const threadTreeSnapshotSchema = z
  .strictObject({
    revision: z.int().nonnegative(),
    parents: z.record(hostThreadIdSchema, hostThreadIdSchema),
    nodes: z.record(hostThreadIdSchema, threadTreeNodeSchema),
    truncated: z.boolean(),
  })
  .refine(
    (snapshot) => Object.keys(snapshot.nodes).length <= THREAD_TREE_MAX_NODES,
    "Too many Thread tree nodes",
  )
  .refine(
    ({ parents, nodes }) =>
      Object.entries(parents).every(
        ([child, parent]) => Object.hasOwn(nodes, child) && Object.hasOwn(nodes, parent),
      ),
    "Missing Thread tree node",
  );
export type ThreadTreeSnapshot = z.infer<typeof threadTreeSnapshotSchema>;

export interface DesktopSidebarRow {
  readonly element: HTMLElement;
  readonly hostId: string | null;
  readonly isLocal: boolean;
  readonly threadId: string | null;
  readonly draftId: string | null;
  isConnected(): boolean;
}

export interface DesktopExtensionApiV1 {
  readonly id: string;
  readonly apiVersion: 1;
  readonly signal: AbortSignal;
  sidebar: { observeRows(cb: (rows: readonly DesktopSidebarRow[]) => void): () => void };
  threads: { watchTree(cb: (tree: ThreadTreeSnapshot) => void): () => void };
  navigate: { openThread(threadId: string): Promise<void> };
  harnesses: { describe(harnessId: string): { name: string; icon?: string } | undefined };
  dom: {
    mount(
      node: Element,
      parent: Element,
      position?: "append" | "prepend" | "before" | "after",
    ): void;
    mark(target: Element, name: string): void;
    unmark(target: Element, name: string): void;
  };
  track(teardown: () => void): void;
}

export type DesktopExtensionDispose = () => void | Promise<void>;
export interface DesktopExtensionDefinitionV1 {
  activate(
    api: DesktopExtensionApiV1,
  ): void | DesktopExtensionDispose | Promise<void | DesktopExtensionDispose>;
}
export type DesktopExtensionDefine = (definition: DesktopExtensionDefinitionV1) => void;
