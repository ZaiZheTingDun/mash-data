import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot, writePrettyJson } from "./utils.js";

interface VariantSkill {
  id: number;
  name: string;
  runtime?: true;
}

interface ServantVariant {
  ids: number[];
  skills: Record<"1" | "2" | "3", VariantSkill[]>;
}

interface ServantVariants {
  id: number;
  variants: ServantVariant[];
}

interface SkillSource {
  id: number;
  name: string;
  icon: string;
}

interface RuntimeSkillRow {
  servantCollectionNo: number;
  variantIds: number[];
  skillId: number;
  skillNum: number;
  nameJP: string;
  nameCN: string;
  iconJP: string;
  iconCN: string;
}

interface RuntimeSkillAssignment {
  variantIds: number[];
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function variantOverlap(left: number[], right: number[]): number {
  const rightIds = new Set(right);
  return left.filter((id) => rightIds.has(id)).length;
}

function assignmentIdentity(
  servantCollectionNo: number,
  variantIds: number[],
  skillNum: number,
  skillId: number,
): string {
  return `${servantCollectionNo}:${variantIds.join(",")}:${skillNum}:${skillId}`;
}

function findMatchingRuntimeSkill(
  assignments: RuntimeSkillAssignment[],
  servantCollectionNo: number,
  jpVariantIds: number[],
  skillNum: number,
  skillId: number,
): number | undefined {
  const candidates = assignments
    .map((assignment, index) => ({
      index,
      overlap: variantOverlap(jpVariantIds, assignment.variantIds),
    }))
    .filter((candidate) => candidate.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);

  const best = candidates[0];
  if (!best) {
    return undefined;
  }
  if (candidates[1]?.overlap === best.overlap) {
    throw new Error(
      `CN runtime skill is ambiguous for ${assignmentIdentity(servantCollectionNo, jpVariantIds, skillNum, skillId)}`,
    );
  }
  return best.index;
}

async function main(): Promise<void> {
  const [jpServants, cnServants] = await Promise.all([
    readJson<ServantVariants[]>(path.join(repoRoot, "assets", "servants_variants.json")),
    readJson<ServantVariants[]>(path.join(repoRoot, "assets", "servants_variants_cn.json")),
  ]);

  const cnRuntime = new Map<string, RuntimeSkillAssignment[]>();
  for (const servant of cnServants) {
    for (const variant of servant.variants) {
      for (const skillNum of [1, 2, 3] as const) {
        for (const skill of variant.skills[String(skillNum) as "1" | "2" | "3"]) {
          if (skill.runtime !== true) continue;
          const key = `${servant.id}:${skillNum}:${skill.id}`;
          const assignments = cnRuntime.get(key) ?? [];
          assignments.push({ variantIds: variant.ids });
          cnRuntime.set(key, assignments);
        }
      }
    }
  }

  const rows: RuntimeSkillRow[] = [];
  for (const servant of jpServants) {
    for (const variant of servant.variants) {
      for (const skillNum of [1, 2, 3] as const) {
        const slot = String(skillNum) as "1" | "2" | "3";
        for (const skill of variant.skills[slot]) {
          if (skill.runtime !== true) continue;
          const key = `${servant.id}:${skillNum}:${skill.id}`;
          const assignments = cnRuntime.get(key) ?? [];
          const matchingIndex = findMatchingRuntimeSkill(
            assignments,
            servant.id,
            variant.ids,
            skillNum,
            skill.id,
          );
          // JP and CN publish game content on different schedules. This report
          // includes only runtime skills available in both regions.
          if (matchingIndex === undefined) continue;
          assignments.splice(matchingIndex, 1);
          if (assignments.length === 0) cnRuntime.delete(key);

          const [jpSource, cnSource] = await Promise.all([
            readJson<SkillSource>(
              path.join(repoRoot, "assets", "skills", String(skill.id), "skill.json"),
            ),
            readJson<SkillSource>(
              path.join(repoRoot, "assets", "skills", String(skill.id), "skill_cn.json"),
            ),
          ]);

          rows.push({
            servantCollectionNo: servant.id,
            variantIds: variant.ids,
            skillId: skill.id,
            skillNum,
            nameJP: jpSource.name,
            nameCN: cnSource.name,
            iconJP: jpSource.icon,
            iconCN: cnSource.icon,
          });
          cnRuntime.delete(key);
        }
      }
    }
  }

  rows.sort(
    (a, b) =>
      a.servantCollectionNo - b.servantCollectionNo ||
      Math.min(...a.variantIds) - Math.min(...b.variantIds) ||
      a.skillNum - b.skillNum ||
      a.skillId - b.skillId,
  );
  await writePrettyJson("runtime-skills.json", rows);
}

await main();
