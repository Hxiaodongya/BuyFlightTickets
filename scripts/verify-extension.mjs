import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "dist");
const manifestPath = path.join(outputRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const requiredFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  "src/dashboard/index.html",
  ...manifest.content_scripts.flatMap((script) => script.js),
];

for (const file of requiredFiles) {
  const exists = file && await stat(path.join(outputRoot, file)).then(
    () => true,
    () => false,
  );
  if (!exists) {
    throw new Error(`Built manifest resource is missing: ${file ?? "<empty path>"}`);
  }
}

for (const script of manifest.content_scripts) {
  const cityFormIndex = script.js.indexOf("src/collectors/city-form.js");
  const collectorIndex = script.js.findIndex((file) =>
    file === "src/collectors/airchina.js" || file === "src/collectors/csair.js",
  );
  if (cityFormIndex < 0 || collectorIndex < 0 || cityFormIndex > collectorIndex) {
    throw new Error("Each airline content script must load city-form.js before its collector");
  }
}

for (const htmlPath of [
  path.join(outputRoot, manifest.action.default_popup),
  path.join(outputRoot, "src/dashboard/index.html"),
]) {
  const html = await readFile(htmlPath, "utf8");
  if (!html.includes('id="app"')) {
    throw new Error(`Vue application mount point is missing: ${path.relative(outputRoot, htmlPath)}`);
  }
  if (/\b(?:src|href)=["']https?:\/\//i.test(html)) {
    throw new Error(`Extension UI must not load remote code or styles: ${path.relative(outputRoot, htmlPath)}`);
  }

  for (const [, resource] of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
    if (/^(?:data:|#)/i.test(resource)) {
      continue;
    }
    const resourcePath = path.resolve(path.dirname(htmlPath), resource.split(/[?#]/, 1)[0]);
    if (!resourcePath.startsWith(`${outputRoot}${path.sep}`)) {
      throw new Error(`Extension resource escapes dist/: ${resource}`);
    }
    if (!(await stat(resourcePath).then(() => true, () => false))) {
      throw new Error(`Built UI asset is missing: ${resource}`);
    }
  }
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

const javascriptFiles = await findJavaScriptFiles(outputRoot);
for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    throw new Error(`Built JavaScript syntax check failed: ${path.relative(outputRoot, file)}`);
  }
}

console.log(`Built extension verified; ${javascriptFiles.length} JavaScript files pass syntax checks.`);
