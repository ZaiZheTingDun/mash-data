import { join } from "node:path";
import { getDataRoot } from "../../shared/data-paths.ts";

const dataRoot = getDataRoot();

export const ASSETS_ROOT = join(dataRoot, "assets");
export const SERVANTS_DIR = join(ASSETS_ROOT, "servants");
export const CES_DIR = join(ASSETS_ROOT, "ces");
export const ICONS_DIR = join(ASSETS_ROOT, "icons");
export const MYSTIC_CODES_DIR = join(ASSETS_ROOT, "mystic-codes");
export const CRAFT_ESSENCES_FILE = join(ASSETS_ROOT, "craft_essences.json");
export const SERVANTS_VARIANTS_FILE = join(ASSETS_ROOT, "servants_variants.json");
export const SERVANTS_VARIANTS_CN_FILE = join(
  ASSETS_ROOT,
  "servants_variants_cn.json",
);
export const SKILLS_DIR = join(ASSETS_ROOT, "skills");
export const DATA_VERSION_FILE = join(dataRoot, "state", "atlas-data-version.json");
