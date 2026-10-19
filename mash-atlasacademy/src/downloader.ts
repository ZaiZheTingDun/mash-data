import { basename, dirname, join } from "node:path";
import { fetchCraftEssence, fetchServant } from "./api.js";
import {
  downloadFile,
  ensureDir,
  fileExists,
  readJson,
  writeJson,
  writeJsonAtomic,
} from "./fs-utils.js";
import { CES_DIR, SERVANTS_DIR } from "./paths.js";
import { compactServant } from "./compact-servant.js";
import type {
  BasicEquip,
  NiceServant,
  NiceServantAssetGroup,
  Region,
} from "./types.js";

export async function downloadServantAssets(
  servantId: number,
  forceRefreshJson = false,
): Promise<"downloaded" | "skipped"> {
  const label = `servant ${servantId}`;
  const servantDir = join(SERVANTS_DIR, String(servantId));
  const jsonPath = join(servantDir, "servant.json");

  await ensureDir(servantDir);

  const { data, refreshed } = await loadOrFetchServant(
    label,
    "JP",
    servantId,
    jsonPath,
    { forceRefresh: forceRefreshJson },
  );

  let downloadCount = 0;
  if (refreshed) {
    downloadCount += 1;
  }

  downloadCount += await downloadAssetGroup(
    label,
    servantDir,
    "card_servant",
    "commands",
    data.extraAssets?.commands,
  );
  downloadCount += await downloadAssetGroup(
    label,
    servantDir,
    "face_servant",
    "faces",
    data.extraAssets?.faces,
  );
  downloadCount += await downloadAssetGroup(
    label,
    servantDir,
    "narrow_servant",
    "narrowFigure",
    data.extraAssets?.narrowFigure,
  );

  return downloadCount > 0 ? "downloaded" : "skipped";
}

export async function downloadServantJson(
  region: Region,
  servantId: number,
  forceRefresh = false,
): Promise<"downloaded" | "skipped"> {
  const label = `${region} servant ${servantId}`;
  const servantDir = join(SERVANTS_DIR, String(servantId));
  const jsonPath = join(
    servantDir,
    region === "JP" ? "servant.json" : `servant-${region.toLowerCase()}.json`,
  );

  await ensureDir(servantDir);

  const { refreshed } = await loadOrFetchServant(
    label,
    region,
    servantId,
    jsonPath,
    { forceRefresh },
  );
  return refreshed ? "downloaded" : "skipped";
}

export interface LoadServantOptions {
  forceRefresh?: boolean;
  fetcher?: (region: Region, servantId: number) => Promise<NiceServant>;
}

export function rawServantJsonPath(jsonPath: string): string {
  const fileName = basename(jsonPath);
  if (fileName === "servant-cn.json") return join(dirname(jsonPath), "servant-cn-raw.json");
  if (fileName === "servant.json") return join(dirname(jsonPath), "servant-raw.json");
  throw new Error(`Unsupported servant JSON path: ${jsonPath}`);
}

export async function loadOrFetchServant(
  label: string,
  region: Region,
  servantId: number,
  jsonPath: string,
  options: LoadServantOptions = {},
): Promise<{ data: NiceServant; refreshed: boolean }> {
  const rawJsonPath = rawServantJsonPath(jsonPath);

  if (!options.forceRefresh && (await fileExists(rawJsonPath))) {
    try {
      const raw = await readJson<NiceServant>(rawJsonPath);
      if (raw && typeof raw === "object" && "profile" in raw) {
        if (await fileExists(jsonPath)) {
          const cached = await readJson<NiceServant>(jsonPath);
          if (cached && typeof cached === "object" && "profile" in cached) {
            return { data: cached, refreshed: false };
          }
        }

        const compacted = compactServant(raw);
        await writeJsonAtomic(jsonPath, compacted);
        console.log(`[${label}] Rebuilt compact servant JSON from raw cache.`);
        return { data: compacted, refreshed: false };
      }
      console.log(
        `[${label}] Raw servant JSON is missing lore data, refetching...`,
      );
    } catch (err) {
      console.warn(
        `[${label}] Failed to read servant cache, refetching:`,
        err,
      );
    }
  } else if (!(await fileExists(rawJsonPath))) {
    console.log(`[${label}] Fetching servant data...`);
  } else {
    console.log(`[${label}] Data version changed, refetching...`);
  }

  const data = await (options.fetcher ?? fetchServant)(region, servantId);
  const compacted = compactServant(data);
  await writeJsonAtomic(rawJsonPath, data);
  await writeJsonAtomic(jsonPath, compacted);
  console.log(`[${label}] Wrote raw and compact servant JSON.`);
  return { data: compacted, refreshed: true };
}

export interface DownloadServantImagesOptions {
  servantsDir?: string;
  downloader?: (url: string, destPath: string) => Promise<void>;
}

export async function downloadServantImages(
  servantId: number,
  options: DownloadServantImagesOptions = {},
): Promise<number> {
  const label = `servant ${servantId}`;
  const servantDir = join(options.servantsDir ?? SERVANTS_DIR, String(servantId));
  const data = await readJson<NiceServant>(join(servantDir, "servant.json"));
  const downloader = options.downloader ?? downloadFile;

  let downloadCount = 0;
  downloadCount += await downloadAssetGroup(
    label,
    servantDir,
    "card_servant",
    "commands",
    data.extraAssets?.commands,
    downloader,
  );
  downloadCount += await downloadAssetGroup(
    label,
    servantDir,
    "face_servant",
    "faces",
    data.extraAssets?.faces,
    downloader,
  );
  downloadCount += await downloadAssetGroup(
    label,
    servantDir,
    "narrow_servant",
    "narrowFigure",
    data.extraAssets?.narrowFigure,
    downloader,
  );
  return downloadCount;
}

async function downloadAssetGroup(
  label: string,
  servantDir: string,
  filePrefix: string,
  groupName: string,
  group: NiceServantAssetGroup | undefined,
  downloader = downloadFile,
): Promise<number> {
  if (!group) {
    console.warn(`[${label}] No ${groupName} assets found.`);
    return 0;
  }

  const ascensionCount = await downloadAssetMap(
    label,
    servantDir,
    filePrefix,
    `${groupName}.ascension`,
    group.ascension,
    downloader,
  );
  const costumeCount = await downloadAssetMap(
    label,
    servantDir,
    filePrefix,
    `${groupName}.costume`,
    group.costume,
    downloader,
  );
  return ascensionCount + costumeCount;
}

async function downloadAssetMap(
  label: string,
  servantDir: string,
  filePrefix: string,
  groupLabel: string,
  assets: Record<string, string> | undefined,
  downloader: (url: string, destPath: string) => Promise<void>,
): Promise<number> {
  if (!assets || Object.keys(assets).length === 0) {
    return 0;
  }

  const results = await Promise.all(
    Object.entries(assets)
      .filter(([, url]) => typeof url === "string" && url.length > 0)
      .map(async ([key, url]): Promise<number> => {
        const dest = join(servantDir, `${filePrefix}_${key}.png`);
        if (await fileExists(dest)) {
          return 0;
        }
        await downloader(url, dest);
        console.log(
          `[${label}] Downloaded ${groupLabel} ${key} -> ${dest}`,
        );
        return 1;
      }),
  );

  return results.reduce<number>((sum, n) => sum + n, 0);
}

export async function downloadCraftEssenceAssets(
  craftEssenceId: number,
): Promise<"downloaded" | "skipped"> {
  const label = `ce ${craftEssenceId}`;
  console.log(`[${label}] Fetching craft essence data...`);
  const data = await fetchCraftEssence("JP", craftEssenceId);
  return writeCraftEssenceAssets(data);
}

export async function writeCraftEssenceAssets(
  data: BasicEquip,
): Promise<"downloaded" | "skipped"> {
  const label = `ce ${data.collectionNo}`;
  const ceDir = join(CES_DIR, String(data.collectionNo));
  const jsonPath = join(ceDir, "craft-essence.json");
  const imagePath = join(ceDir, "card_ce.png");
  const imageUrl = toEquipFaceUrl(data.face);

  const jsonExists = await fileExists(jsonPath);
  const imageExists = imageUrl ? await fileExists(imagePath) : true;

  if (jsonExists && imageExists) {
    return "skipped";
  }

  await ensureDir(ceDir);

  if (!jsonExists) {
    await writeJson(jsonPath, data);
    console.log(`[${label}] Wrote ${jsonPath}`);
  }

  if (!imageUrl) {
    console.warn(`[${label}] No face URL available, skipping image.`);
    return jsonExists ? "skipped" : "downloaded";
  }

  if (!imageExists) {
    await downloadFile(imageUrl, imagePath);
    console.log(`[${label}] Downloaded face -> ${imagePath}`);
  }

  return "downloaded";
}

export async function writeCraftEssenceJson(
  region: Region,
  data: BasicEquip,
): Promise<"downloaded" | "skipped"> {
  const label = `${region} ce ${data.collectionNo}`;
  const ceDir = join(CES_DIR, String(data.collectionNo));
  const jsonPath = join(
    ceDir,
    region === "JP"
      ? "craft-essence.json"
      : `craft-essence-${region.toLowerCase()}.json`,
  );

  if (await fileExists(jsonPath)) {
    return "skipped";
  }

  await writeJson(jsonPath, data);
  console.log(`[${label}] Wrote ${jsonPath}`);
  return "downloaded";
}

function toEquipFaceUrl(faceUrl: string | undefined): string | undefined {
  if (!faceUrl) return undefined;
  return faceUrl.replace("/Faces/", "/EquipFaces/");
}
