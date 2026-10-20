import { requireDataRoot } from "../../shared/data-paths.ts";
import { readJson, writeJsonAtomic } from "./fs-utils.js";
import { EVENTS_CATALOG_FILE, EVENT_INDEX_FILES } from "./paths.js";
import type { Region } from "./types.js";

export interface CatalogEvent {
  id: number;
  type: string;
  name: string;
  noticeAt: number;
  startedAt: number;
  endedAt: number;
  finishedAt: number;
  warIds: number[];
}

export interface EventCatalog {
  schemaVersion: 1;
  regions: Record<Region, CatalogEvent[]>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

export function buildEventCatalog(indices: Record<Region, unknown>): EventCatalog {
  const regions = {} as Record<Region, CatalogEvent[]>;
  for (const region of ["JP", "CN"] as const) {
    const index = indices[region];
    if (!Array.isArray(index) || index.length === 0) throw new Error(`${region} event index is missing or empty`);
    const seen = new Set<number>();
    regions[region] = index.map((value: unknown) => {
      if (!record(value) || !integer(value.id, 1) || seen.has(value.id)
        || typeof value.type !== "string" || !value.type.trim()
        || typeof value.name !== "string" || !value.name.trim()
        || !integer(value.noticeAt) || !integer(value.startedAt)
        || !integer(value.endedAt) || !integer(value.finishedAt)
        || !Array.isArray(value.warIds) || !value.warIds.every((id: unknown) => integer(id, 1))) {
        throw new Error(`Invalid ${region} event index entry`);
      }
      seen.add(value.id);
      return {
        id: value.id, type: value.type, name: value.name,
        noticeAt: value.noticeAt, startedAt: value.startedAt,
        endedAt: value.endedAt, finishedAt: value.finishedAt,
        warIds: value.warIds,
      };
    }).sort((a, b) => a.id - b.id);
  }
  return { schemaVersion: 1, regions };
}

export async function combineEvents(options: {
  eventIndexFiles?: Record<Region, string>;
  output?: string;
} = {}): Promise<EventCatalog> {
  const files = options.eventIndexFiles ?? EVENT_INDEX_FILES;
  const catalog = buildEventCatalog({
    JP: await readJson<unknown>(files.JP),
    CN: await readJson<unknown>(files.CN),
  });
  await writeJsonAtomic(options.output ?? EVENTS_CATALOG_FILE, catalog);
  console.log(`Combined events. JP=${catalog.regions.JP.length} CN=${catalog.regions.CN.length}`);
  return catalog;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  combineEvents().catch((error) => { console.error(error); process.exit(1); });
}
