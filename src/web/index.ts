import type { WebExtensionApi } from "@codexhost/shared-contracts";
import { activateWebHandoffs } from "./handoff-web.js";

/** codexhost Web loads this module and calls `activate` once per activation. */
export function activate(api: WebExtensionApi): () => void {
  return activateWebHandoffs(api);
}
