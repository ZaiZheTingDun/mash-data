import { requireDataRoot } from "../../shared/data-paths.ts";
import { fetchBasicCraftEssences } from "./api.js";
import { runWithConcurrency } from "./concurrency.js";
import {
  writeCraftEssenceAssets,
  writeCraftEssenceJson,
} from "./downloader.js";
import type { Region } from "./types.js";

const CE_CONCURRENCY = 5;
const CE_DELAY_MS = 100;

export async function downloadAllCraftEssences(): Promise<void> {
  await downloadCraftEssencesWithAssets();
  await downloadCraftEssencesJsonOnly("CN");
}

async function downloadCraftEssencesWithAssets(): Promise<void> {
  const ces = await fetchCraftEssences("JP");

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  await runWithConcurrency(
    ces,
    CE_CONCURRENCY,
    CE_DELAY_MS,
    async (ce) => {
      try {
        const result = await writeCraftEssenceAssets(ce);
        if (result === "downloaded") downloaded += 1;
        else skipped += 1;
      } catch (err) {
        failed += 1;
        console.error(`[ce ${ce.collectionNo}] Failed:`, err);
      }
    },
  );

  console.log(
    `JP CEs done. downloaded=${downloaded} skipped=${skipped} failed=${failed}`,
  );
}

async function downloadCraftEssencesJsonOnly(
  region: Exclude<Region, "JP">,
): Promise<void> {
  const ces = await fetchCraftEssences(region);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  await runWithConcurrency(
    ces,
    CE_CONCURRENCY,
    CE_DELAY_MS,
    async (ce) => {
      try {
        const result = await writeCraftEssenceJson(region, ce);
        if (result === "downloaded") downloaded += 1;
        else skipped += 1;
      } catch (err) {
        failed += 1;
        console.error(`[${region} ce ${ce.collectionNo}] Failed:`, err);
      }
    },
  );

  console.log(
    `${region} CE JSON done. downloaded=${downloaded} skipped=${skipped} failed=${failed}`,
  );
}

async function fetchCraftEssences(region: Region) {
  console.log(`Fetching ${region} basic craft essence list...`);
  const basicEquips = await fetchBasicCraftEssences(region);
  const ces = basicEquips
    .filter((e) => Number.isInteger(e.collectionNo) && e.collectionNo > 0)
    .sort((a, b) => a.collectionNo - b.collectionNo);
  console.log(`Found ${ces.length} ${region} craft essences.`);
  return ces;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  downloadAllCraftEssences().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
