const OWNER = "bencewokk";
const REPO = "zenV2";

export interface GitHubAsset { id: number; name: string; url: string; browser_download_url: string }
export interface GitHubRelease { tag_name: string; assets: GitHubAsset[] }

export function githubHeaders(accept = "application/vnd.github+json"): Record<string, string> {
  const token = process.env.GITHUB_RELEASES_TOKEN;
  if (!token) throw new Error("GITHUB_RELEASES_TOKEN is not configured");
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Zen-Updater",
  };
}

export async function latestRelease(): Promise<GitHubRelease> {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, { headers: githubHeaders() });
  if (!response.ok) throw new Error(`GitHub latest release ${response.status}`);
  return response.json() as Promise<GitHubRelease>;
}

export function assetApiUrl(id: number): string {
  return `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${id}`;
}
