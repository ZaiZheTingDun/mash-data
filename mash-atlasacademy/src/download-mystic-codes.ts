import { requireDataRoot } from "../../shared/data-paths.ts";
import { join } from "node:path";
import { downloadFile, ensureDir, fileExists, writeJson } from "./fs-utils.js";
import { MYSTIC_CODES_DIR } from "./paths.js";
import type { NiceMysticCode, Region } from "./types.js";

const API_BASE = "https://api.atlasacademy.io/export";

async function fetchAllMysticCodes(region: Region): Promise<NiceMysticCode[]> {
  console.log(`Fetching ${region} mystic codes from Atlas Academy...`);
  const res = await fetch(`${API_BASE}/${region}/nice_mystic_code.json`);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${region} mystic codes: HTTP ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as NiceMysticCode[];
}

async function downloadMysticCodeJP(
  mc: NiceMysticCode,
): Promise<"downloaded" | "skipped"> {
  const label = `mystic-code ${mc.id}`;
  const dir = join(MYSTIC_CODES_DIR, String(mc.id));
  const jsonPath = join(dir, "mystic-code.json");
  const imageAssets = [
    {
      filename: "item-male.png",
      url: mc.extraAssets?.item?.male,
    },
    {
      filename: "item-female.png",
      url: mc.extraAssets?.item?.female,
    },
    {
      filename: "master-face-male.png",
      url: mc.extraAssets?.masterFace?.male,
    },
    {
      filename: "master-face-female.png",
      url: mc.extraAssets?.masterFace?.female,
    },
    {
      filename: "master-figure-male.png",
      url: mc.extraAssets?.masterFigure?.male,
    },
    {
      filename: "master-figure-female.png",
      url: mc.extraAssets?.masterFigure?.female,
    },
  ];

  const jsonExists = await fileExists(jsonPath);
  const imageExists = await Promise.all(
    imageAssets.map(({ filename, url }) =>
      url ? fileExists(join(dir, filename)) : Promise.resolve(true),
    ),
  );

  if (jsonExists && imageExists.every(Boolean)) {
    return "skipped";
  }

  await ensureDir(dir);

  let downloadCount = 0;

  if (!jsonExists) {
    await writeJson(jsonPath, mc);
    console.log(`[${label}] Wrote mystic-code.json`);
    downloadCount += 1;
  }

  for (const [index, { filename, url }] of imageAssets.entries()) {
    if (url && !imageExists[index]) {
      await downloadFile(url, join(dir, filename));
      console.log(`[${label}] Downloaded ${filename}`);
      downloadCount += 1;
    }
  }

  return downloadCount > 0 ? "downloaded" : "skipped";
}

async function saveMysticCodeCN(
  mc: NiceMysticCode,
): Promise<"downloaded" | "skipped"> {
  const label = `CN mystic-code ${mc.id}`;
  const dir = join(MYSTIC_CODES_DIR, String(mc.id));
  const jsonPath = join(dir, "mystic-code-cn.json");

  if (await fileExists(jsonPath)) {
    return "skipped";
  }

  await ensureDir(dir);
  await writeJson(jsonPath, mc);
  console.log(`[${label}] Wrote mystic-code-cn.json`);
  return "downloaded";
}

async function downloadAllMysticCodes(): Promise<void> {
  const jpCodes = await fetchAllMysticCodes("JP");
  console.log(`Found ${jpCodes.length} JP mystic codes.`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const mc of jpCodes) {
    try {
      const result = await downloadMysticCodeJP(mc);
      if (result === "downloaded") downloaded += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error(`[mystic-code ${mc.id}] Failed:`, err);
    }
  }

  console.log(
    `JP mystic codes done. downloaded=${downloaded} skipped=${skipped} failed=${failed}`,
  );

  const cnCodes = await fetchAllMysticCodes("CN");
  console.log(`Found ${cnCodes.length} CN mystic codes.`);

  downloaded = 0;
  skipped = 0;
  failed = 0;

  for (const mc of cnCodes) {
    try {
      const result = await saveMysticCodeCN(mc);
      if (result === "downloaded") downloaded += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error(`[CN mystic-code ${mc.id}] Failed:`, err);
    }
  }

  console.log(
    `CN mystic codes done. downloaded=${downloaded} skipped=${skipped} failed=${failed}`,
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  downloadAllMysticCodes().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
