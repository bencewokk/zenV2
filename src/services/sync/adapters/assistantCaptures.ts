import { applyRemoteAssistantCaptures } from "@/services/assistantCaptures";
import type { SyncAdapter, WireDoc } from "../types";

export const assistantCapturesAdapter: SyncAdapter = {
  collection: "assistant_captures",

  async listDirty(): Promise<WireDoc[]> {
    return [];
  },

  async apply(remote: WireDoc[]): Promise<void> {
    applyRemoteAssistantCaptures(remote);
  },

  markPushed(): void {
    /* Desktop currently only pulls phone captures. */
  },
};

