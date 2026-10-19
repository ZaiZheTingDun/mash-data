import { join } from "node:path";
import { fetchCraftEssence } from "./api.js";
import { compactCraftEssence, validateRawCraftEssence, type CompactCraftEssence } from "./compact-ce.js";
import { downloadFile, fileExists, readJson, writeJsonAtomic } from "./fs-utils.js";
import { CES_DIR } from "./paths.js";
import type { BasicEvent, NiceEquip, Region } from "./types.js";

export function craftEssencePaths(region: Region, collectionNo: number, cesDir = CES_DIR) {
  const stem = region === "JP" ? "craft-essence" : "craft-essence-cn";
  const dir = join(cesDir, String(collectionNo));
  return { compact: join(dir, `${stem}.json`), raw: join(dir, `${stem}-raw.json`) };
}

export interface LoadCraftEssenceOptions {
  cesDir?: string;
  forceRefresh?: boolean;
  expectedId?: number;
  events?: BasicEvent[];
  fetcher?: (region: Region, id: number) => Promise<NiceEquip>;
}

export async function loadOrFetchCraftEssence(
  region: Region,
  collectionNo: number,
  options: LoadCraftEssenceOptions = {},
): Promise<{ data: CompactCraftEssence; raw: NiceEquip; refreshed: boolean }> {
  const paths = craftEssencePaths(region, collectionNo, options.cesDir);
  let raw: NiceEquip | undefined;
  if (!options.forceRefresh && await fileExists(paths.raw)) {
    try {
      const cached = await readJson<unknown>(paths.raw);
      validateRawCraftEssence(cached, collectionNo);
      raw = cached;
    } catch (error) {
      console.warn(`[${region} ce ${collectionNo}] Invalid raw cache; refetching:`, error);
    }
  }
  const refreshed = raw === undefined;
  raw ??= await (options.fetcher ?? fetchCraftEssence)(region, collectionNo);
  validateRawCraftEssence(raw, collectionNo);
  if (options.expectedId !== undefined && raw.id !== options.expectedId) {
    throw new Error(`CE ID mismatch: expected ${options.expectedId}, got ${raw.id}`);
  }
  const data = compactCraftEssence(raw, options.events);
  if (refreshed) await writeJsonAtomic(paths.raw, raw);
  // Re-project even a valid compact cache so extractor and event-name changes apply.
  await writeJsonAtomic(paths.compact, data);
  return { data, raw, refreshed };
}

export async function downloadCraftEssenceImages(
  collectionNo: number,
  options: { cesDir?: string; downloader?: (url: string, destination: string) => Promise<void> } = {},
): Promise<number> {
  const paths = craftEssencePaths("JP", collectionNo, options.cesDir);
  const data = await readJson<CompactCraftEssence>(paths.compact);
  if (!data.face) return 0;
  const destination = join(options.cesDir ?? CES_DIR, String(collectionNo), "card_ce.png");
  if (await fileExists(destination)) return 0;
  await (options.downloader ?? downloadFile)(data.face, destination);
  return 1;
}
