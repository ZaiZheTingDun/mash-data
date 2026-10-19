import { requireDataRoot } from "../../shared/data-paths.ts";
import { fetchBasicCraftEssences, fetchBasicEvents, fetchChangeLog, fetchCraftEssence, fetchDataVersions } from "./api.js";
import { craftEssencePaths, downloadCraftEssenceImages, loadOrFetchCraftEssence } from "./ce-cache.js";
import { validateEventIndex, validateRawCraftEssence } from "./compact-ce.js";
import { runWithConcurrency } from "./concurrency.js";
import { downloadFile, fileExists, readJson, writeJsonAtomic } from "./fs-utils.js";
import { CE_DATA_VERSION_FILE, CES_DIR, EVENT_INDEX_FILES } from "./paths.js";
import { normalizeDataVersion, parseChangeLog, readDataVersions, selectChangeRange, writeDataVersions } from "./servant-updates.js";
import type { AtlasChangeRecord, AtlasDataVersions, BasicEquip, BasicEvent, NiceEquip, Region } from "./types.js";

type DependencyType = "skill" | "func" | "buff";
const CE_CONCURRENCY = 5;
const CE_DELAY_MS = 100;

export function changedCraftEssences(
  records: AtlasChangeRecord[],
  rawByCollectionNo: Map<number, NiceEquip>,
  basic: BasicEquip[],
): Set<number> {
  const result = new Set<number>();
  const byId = new Map(basic.map((ce) => [ce.id, ce.collectionNo]));
  const collectionNos = new Set(basic.map((ce) => ce.collectionNo));
  const index: Record<DependencyType, Map<number, Set<number>>> = {
    skill: new Map(), func: new Map(), buff: new Map(),
  };
  const add = (kind: DependencyType, id: unknown, collectionNo: number) => {
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return;
    const owners = index[kind].get(id) ?? new Set<number>();
    owners.add(collectionNo);
    index[kind].set(id, owners);
  };
  const indexFunctions = (value: unknown, collectionNo: number) => {
    if (Array.isArray(value)) {
      for (const child of value) indexFunctions(child, collectionNo);
    } else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      add("func", obj.funcId, collectionNo);
      if (Array.isArray(obj.buffs)) {
        for (const buff of obj.buffs) add("buff", buff.id, collectionNo);
      }
      for (const child of Object.values(obj)) indexFunctions(child, collectionNo);
    }
  };
  for (const [collectionNo, raw] of rawByCollectionNo) {
    for (const skill of raw.skills) {
      add("skill", skill.id, collectionNo);
      indexFunctions(skill.functions, collectionNo);
    }
  }
  for (const record of records) {
    for (const kind of ["ce", "svt"] as const) {
      for (const entity of record.changes[kind]) {
        const collectionNo = byId.get(entity.id);
        if (collectionNo !== undefined) result.add(collectionNo);
        else if (kind === "ce" && entity.collectionNo && collectionNos.has(entity.collectionNo)) {
          result.add(entity.collectionNo);
        }
      }
    }
    for (const kind of ["skill", "func", "buff"] as const) {
      for (const entity of record.changes[kind]) {
        for (const collectionNo of index[kind].get(entity.id) ?? []) result.add(collectionNo);
      }
    }
  }
  return result;
}

export interface CraftEssenceDownloadDependencies {
  fetchVersions: () => Promise<AtlasDataVersions>;
  fetchBasic: (region: Region) => Promise<BasicEquip[]>;
  fetchEvents: (region: Region) => Promise<BasicEvent[]>;
  fetchChanges: (region: Region) => Promise<string>;
  fetchEquip: (region: Region, id: number) => Promise<NiceEquip>;
  downloadImage: (url: string, destination: string) => Promise<void>;
}

export interface DownloadCraftEssencesOptions {
  cesDir?: string;
  dataVersionFile?: string;
  eventIndexFiles?: Record<Region, string>;
  delayMs?: number;
  dependencies?: Partial<CraftEssenceDownloadDependencies>;
}

export async function downloadAllCraftEssences(options: DownloadCraftEssencesOptions = {}): Promise<void> {
  const cesDir = options.cesDir ?? CES_DIR;
  const cursorPath = options.dataVersionFile ?? CE_DATA_VERSION_FILE;
  const eventFiles = options.eventIndexFiles ?? EVENT_INDEX_FILES;
  const dependencies: CraftEssenceDownloadDependencies = {
    fetchVersions: fetchDataVersions,
    fetchBasic: fetchBasicCraftEssences,
    fetchEvents: fetchBasicEvents,
    fetchChanges: fetchChangeLog,
    fetchEquip: fetchCraftEssence,
    downloadImage: downloadFile,
    ...options.dependencies,
  };
  const versions = await dependencies.fetchVersions();
  const previous = await readDataVersions(cursorPath);
  const failures: string[] = [];

  for (const region of ["JP", "CN"] as const) {
    try {
      const target = normalizeDataVersion(versions[region]);
      if (!target) throw new Error("/info did not return a valid data version");
      const basic = (await dependencies.fetchBasic(region))
        .filter((ce) => Number.isInteger(ce.collectionNo) && ce.collectionNo > 0)
        .sort((a, b) => a.collectionNo - b.collectionNo);
      if (basic.length === 0) throw new Error("basic CE list is empty");
      const events = await dependencies.fetchEvents(region);
      validateEventIndex(events);
      const cached = new Map<number, NiceEquip>();
      for (const ce of basic) {
        const path = craftEssencePaths(region, ce.collectionNo, cesDir).raw;
        if (!(await fileExists(path))) continue;
        try {
          const raw = await readJson<unknown>(path);
          validateRawCraftEssence(raw, ce.collectionNo);
          if (raw.id !== ce.id) continue;
          cached.set(ce.collectionNo, raw);
        } catch {
          // Invalid/missing full responses are fetched; legacy basic JSON is never promoted.
        }
      }
      const local = previous[region];
      let mode = "unchanged";
      let refresh = new Set<number>();
      if (!local) {
        mode = "full";
        refresh = new Set(basic.map((ce) => ce.collectionNo));
      } else if (local.hash !== target.hash && !local.hash.startsWith(target.hash) && !target.hash.startsWith(local.hash)) {
        const range = selectChangeRange(parseChangeLog(await dependencies.fetchChanges(region)), local.hash, target.hash, region);
        mode = range.mode;
        refresh = range.mode === "full"
          ? new Set(basic.map((ce) => ce.collectionNo))
          : changedCraftEssences(range.records, cached, basic);
      }
      for (const ce of basic) if (!cached.has(ce.collectionNo)) refresh.add(ce.collectionNo);
      const errors: string[] = [];
      let refreshed = 0;
      let images = 0;
      await runWithConcurrency(basic, CE_CONCURRENCY, options.delayMs ?? CE_DELAY_MS, async (ce) => {
        try {
          const result = await loadOrFetchCraftEssence(region, ce.collectionNo, {
            cesDir, events, expectedId: ce.id, forceRefresh: refresh.has(ce.collectionNo),
            fetcher: dependencies.fetchEquip,
          });
          if (result.refreshed) refreshed += 1;
          if (region === "JP") {
            const downloaded = await downloadCraftEssenceImages(ce.collectionNo, {
              cesDir, downloader: dependencies.downloadImage,
            });
            images += downloaded;
          }
        } catch (error) {
          errors.push(`${ce.collectionNo}: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      if (errors.length > 0) throw new Error(`${errors.length} ${region} craft essence downloads failed: ${errors.join("; ")}`);
      await writeJsonAtomic(eventFiles[region], events);
      await writeDataVersions({ ...previous, [region]: target }, cursorPath);
      previous[region] = target;
      console.log(`${region} CEs done. mode=${mode} refreshed=${refreshed} rebuilt=${basic.length} images=${images}`);
    } catch (error) {
      failures.push(`${region}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`[${region} CEs] Update failed; cursor not advanced:`, error);
    }
  }
  if (failures.length > 0) throw new Error(`Craft essence updates failed:\n${failures.join("\n")}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  downloadAllCraftEssences().catch((error) => { console.error(error); process.exit(1); });
}
