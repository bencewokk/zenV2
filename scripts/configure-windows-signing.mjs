import { readFileSync, writeFileSync } from "node:fs";

const thumbprint = (process.env.ZEN_WINDOWS_CERT_THUMBPRINT || "").trim();
if (!thumbprint) throw new Error("ZEN_WINDOWS_CERT_THUMBPRINT is missing");

const path = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const config = JSON.parse(readFileSync(path, "utf8"));
config.bundle ??= {};
config.bundle.windows = {
  ...(config.bundle.windows ?? {}),
  certificateThumbprint: thumbprint,
  digestAlgorithm: "sha256",
  timestampUrl: "http://timestamp.digicert.com",
};
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
console.log("Windows Authenticode signing configured");
