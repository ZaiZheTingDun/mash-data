import { join } from "node:path";
import { getDataRoot } from "../../shared/data-paths.ts";

const dataRoot = getDataRoot();

export const ASSETS_ROOT = join(dataRoot, "assets");
export const CATALOGS_DIR = join(ASSETS_ROOT, "catalogs");
export const SERVANTS_DIR = join(ASSETS_ROOT, "servants");
export const CES_DIR = join(ASSETS_ROOT, "ces");
export const ICONS_DIR = join(ASSETS_ROOT, "icons");
export const MYSTIC_CODES_DIR = join(ASSETS_ROOT, "mystic-codes");
export const CRAFT_ESSENCES_FILE = join(CATALOGS_DIR, "craft_essences.json");
export const EVENTS_CATALOG_FILE = join(CATALOGS_DIR, "events.json");
export const EVENT_ITEMS_FILE = join(CATALOGS_DIR, "event_items.json");
export const ITEM_ICONS_DIR = join(ICONS_DIR, "items");
export const SERVANTS_VARIANTS_FILE = join(CATALOGS_DIR, "servants_variants.json");
export const SERVANTS_VARIANTS_CN_FILE = join(
  CATALOGS_DIR,
  "servants_variants_cn.json",
);
export const SKILLS_DIR = join(ASSETS_ROOT, "skills");
export const DATA_VERSION_FILE = join(dataRoot, "state", "atlas-data-version.json");
export const CE_DATA_VERSION_FILE = join(dataRoot, "state", "atlas-ce-data-version.json");
export const EVENT_INDEX_FILES = {
  JP: join(dataRoot, "state", "atlas-events-jp.json"),
  CN: join(dataRoot, "state", "atlas-events-cn.json"),
};
