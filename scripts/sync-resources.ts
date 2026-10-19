import { execFileSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireDataRoot } from "../shared/data-paths.ts";

const root = requireDataRoot();
const destination = join(root, "resources");
await mkdir(destination, { recursive: true });
execFileSync(process.execPath, [fileURLToPath(new URL("./generate-servants.ts", import.meta.url))], { stdio: "inherit" });
for (const name of ["servants_variants.json", "servants_variants_cn.json", "craft_essences.json"]) {
  await copyFile(join(root, "assets", name), join(destination, name));
}
