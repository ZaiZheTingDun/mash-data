import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Unit tests always use a temporary dataset, even if a private root is configured.
const root = mkdtempSync(join(tmpdir(), "mash-unit-data-"));
mkdirSync(join(root, "assets"));
process.env.MASH_DATA_ROOT = root;
process.once("exit", () => rmSync(root, { recursive: true, force: true }));
