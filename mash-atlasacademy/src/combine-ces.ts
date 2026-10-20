import { requireDataRoot } from "../../shared/data-paths.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { compactCraftEssence, craftEssenceSummary, validateEventIndex, validateRawCraftEssence, type CraftEssenceSummary } from "./compact-ce.js";
import { craftEssencePaths } from "./ce-cache.js";
import { fileExists, readJson, writeJsonAtomic } from "./fs-utils.js";
import { CES_DIR, CRAFT_ESSENCES_FILE, EVENT_INDEX_FILES } from "./paths.js";
import type { BasicEvent, Region } from "./types.js";

export interface CombinedCraftEssence {
  id: number;
  collectionNo: number;
  name: string;
  name_cn: string | null;
  rarity: number;
  flag: string | null;
  flags: string[];
  /** null means that region has no full response; [] means no evidence in its raw. */
  regions: Record<Region, CraftEssenceSummary | null>;
}

/** Keys and CE arrays use Atlas internal IDs, never collection numbers. */
export function buildCraftEssenceOwnerIndex(ces: CombinedCraftEssence[], region: Region) {
  const index = new Map<number, { bondEquipIds: number[]; valentineEquipIds: number[] }>();
  for (const ce of ces) {
    const data = ce.regions[region];
    if (!data) continue;
    for (const [field, key] of [["bondEquipOwner", "bondEquipIds"], ["valentineEquipOwner", "valentineEquipIds"]] as const) {
      const owner = data[field];
      if (owner === null) continue;
      const entry = index.get(owner) ?? { bondEquipIds: [], valentineEquipIds: [] };
      if (!entry[key].includes(ce.id)) entry[key].push(ce.id);
      index.set(owner, entry);
    }
  }
  for (const entry of index.values()) {
    entry.bondEquipIds.sort((a, b) => a - b);
    entry.valentineEquipIds.sort((a, b) => a - b);
  }
  return index;
}

export interface CombineCraftEssencesOptions {
  cesDir?: string;
  output?: string;
  eventIndexFiles?: Record<Region, string>;
}

export async function combineCraftEssences(options: CombineCraftEssencesOptions = {}): Promise<CombinedCraftEssence[]> {
  const cesDir = options.cesDir ?? CES_DIR;
  const output = options.output ?? CRAFT_ESSENCES_FILE;
  const eventFiles = options.eventIndexFiles ?? EVENT_INDEX_FILES;
  const events: Record<Region, BasicEvent[]> = { JP: [], CN: [] };
  for (const region of ["JP", "CN"] as const) {
    // A missing event index is an incomplete migration, not an empty event list.
    const value = await readJson<unknown>(eventFiles[region]);
    validateEventIndex(value);
    events[region] = value;
  }
  const dirs = (await readdir(cesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => entry.name).sort((a, b) => Number(a) - Number(b));
  const craftEssences: CombinedCraftEssence[] = [];
  for (const dir of dirs) {
    const load = async (region: Region) => {
      const paths = craftEssencePaths(region, Number(dir), cesDir);
      if (!(await fileExists(paths.raw))) {
        if (await fileExists(paths.compact)) throw new Error(`[${region} ce ${dir}] Missing full raw cache; run start:ces to migrate basic JSON`);
        return null;
      }
      const raw = await readJson<unknown>(paths.raw);
      validateRawCraftEssence(raw, Number(dir));
      return compactCraftEssence(raw, events[region]);
    };
    const jp = await load("JP");
    const cn = await load("CN");
    const ce = jp ?? cn;
    if (!ce) throw new Error(`[ce ${dir}] Missing full raw cache`);
    if (jp && cn && jp.id !== cn.id) throw new Error(`[ce ${dir}] JP/CN ID mismatch`);
    // Do not trust an old compact file after extractor changes.
    if (jp) await writeJsonAtomic(join(cesDir, dir, "craft-essence.json"), jp);
    if (cn) await writeJsonAtomic(join(cesDir, dir, "craft-essence-cn.json"), cn);
    craftEssences.push({
      id: ce.id, collectionNo: ce.collectionNo,
      name: ce.name, name_cn: cn?.name ?? null,
      rarity: ce.rarity, flag: ce.flag ?? null, flags: ce.flags,
      regions: { JP: jp ? craftEssenceSummary(jp) : null, CN: cn ? craftEssenceSummary(cn) : null },
    });
  }
  if (craftEssences.length === 0) throw new Error("No craft essences to combine");
  await writeJsonAtomic(output, craftEssences, { arrayItemPerLine: true });
  console.log(`Combined craft essences. written=${craftEssences.length} output=${output}`);
  return craftEssences;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  combineCraftEssences().catch((error) => { console.error(error); process.exit(1); });
}
