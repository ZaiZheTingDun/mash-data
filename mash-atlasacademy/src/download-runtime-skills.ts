import { requireDataRoot } from "../../shared/data-paths.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fetchSkill } from "./api.js";
import { fileExists, readJson, writeJson } from "./fs-utils.js";
import { SERVANTS_DIR, SKILLS_DIR } from "./paths.js";
import type { Region } from "./types.js";

interface ServantWithSkillRankUp {
  script?: {
    SkillRankUp?: Record<string, number[]>;
  };
}

interface DownloadTarget {
  region: "JP" | "CN";
  servantFile: string;
  skillFile: "skill.json" | "skill_cn.json";
}

const TARGETS: DownloadTarget[] = [
  { region: "JP", servantFile: "servant.json", skillFile: "skill.json" },
  { region: "CN", servantFile: "servant-cn.json", skillFile: "skill_cn.json" },
];

function referencedSkillIds(
  value: Record<string, number[]> | undefined,
): number[] {
  return [
    ...new Set(
      Object.values(value ?? {})
        .flat()
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
}

function skillRankUpMap(value: Record<string, unknown>): Record<string, number[]> {
  const script = value.script;
  if (!script || typeof script !== "object") return {};
  const rankUp = (script as Record<string, unknown>).SkillRankUp;
  if (!rankUp || typeof rankUp !== "object") return {};
  return rankUp as Record<string, number[]>;
}

async function collectRootSkillIds(servantFile: string): Promise<number[]> {
  const entries = await readdir(SERVANTS_DIR, { withFileTypes: true });
  const ids = new Set<number>();

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const path = join(SERVANTS_DIR, entry.name, servantFile);
    if (!(await fileExists(path))) continue;
    const servant = await readJson<ServantWithSkillRankUp>(path);
    for (const id of referencedSkillIds(servant.script?.SkillRankUp)) ids.add(id);
  }

  return [...ids].sort((a, b) => a - b);
}

async function downloadRegion(
  region: Region,
  servantFile: string,
  skillFile: string,
): Promise<number> {
  const pending = await collectRootSkillIds(servantFile);
  const seen = new Set<number>();

  while (pending.length > 0) {
    const skillId = pending.shift();
    if (skillId === undefined || seen.has(skillId)) continue;
    seen.add(skillId);

    const skill = await fetchSkill(region, skillId);
    const id = skill.id;
    const name = skill.name;
    const icon = skill.icon;
    if (
      id !== skillId ||
      typeof name !== "string" ||
      name.length === 0 ||
      typeof icon !== "string" ||
      icon.length === 0
    ) {
      throw new Error(`${region} skill ${skillId}: missing id, name, or icon`);
    }

    await writeJson(
      join(SKILLS_DIR, String(skillId), skillFile),
      skill,
    );

    for (const nestedId of referencedSkillIds(skillRankUpMap(skill))) {
      if (!seen.has(nestedId)) pending.push(nestedId);
    }
    pending.sort((a, b) => a - b);
  }

  return seen.size;
}

export async function downloadRuntimeSkills(): Promise<void> {
  for (const target of TARGETS) {
    const count = await downloadRegion(
      target.region,
      target.servantFile,
      target.skillFile,
    );
    console.log(`${target.region} runtime skills downloaded: ${count}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  downloadRuntimeSkills().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
