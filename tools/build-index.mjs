import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "plugins/tasks/clef");
const versions = (await readdir(directory, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
  .map(entry => entry.name).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
if (!versions.length) throw new Error("No release directories found");
const entries = [];
let latest;
for (const version of versions) {
  const relative = `plugins/tasks/clef/${version}/plugin.js`;
  const file = path.join(root, relative);
  const { meta } = await import(pathToFileURL(file));
  if (meta.key !== "clef" || meta.version !== version || meta.apiVersion !== 1)
    throw new Error(`Directory and manifest disagree: ${relative}`);
  latest ??= meta;
  for (const locale of ["en", "zh-CN"]) {
    const changelog = await readFile(path.join(directory, version, locale === "en" ? "CHANGELOG.md" : "CHANGELOG.zh-CN.md"), "utf8");
    for (const expected of ["changelogVersion: 1", 'plugin: "clef"', `version: "${version}"`, `locale: "${locale}"`, `## [${version}]`, "### Added"])
      if (!changelog.includes(expected)) throw new Error(`Invalid ${locale} changelog: missing ${expected}`);
  }
  entries.push({ version, path: relative, sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
    minApiVersion: 1, kind: "task", allowedHosts: [], auth: meta.auth });
}
const index = {
  indexVersion: 1,
  name: "Clef for New API (community)",
  plugins: [{ key: latest.key, name: latest.name, icon: latest.icon, author: latest.author,
    description: latest.description, website: latest.website, models: latest.models,
    routes: latest.routes, usageSchema: latest.usageSchema, usageExamples: latest.usageExamples,
    latest: latest.version, versions: entries }],
};
const content = JSON.stringify(index, null, 2) + "\n";
const target = path.join(root, "index.json");
if (process.argv.includes("--check")) {
  if (await readFile(target, "utf8") !== content) throw new Error("Stale index.json; run npm run index");
  console.log("Index hashes, manifest fields and changelog metadata match.");
} else {
  await writeFile(target, content);
  console.log("Generated index.json from imported plugin metadata and source hashes.");
}
