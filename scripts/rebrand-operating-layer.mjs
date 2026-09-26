import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, relative } from "node:path";

const root = process.cwd();
const oldBrand = ["Order", "Mate"].join("");
const newBrand = "Operating Layer";
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage", ".wrangler"]);
const textExtensions = new Set([
  ".css", ".html", ".json", ".md", ".mjs", ".svg", ".ts", ".tsx", ".txt", ".yml", ".yaml", ".jsonc",
]);
const writeChanges = process.argv.includes("--write");
const token = new RegExp(`\\b${oldBrand}\\b`, "g");
const changed = [];
const remaining = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!textExtensions.has(extname(entry.name))) continue;

    const original = await readFile(path, "utf8");
    const next = original.replace(token, newBrand);
    if (next !== original) {
      changed.push(relative(root, path));
      if (writeChanges) await writeFile(path, next);
    }
  }
}

await walk(root);

if (writeChanges) {
  for (const path of changed) console.log(`rebranded ${path}`);
  console.log(`Operating Layer sweep updated ${changed.length} file(s).`);
}

async function verify(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await verify(path);
      continue;
    }
    if (!textExtensions.has(extname(entry.name))) continue;
    const content = await readFile(path, "utf8");
    if (token.test(content)) remaining.push(relative(root, path));
    token.lastIndex = 0;
  }
}

if (writeChanges) await verify(root);
else remaining.push(...changed);

if (remaining.length) {
  console.error(`Legacy brand token remains in ${remaining.length} file(s):`);
  remaining.forEach(path => console.error(`- ${path}`));
  process.exit(1);
}

console.log("Operating Layer brand sweep clean. Lowercase ordermate-* compatibility identifiers are intentionally outside this check.");
