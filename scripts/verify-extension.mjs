import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const requiredFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...manifest.content_scripts.flatMap((script) => script.js),
];

for (const file of requiredFiles) {
  if (!file || !(await stat(path.join(root, file)).then(() => true, () => false))) {
    throw new Error(`Manifest resource is missing: ${file ?? "<empty path>"}`);
  }
}

const popupHtml = await readFile(path.join(root, manifest.action.default_popup), "utf8");
if (!popupHtml.includes("popup.js") || !popupHtml.includes("popup.css")) {
  throw new Error("Popup HTML must reference its script and stylesheet");
}

const dashboardHtml = await readFile(path.join(root, "src/dashboard/index.html"), "utf8");
if (!dashboardHtml.includes("dashboard.js") || !dashboardHtml.includes("dashboard.css")) {
  throw new Error("Dashboard HTML must reference its script and stylesheet");
}

async function findJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findJavaScriptFiles(entryPath)));
    } else if (/\.(?:js|mjs)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

const javascriptFiles = await findJavaScriptFiles(root);
for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    throw new Error(`JavaScript syntax check failed: ${path.relative(root, file)}`);
  }
}

console.log(`Extension resources verified; ${javascriptFiles.length} JavaScript files pass syntax checks.`);
