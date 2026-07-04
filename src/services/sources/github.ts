import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { loadExternalConnectionSettings } from "@/services/connections/settings";
import { useSources } from "./store";
import type { ConnectedSource, SourceRefreshResult } from "./types";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const httpFetch: typeof fetch = IS_TAURI ? (tauriFetch as typeof fetch) : fetch;
const TEXT_EXT = /(?:^|\.)(?:md|mdx|txt|rst|adoc|js|jsx|ts|tsx|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|scala|sh|ps1|sql|html|css|scss|json|ya?ml|toml|xml)$/i;

interface Repo { full_name: string; name: string; description?: string; html_url: string; default_branch: string; updated_at: string; private: boolean }
interface TreeItem { path: string; type: "blob" | "tree"; size?: number; url: string }
interface Issue { number: number; title: string; body?: string; html_url: string; state: string; updated_at: string; user?: { login: string }; labels?: Array<{ name: string }>; pull_request?: unknown }
interface Content { content?: string; encoding?: string }

async function github<T>(path: string): Promise<T> {
  const token = loadExternalConnectionSettings().githubToken.trim();
  const response = await httpFetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${(await response.text().catch(() => "")).slice(0, 180)}`);
  return response.json() as Promise<T>;
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export async function testGitHubConnection(): Promise<string> {
  const settings = loadExternalConnectionSettings();
  const first = settings.githubRepositories[0];
  if (first) return (await github<Repo>(`/repos/${first}`)).full_name;
  if (!settings.githubToken.trim()) throw new Error("Add a repository or GitHub token first.");
  return (await github<{ login: string }>("/user")).login;
}

export async function refreshGitHubSources(): Promise<SourceRefreshResult> {
  const settings = loadExternalConnectionSettings();
  const repositories = settings.githubRepositories;
  if (!repositories.length) return { provider: "github", imported: 0, message: "No GitHub repositories selected." };
  const records: ConnectedSource[] = [];
  const now = Date.now();
  for (const fullName of repositories) {
    if (!/^[^/]+\/[^/]+$/.test(fullName)) continue;
    const repo = await github<Repo>(`/repos/${fullName}`);
    const repoId = `github:repo:${repo.full_name.toLowerCase()}`;
    records.push({ id: repoId, provider: "github", kind: "repository", externalId: repo.full_name, title: repo.full_name, text: repo.description ?? "", url: repo.html_url, sourceUpdatedAt: new Date(repo.updated_at).getTime(), syncedAt: now });
    const tree = await github<{ tree: TreeItem[]; truncated?: boolean }>(`/repos/${fullName}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`);
    const files = tree.tree.filter((item) => item.type === "blob" && (item.size ?? 0) <= 500_000 && TEXT_EXT.test(item.path) && !settings.githubExcludePatterns.some((pattern) => item.path.toLowerCase().includes(pattern.toLowerCase()))).slice(0, 150);
    for (const file of files) {
      let text = "";
      try {
        const content = await github<Content>(`/repos/${fullName}/contents/${file.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(repo.default_branch)}`);
        if (content.encoding === "base64" && content.content) text = decodeBase64(content.content).slice(0, 200_000);
      } catch { /* keep metadata-only source */ }
      records.push({
        id: `github:file:${repo.full_name.toLowerCase()}:${file.path}`, provider: "github", kind: "file", externalId: file.path,
        parentId: repoId, container: repo.full_name, title: file.path, text,
        url: `${repo.html_url}/blob/${encodeURIComponent(repo.default_branch)}/${file.path}`, metadata: { repository: repo.full_name, size: file.size ?? 0 }, syncedAt: now,
      });
    }
    const issues = await github<Issue[]>(`/repos/${fullName}/issues?state=all&sort=updated&direction=desc&per_page=100`);
    for (const issue of issues) records.push({
      id: `github:${issue.pull_request ? "pr" : "issue"}:${repo.full_name.toLowerCase()}:${issue.number}`,
      provider: "github", kind: issue.pull_request ? "pull_request" : "issue", externalId: String(issue.number), parentId: repoId,
      container: repo.full_name, title: `#${issue.number} ${issue.title}`, text: issue.body ?? "", url: issue.html_url,
      authors: issue.user?.login ? [issue.user.login] : undefined, tags: (issue.labels ?? []).map((label) => label.name),
      metadata: { repository: repo.full_name, number: issue.number, state: issue.state }, sourceUpdatedAt: new Date(issue.updated_at).getTime(), syncedAt: now,
    });
  }
  await useSources.getState().replaceProvider("github", records);
  return { provider: "github", imported: records.length };
}
