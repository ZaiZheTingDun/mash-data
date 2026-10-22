import { buildEventItemResources } from "../../shared/catalog-builders.ts";
import { formatResourceJson } from "../../shared/resource-json.ts";
import { rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { requireDataRoot } from "../../shared/data-paths.ts";
import { fetchItems } from "./api.js";
import { runWithConcurrency } from "./concurrency.js";
import { DownloadHttpError, downloadFile, ensureDir, writeJsonAtomic } from "./fs-utils.js";
import { EVENT_ITEMS_FILE, ITEM_ICONS_DIR } from "./paths.js";
import type { Region } from "./types.js";

import { EVENT_ITEM_TYPES, type EventItem, type EventItemsCatalog } from "../../shared/event-catalogs.ts";
export { EVENT_ITEM_TYPES, type EventItem, type EventItemsCatalog } from "../../shared/event-catalogs.ts";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function buildEventItemsCatalog(indices: Record<Region, unknown>): EventItemsCatalog {
  const regions = {} as Record<Region, EventItem[]>;
  for (const region of ["JP", "CN"] as const) {
    const index = indices[region];
    if (!Array.isArray(index) || index.length === 0) throw new Error(`${region} item index is missing or empty`);
    const seen = new Set<number>();
    const items: EventItem[] = [];
    for (const value of index) {
      if (!record(value) || typeof value.type !== "string") throw new Error(`Invalid ${region} item index entry`);
      if (!(EVENT_ITEM_TYPES as readonly string[]).includes(value.type)) continue;
      // Use the image filename, not the item ID: reruns often reuse an older icon.
      const iconMatch = typeof value.icon === "string"
        ? /^https:\/\/static\.atlasacademy\.io\/(?:JP|CN)\/Items\/([0-9]+\.png)$/.exec(value.icon)
        : null;
      if (typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0 || seen.has(value.id)
        || typeof value.name !== "string" || !value.name.trim()
        || typeof value.detail !== "string" || typeof value.background !== "string" || !value.background
        || !iconMatch) {
        throw new Error(`Invalid ${region} event item: ${String(value.id)}`);
      }
      seen.add(value.id);
      items.push({
        id: value.id, type: value.type as EventItem["type"], name: value.name,
        detail: value.detail, background: value.background, icon: `icons/items/${iconMatch[1]}`,
      });
    }
    if (!items.length) throw new Error(`${region} item index contains no event items`);
    regions[region] = items.sort((a, b) => a.id - b.id);
  }
  return { schemaVersion: 1, regions };
}

export async function downloadEventItems(options: {
  fetcher?: (region: Region) => Promise<unknown>;
  downloader?: (url: string, path: string) => Promise<void>;
  output?: string;
  iconsDir?: string;
} = {}): Promise<EventItemsCatalog> {
  const fetcher = options.fetcher ?? fetchItems;
  const [JP, CN] = await Promise.all([fetcher("JP"), fetcher("CN")]);
  const catalog = buildEventItemsCatalog({ JP, CN });
  const filenames = [...new Set(Object.values(catalog.regions).flat().flatMap(item => item.icon ? [basename(item.icon)] : []))].sort();
  const iconsDir = options.iconsDir ?? ITEM_ICONS_DIR;
  const downloader = options.downloader ?? downloadFile;
  await ensureDir(iconsDir);
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const missing = new Set<string>();
  const pending: string[] = [];
  for (const filename of filenames) {
    if (await stat(join(iconsDir, filename)).then(s => s.isFile() && s.size > 0, () => false)) {
      skipped++;
    } else {
      pending.push(filename);
    }
  }
  await runWithConcurrency(pending, 3, 200, async filename => {
    const dest = join(iconsDir, filename);
    const temp = join(iconsDir, `.${filename}.${process.pid}.tmp`);
    try {
      await downloader(`https://static.atlasacademy.io/JP/Items/${filename}`, temp);
      if ((await stat(temp)).size === 0) throw new Error("Empty icon download");
      await rename(temp, dest);
      downloaded++;
    } catch (error) {
      if (error instanceof DownloadHttpError && error.status === 404) {
        missing.add(filename);
        console.warn(`[event-items] Atlas has no JP icon: ${filename}`);
      } else {
        failed++;
        console.error(`[event-items] Failed ${filename}:`, error);
      }
    } finally {
      await rm(temp, { force: true });
    }
  });
  console.log(`Event item icons: downloaded=${downloaded} skipped=${skipped} missing=${missing.size} failed=${failed}`);
  if (failed) throw new Error(`${failed} event item icon downloads failed`);
  for (const items of Object.values(catalog.regions)) {
    for (const item of items) {
      if (item.icon && missing.has(basename(item.icon))) {
        item.missingIcon = `https://static.atlasacademy.io/JP/Items/${basename(item.icon)}`;
        item.icon = null;
      }
    }
  }
  // Only available images are referenced; upstream 404s stay explicit in metadata.
  await writeJsonAtomic(options.output ?? EVENT_ITEMS_FILE, buildEventItemResources(catalog), { format: formatResourceJson });
  console.log(`Event items: JP=${catalog.regions.JP.length} CN=${catalog.regions.CN.length} icons=${filenames.length}`);
  return catalog;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  requireDataRoot();
  downloadEventItems().catch(error => { console.error(error); process.exit(1); });
}
