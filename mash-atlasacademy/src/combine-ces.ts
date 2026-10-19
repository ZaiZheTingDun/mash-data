import { requireDataRoot } from "../../shared/data-paths.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileExists, readJson, writeJson } from "./fs-utils.js";
import { CES_DIR, CRAFT_ESSENCES_FILE } from "./paths.js";

interface CraftEssenceSource {
  id: number;
  collectionNo: number;
  name: string;
  rarity: number;
  flag?: string;
  flags?: string[];
}

interface CombinedCraftEssence {
  id: number;
  collectionNo: number;
  name: string;
  name_cn: string | null;
  rarity: number;
  flag: string | null;
  flags: string[];
}

export async function combineCraftEssences(): Promise<void> {
  const entries = await readdir(CES_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => /^\d+$/.test(n))
    .sort((a, b) => Number(a) - Number(b));

  const craftEssences: CombinedCraftEssence[] = [];
  let skipped = 0;
  let missingCn = 0;
  let failed = 0;

  for (const dir of dirs) {
    const cePath = join(CES_DIR, dir, "craft-essence.json");
    if (!(await fileExists(cePath))) {
      skipped += 1;
      continue;
    }

    try {
      const ce = await readJson<CraftEssenceSource>(cePath);
      const cnPath = join(CES_DIR, dir, "craft-essence-cn.json");
      let nameCn: string | null = null;

      if (await fileExists(cnPath)) {
        const ceCn = await readJson<CraftEssenceSource>(cnPath);
        nameCn = ceCn.name;
      } else {
        missingCn += 1;
      }

      craftEssences.push({
        id: ce.id,
        collectionNo: ce.collectionNo,
        name: ce.name,
        name_cn: nameCn,
        rarity: ce.rarity,
        flag: ce.flag ?? null,
        flags: ce.flags ?? [],
      });
    } catch (err) {
      failed += 1;
      console.error(`[ce ${dir}] Failed to combine craft essence JSON:`, err);
    }
  }

  craftEssences.sort((a, b) => a.collectionNo - b.collectionNo);
  await writeJson(CRAFT_ESSENCES_FILE, craftEssences);

  console.log(
    `Combined craft essences. written=${craftEssences.length} skipped=${skipped} missingCn=${missingCn} failed=${failed} output=${CRAFT_ESSENCES_FILE}`,
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  combineCraftEssences().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
