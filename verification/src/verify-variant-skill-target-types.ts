import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot, writePrettyJson } from "./utils.js";

type SlotKey = "1" | "2" | "3";

interface VariantSkill {
  id: number;
  runtime?: true;
}

interface ServantVariant {
  ids: number[];
  skills: Record<SlotKey, VariantSkill[]>;
}

interface ServantVariants {
  id: number;
  variants: ServantVariant[];
}

interface SkillFunction {
  funcTargetType?: string;
}

interface SkillSource {
  id: number;
  functions?: SkillFunction[];
}

interface ServantSource {
  skills?: SkillSource[];
}

interface VariantTargetMismatch {
  id: number;
  variants: {
    ids: number[];
    skills: Partial<Record<SlotKey, string[]>>;
  };
}

const SLOT_KEYS: SlotKey[] = ["1", "2", "3"];
const SELECTABLE_TARGET_TYPES = new Set(["ptOne", "ptOneOther"]);

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function getTargetTypes(skill: SkillSource): string[] {
  return [
    ...new Set(
      (skill.functions ?? [])
        .map((func) => func.funcTargetType)
        .filter((targetType): targetType is string => typeof targetType === "string"),
    ),
  ];
}

function requiresTargetSelection(targetTypes: string[]): boolean {
  return targetTypes.some((targetType) => SELECTABLE_TARGET_TYPES.has(targetType));
}

async function loadSkillSource(
  servantId: number,
  skill: VariantSkill,
  staticSkills: Map<number, SkillSource>,
): Promise<SkillSource> {
  if (skill.runtime === true) {
    return readJson<SkillSource>(
      path.join(repoRoot, "assets", "skills", String(skill.id), "skill.json"),
    );
  }

  const source = staticSkills.get(skill.id);
  if (!source) {
    throw new Error(`Servant ${servantId} skill ${skill.id} is missing from servant.json`);
  }
  return source;
}

async function main(): Promise<void> {
  const variants = await readJson<ServantVariants[]>(
    path.join(repoRoot, "resources", "servants_variants.json"),
  );
  const rows: VariantTargetMismatch[] = [];

  for (const servant of variants) {
    const servantSource = await readJson<ServantSource>(
      path.join(
        repoRoot,
        "assets",
        "servants",
        String(servant.id),
        "servant.json",
      ),
    );
    const staticSkills = new Map(
      (servantSource.skills ?? []).map((skill) => [skill.id, skill]),
    );

    for (const variant of servant.variants) {
      const mismatchedSkills: Partial<Record<SlotKey, string[]>> = {};

      for (const slot of SLOT_KEYS) {
        const variantSkills = variant.skills[slot] ?? [];
        if (variantSkills.length < 2) continue;

        const targetTypesBySkill = await Promise.all(
          variantSkills.map(async (skill) =>
            getTargetTypes(
              await loadSkillSource(servant.id, skill, staticSkills),
            ),
          ),
        );
        const selectionModes = new Set(
          targetTypesBySkill.map(requiresTargetSelection),
        );
        if (selectionModes.size < 2) continue;

        mismatchedSkills[slot] = [
          ...new Set(targetTypesBySkill.flat()),
        ];
      }

      if (Object.keys(mismatchedSkills).length === 0) continue;
      rows.push({
        id: servant.id,
        variants: {
          ids: variant.ids,
          skills: mismatchedSkills,
        },
      });
    }
  }

  await writePrettyJson("variant-skill-target-types.json", rows);
}

await main();
