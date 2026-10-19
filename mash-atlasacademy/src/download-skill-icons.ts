import { requireDataRoot } from "../../shared/data-paths.ts";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { runWithConcurrency } from "./concurrency.js";
import { downloadFile, fileExists, readJson } from "./fs-utils.js";
import { ICONS_DIR, MYSTIC_CODES_DIR, SERVANTS_DIR, SKILLS_DIR } from "./paths.js";

const ICON_CONCURRENCY = 3;
const ICON_DELAY_MS = 200;

// Mash renders all five append skills, even though compact servant data omits
// appendPassive and these icons may never occur in active skill data.
const APPEND_ICON_URLS = [
  "skill_00301.png",
  "skill_00601.png",
  "skill_00300.png",
  "skill_00303.png",
  "skill_00613.png",
].map(filename => `https://static.atlasacademy.io/JP/SkillIcons/${filename}`);

interface WithSkills {
  icon?: string;
  skills?: Array<{ icon?: string; [key: string]: unknown }>;
}

async function collectIconUrlsFromDir(
  dir: string,
  filename: string,
): Promise<string[]> {
  let subdirs: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    subdirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, String(e.name)));
  } catch {
    return [];
  }

  const urlSet = new Set<string>();

  await Promise.all(
    subdirs.map(async (subdir: string) => {
      const jsonPath = join(subdir, filename);
      if (!(await fileExists(jsonPath))) return;

      try {
        const data = await readJson<WithSkills>(jsonPath);
        if (typeof data.icon === "string" && data.icon.length > 0) urlSet.add(data.icon);
        for (const skill of data.skills ?? []) {
          if (typeof skill.icon === "string" && skill.icon.length > 0) {
            urlSet.add(skill.icon);
          }
        }
      } catch (err) {
        throw new Error(`[skill-icons] Failed to read ${jsonPath}`, { cause: err });
      }
    }),
  );

  return Array.from(urlSet);
}

export async function collectAllSkillIconUrls(
  servantsDir = SERVANTS_DIR,
  mysticCodesDir = MYSTIC_CODES_DIR,
  skillsDir = SKILLS_DIR,
): Promise<string[]> {
  const groups = await Promise.all([
    collectIconUrlsFromDir(servantsDir, "servant.json"),
    collectIconUrlsFromDir(servantsDir, "servant-cn.json"),
    collectIconUrlsFromDir(mysticCodesDir, "mystic-code.json"),
    collectIconUrlsFromDir(mysticCodesDir, "mystic-code-cn.json"),
    collectIconUrlsFromDir(skillsDir, "skill.json"),
    collectIconUrlsFromDir(skillsDir, "skill_cn.json"),
  ]);

  const merged = new Set([...APPEND_ICON_URLS, ...groups.flat()]);
  return Array.from(merged).sort();
}

async function downloadSkillIcons(): Promise<void> {
  console.log("Scanning servant and mystic code JSON files for skill icons...");
  const urls = await collectAllSkillIconUrls();
  console.log(`Found ${urls.length} unique skill icon URLs.`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  await runWithConcurrency(
    urls,
    ICON_CONCURRENCY,
    ICON_DELAY_MS,
    async (url) => {
      const filename = basename(new URL(url).pathname);
      const destPath = join(ICONS_DIR, filename);

      if (await fileExists(destPath)) {
        skipped += 1;
        return;
      }

      try {
        await downloadFile(url, destPath);
        console.log(`[skill-icons] Downloaded ${filename}`);
        downloaded += 1;
      } catch (err) {
        failed += 1;
        console.error(`[skill-icons] Failed to download ${url}:`, err);
      }
    },
  );

  console.log(
    `Skill icons done. downloaded=${downloaded} skipped=${skipped} failed=${failed}`,
  );
  if (failed > 0) throw new Error(`${failed} skill icon downloads failed`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  downloadSkillIcons().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
