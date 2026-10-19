import { requireDataRoot } from "../../shared/data-paths.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileExists, readJson, writeJson } from "./fs-utils.js";
import {
  SERVANTS_DIR,
  SERVANTS_VARIANTS_CN_FILE,
  SERVANTS_VARIANTS_FILE,
  SKILLS_DIR,
} from "./paths.js";
import type {
  ServantVariantSkill,
  ServantVariants,
} from "./build-variants.js";

type SlotKey = "1" | "2" | "3";
type SkillSlots = Record<SlotKey, ServantVariantSkill[]>;

interface ServantWithSkillRankUp {
  script?: {
    SkillRankUp?: Record<string, number[]>;
  };
}

interface RuntimeSkillSource {
  id: number;
  name: string;
  icon: string;
  script?: {
    SkillRankUp?: Record<string, number[]>;
  };
}

interface CombineVariantTarget {
  region: "JP" | "CN";
  servantFile: string;
  skillFile: "skill.json" | "skill_cn.json";
  variantsFile: string;
  outputFile: string;
  label: string;
}

const COMBINE_TARGETS: CombineVariantTarget[] = [
  {
    region: "JP",
    servantFile: "servant.json",
    skillFile: "skill.json",
    variantsFile: "servant_variants.json",
    outputFile: SERVANTS_VARIANTS_FILE,
    label: "JP",
  },
  {
    region: "CN",
    servantFile: "servant-cn.json",
    skillFile: "skill_cn.json",
    variantsFile: "servant_variants_cn.json",
    outputFile: SERVANTS_VARIANTS_CN_FILE,
    label: "CN",
  },
];

function cloneSkills(skills: SkillSlots): SkillSlots {
  return {
    "1": [...skills["1"]],
    "2": [...skills["2"]],
    "3": [...skills["3"]],
  };
}

async function loadRuntimeSkills(
  region: "JP" | "CN",
  skillFile: "skill.json" | "skill_cn.json",
): Promise<Map<number, RuntimeSkillSource>> {
  if (!(await fileExists(SKILLS_DIR))) return new Map();

  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const skills = new Map<number, RuntimeSkillSource>();
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const path = join(SKILLS_DIR, entry.name, skillFile);
    if (!(await fileExists(path))) continue;
    const skill = await readJson<RuntimeSkillSource>(path);
    const expectedId = Number(entry.name);
    if (
      skill.id !== expectedId ||
      typeof skill.name !== "string" ||
      skill.name.length === 0 ||
      typeof skill.icon !== "string" ||
      skill.icon.length === 0
    ) {
      throw new Error(`${region} runtime skill ${expectedId}: invalid metadata`);
    }
    skills.set(skill.id, skill);
  }
  return skills;
}

function addRuntimeSkillForms(
  servant: ServantVariants,
  rankUpMap: Record<string, number[]>,
  dependencies: Map<number, RuntimeSkillSource>,
): ServantVariants {
  const referencedIds = new Set(Object.values(rankUpMap).flat());
  const assignedIds = new Set<number>();

  const variants = servant.variants.map((variant) => {
    const skills = cloneSkills(variant.skills);

    for (const slot of ["1", "2", "3"] as const) {
      const seen = new Set(skills[slot].map((skill) => skill.id));
      const pending = variant.skills[slot].flatMap(
        (skill) => rankUpMap[String(skill.id)] ?? [],
      );

      while (pending.length > 0) {
        const id = pending.shift();
        if (id === undefined) continue;
        if (seen.has(id)) {
          assignedIds.add(id);
          continue;
        }
        const dependency = dependencies.get(id);
        if (!dependency) {
          throw new Error(`servant ${servant.id}: missing SkillRankUp skill ${id}`);
        }
        seen.add(id);
        assignedIds.add(id);
        skills[slot].push({
          id: dependency.id,
          name: dependency.name,
          runtime: true,
        });
        pending.push(
          ...Object.values(dependency.script?.SkillRankUp ?? {}).flat(),
        );
      }
    }

    return { ...variant, skills };
  });

  const unassigned = [...referencedIds].filter((id) => !assignedIds.has(id));
  if (unassigned.length > 0) {
    throw new Error(
      `servant ${servant.id}: SkillRankUp skills have no matching static variant: ${unassigned.join(", ")}`,
    );
  }

  return { id: servant.id, variants };
}

export async function combineServantVariants(): Promise<void> {
  const entries = await readdir(SERVANTS_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => /^\d+$/.test(n))
    .sort((a, b) => Number(a) - Number(b));

  for (const target of COMBINE_TARGETS) {
    const servants: ServantVariants[] = [];
    const dependencies = await loadRuntimeSkills(
      target.region,
      target.skillFile,
    );
    let skipped = 0;
    let failed = 0;

    for (const dir of dirs) {
      const variantsPath = join(SERVANTS_DIR, dir, target.variantsFile);
      const servantPath = join(SERVANTS_DIR, dir, target.servantFile);
      if (!(await fileExists(variantsPath))) {
        skipped += 1;
        continue;
      }

      try {
        const [variants, servant] = await Promise.all([
          readJson<ServantVariants>(variantsPath),
          readJson<ServantWithSkillRankUp>(servantPath),
        ]);
        servants.push(
          addRuntimeSkillForms(
            variants,
            servant.script?.SkillRankUp ?? {},
            dependencies,
          ),
        );
      } catch (err) {
        failed += 1;
        console.error(
          `[${target.label} servant ${dir}] Failed to read variants JSON:`,
          err,
        );
      }
    }

    if (failed > 0) {
      throw new Error(`${target.label}: failed to combine ${failed} servants`);
    }

    servants.sort((a, b) => a.id - b.id);
    await writeJson(target.outputFile, servants);

    console.log(
      `Combined ${target.label} servant variants. written=${servants.length} skipped=${skipped} failed=${failed} output=${target.outputFile}`,
    );
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  combineServantVariants().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
