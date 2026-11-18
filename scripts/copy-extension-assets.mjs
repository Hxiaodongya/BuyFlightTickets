import { cp, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "dist");

await copyFile(
  path.join(projectRoot, "manifest.json"),
  path.join(outputRoot, "manifest.json"),
);

for (const directory of ["background", "collectors", "shared"]) {
  const source = path.join(projectRoot, "src", directory);
  const destination = path.join(outputRoot, "src", directory);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}
