import { applyRemoteAssistantTasks, assistantTasksForSync } from "@/services/assistantTasks";
import { clearDirty, getDirty } from "../cursor";
import type { SyncAdapter, WireDoc } from "../types";

const COLLECTION = "assistantTasks";

export const assistantTasksAdapter: SyncAdapter = {
  collection: COLLECTION,

  async listDirty(): Promise<WireDoc[]> {
    return assistantTasksForSync(getDirty(COLLECTION));
  },

  async apply(remote: WireDoc[]): Promise<void> {
    applyRemoteAssistantTasks(remote);
  },

  markPushed(ids: string[]): void {
    clearDirty(COLLECTION, ids);
  },
};

