import { readFile } from "node:fs/promises";
import { getServantFilePaths, readServant, sortBySkillIdentity, writePrettyJson } from "./utils.js";
import { classifySkillTargeting, type TargetingMode } from "../../mash-atlasacademy/src/skill-targeting.js";

interface TargetSelectionSkill {
  servantCollectionNo: number;
  skillId: number;
  skillNum: number;
  targetingMode: TargetingMode;
}

interface RawSkill { id: number; functions?: unknown; script?: unknown }

async function readRawSkills(servantFilePath: string): Promise<Map<number, RawSkill>> {
  const rawFilePath = servantFilePath.replace(/servant\.json$/, "servant-raw.json");
  const raw = JSON.parse(await readFile(rawFilePath, "utf8")) as { skills?: RawSkill[] };
  return new Map((raw.skills ?? []).map((skill) => [skill.id, skill]));
}

async function main(): Promise<void> {
  const rows: TargetSelectionSkill[] = [];

  for (const filePath of await getServantFilePaths()) {
    const servant = await readServant(filePath);
    const rawSkills = await readRawSkills(filePath);

    for (const skill of servant.skills ?? []) {
      const targetingMode = classifySkillTargeting(rawSkills.get(skill.id) ?? skill);
      if (targetingMode === "Other") continue;

      const row: TargetSelectionSkill = {
        servantCollectionNo: servant.collectionNo,
        skillId: skill.id,
        skillNum: skill.num,
        targetingMode,
      };
      rows.push(row);
    }
  }

  await writePrettyJson("target-selection-skills.json", sortBySkillIdentity(rows));
}

await main();
