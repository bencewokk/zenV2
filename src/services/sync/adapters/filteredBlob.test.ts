// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_SETTINGS_KEY, AI_SETTINGS_SECRET_FIELDS } from "@/services/ai/settings";
import { GOOGLE_SETTINGS_KEY, GOOGLE_SETTINGS_SECRET_FIELDS } from "@/services/google/settings";
import { CANVAS_SETTINGS_KEY, CANVAS_SETTINGS_SECRET_FIELDS } from "@/services/canvas/settings";
import {
  EXTERNAL_CONNECTIONS_KEY,
  EXTERNAL_CONNECTIONS_SECRET_FIELDS,
} from "@/services/connections/settings";
import { BLOB_DOC_ID, markBlobDirty } from "@/services/sync/cursor";
import { makeFilteredBlobAdapter } from "./filteredBlob";

function stored(key: string): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(key) ?? "null") as Record<string, unknown>;
}

beforeEach(() => localStorage.clear());

describe("filtered settings sync", () => {
  it("strips registered credentials recursively before push", async () => {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({
      provider: "deepseek",
      baseUrl: "https://api.example.test/v1",
      apiKey: "TOP_LEVEL_SECRET",
      nested: { apiKey: "NESTED_SECRET", keep: true },
    }));
    markBlobDirty("aiSettings");

    const adapter = makeFilteredBlobAdapter(
      "aiSettings",
      AI_SETTINGS_KEY,
      vi.fn(),
      [...AI_SETTINGS_SECRET_FIELDS],
    );
    const [doc] = await adapter.listDirty();
    expect(doc.data).toEqual({
      provider: "deepseek",
      baseUrl: "https://api.example.test/v1",
      nested: { keep: true },
    });
    expect(JSON.stringify(doc.data)).not.toContain("SECRET");
  });

  it("keeps endpoint-bound credentials when the service identities match", async () => {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({
      provider: "deepseek",
      baseUrl: "https://api.example.test/v1",
      apiKey: "LOCAL_AI_KEY",
    }));
    localStorage.setItem(GOOGLE_SETTINGS_KEY, JSON.stringify({
      clientId: "same-client",
      clientSecret: "LOCAL_GOOGLE_SECRET",
    }));
    localStorage.setItem(CANVAS_SETTINGS_KEY, JSON.stringify({
      baseUrl: "https://school.example.test/api/v1",
      accessToken: "LOCAL_CANVAS_TOKEN",
    }));

    await makeFilteredBlobAdapter("aiSettings", AI_SETTINGS_KEY, vi.fn(), [...AI_SETTINGS_SECRET_FIELDS]).apply([{
      id: BLOB_DOC_ID,
      updatedAt: 10,
      data: { provider: "deepseek", baseUrl: "https://api.example.test/v2", model: "new-model" },
    }]);
    await makeFilteredBlobAdapter("googleSettings", GOOGLE_SETTINGS_KEY, vi.fn(), [...GOOGLE_SETTINGS_SECRET_FIELDS]).apply([{
      id: BLOB_DOC_ID,
      updatedAt: 10,
      data: { clientId: "same-client" },
    }]);
    await makeFilteredBlobAdapter("canvasSettings", CANVAS_SETTINGS_KEY, vi.fn(), [...CANVAS_SETTINGS_SECRET_FIELDS]).apply([{
      id: BLOB_DOC_ID,
      updatedAt: 10,
      data: { baseUrl: "https://school.example.test/canvas" },
    }]);

    expect(stored(AI_SETTINGS_KEY)).toHaveProperty("apiKey", "LOCAL_AI_KEY");
    expect(stored(GOOGLE_SETTINGS_KEY)).toHaveProperty("clientSecret", "LOCAL_GOOGLE_SECRET");
    expect(stored(CANVAS_SETTINGS_KEY)).toHaveProperty("accessToken", "LOCAL_CANVAS_TOKEN");
  });

  it("drops endpoint-bound credentials when remote service identities change", async () => {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({
      provider: "deepseek",
      baseUrl: "https://old-ai.example.test",
      apiKey: "LOCAL_AI_KEY",
    }));
    localStorage.setItem(GOOGLE_SETTINGS_KEY, JSON.stringify({
      clientId: "old-client",
      clientSecret: "LOCAL_GOOGLE_SECRET",
    }));
    localStorage.setItem(CANVAS_SETTINGS_KEY, JSON.stringify({
      baseUrl: "https://old-school.example.test",
      accessToken: "LOCAL_CANVAS_TOKEN",
    }));

    await makeFilteredBlobAdapter("aiSettings", AI_SETTINGS_KEY, vi.fn(), [...AI_SETTINGS_SECRET_FIELDS]).apply([{
      id: BLOB_DOC_ID,
      updatedAt: 10,
      data: { provider: "deepseek", baseUrl: "https://attacker.example.test" },
    }]);
    await makeFilteredBlobAdapter("googleSettings", GOOGLE_SETTINGS_KEY, vi.fn(), [...GOOGLE_SETTINGS_SECRET_FIELDS]).apply([{
      id: BLOB_DOC_ID,
      updatedAt: 10,
      data: { clientId: "attacker-client" },
    }]);
    await makeFilteredBlobAdapter("canvasSettings", CANVAS_SETTINGS_KEY, vi.fn(), [...CANVAS_SETTINGS_SECRET_FIELDS]).apply([{
      id: BLOB_DOC_ID,
      updatedAt: 10,
      data: { baseUrl: "https://attacker.example.test" },
    }]);

    expect(stored(AI_SETTINGS_KEY)).not.toHaveProperty("apiKey");
    expect(stored(GOOGLE_SETTINGS_KEY)).not.toHaveProperty("clientSecret");
    expect(stored(CANVAS_SETTINGS_KEY)).not.toHaveProperty("accessToken");

    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({
      provider: "deepseek",
      baseUrl: "https://old-ai.example.test/v1",
      apiKey: "SECOND_LOCAL_AI_KEY",
    }));
    await makeFilteredBlobAdapter("aiSettings", AI_SETTINGS_KEY, vi.fn(), [...AI_SETTINGS_SECRET_FIELDS]).apply([{
      id: BLOB_DOC_ID,
      updatedAt: 11,
      data: { provider: "different-provider", baseUrl: "https://old-ai.example.test/v2" },
    }]);
    expect(stored(AI_SETTINGS_KEY)).not.toHaveProperty("apiKey");
  });

  it("keeps fixed-host external credentials while syncing portable metadata", async () => {
    localStorage.setItem(EXTERNAL_CONNECTIONS_KEY, JSON.stringify({
      zoteroLibraryId: "old-library",
      zoteroApiKey: "LOCAL_ZOTERO_KEY",
      githubToken: "LOCAL_GITHUB_TOKEN",
      githubRepositories: ["old/repo"],
    }));

    await makeFilteredBlobAdapter(
      "externalConnections",
      EXTERNAL_CONNECTIONS_KEY,
      vi.fn(),
      [...EXTERNAL_CONNECTIONS_SECRET_FIELDS],
    ).apply([{
      id: BLOB_DOC_ID,
      updatedAt: 10,
      data: { zoteroLibraryId: "new-library", githubRepositories: ["new/repo"] },
    }]);

    expect(stored(EXTERNAL_CONNECTIONS_KEY)).toMatchObject({
      zoteroLibraryId: "new-library",
      zoteroApiKey: "LOCAL_ZOTERO_KEY",
      githubToken: "LOCAL_GITHUB_TOKEN",
      githubRepositories: ["new/repo"],
    });
  });
});
