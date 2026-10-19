import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { requireDataRoot } from "../../shared/data-paths.ts";

type SlotKey = "1" | "2" | "3";

interface SkillMetadata {
  id: number;
  name: string;
  icon: string;
  script?: {
    SkillRankUp?: Record<string, number[]>;
  };
}

interface SourceServant {
  skills?: SkillMetadata[];
  script?: {
    SkillRankUp?: Record<string, number[]>;
  };
}

interface VariantSkill {
  id: number;
  name: string;
  runtime?: true;
}

interface ServantVariant {
  ids: number[];
  skills: Record<SlotKey, VariantSkill[]>;
  rules?: unknown;
}

interface ServantVariants {
  id: number;
  variants: ServantVariant[];
}

interface RegionTarget {
  region: "JP" | "CN";
  variantsFile: string;
  servantFile: string;
  skillFile: "skill.json" | "skill_cn.json";
}

const repoRoot = requireDataRoot();
const slotKeys: SlotKey[] = ["1", "2", "3"];
const targets: RegionTarget[] = [
  {
    region: "JP",
    variantsFile: "assets/servants_variants.json",
    servantFile: "servant.json",
    skillFile: "skill.json",
  },
  {
    region: "CN",
    variantsFile: "assets/servants_variants_cn.json",
    servantFile: "servant-cn.json",
    skillFile: "skill_cn.json",
  },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJson<T>(relativePath: string, context: string): Promise<T> {
  try {
    return JSON.parse(
      await readFile(path.resolve(repoRoot, relativePath), "utf8"),
    ) as T;
  } catch (error) {
    assert.fail(`${context}: cannot read ${relativePath}: ${errorMessage(error)}`);
  }
}

function assertSkillMetadata(
  skill: SkillMetadata | undefined,
  expectedId: number,
  context: string,
): asserts skill is SkillMetadata {
  assert.equal(skill?.id, expectedId, `${context}: id mismatch`);
  assert.equal(typeof skill.name, "string", `${context}: name must be a string`);
  assert.ok(skill.name.length > 0, `${context}: name is empty`);
  assert.equal(typeof skill.icon, "string", `${context}: icon must be a string`);
  assert.ok(skill.icon.length > 0, `${context}: icon is empty`);
}

function skillRankUpIds(skill: SkillMetadata, context: string): number[] {
  const rankUp = skill.script?.SkillRankUp;
  if (rankUp === undefined) return [];

  const ids: number[] = [];
  for (const [sourceId, values] of Object.entries(rankUp)) {
    assert.ok(
      Array.isArray(values),
      `${context}: SkillRankUp[${sourceId}] must be an array`,
    );
    for (const id of values) {
      assert.ok(
        Number.isInteger(id) && id > 0,
        `${context}: invalid referenced skill id ${id}`,
      );
      ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function assignmentKey(
  servantId: number,
  variantIds: number[],
  slot: SlotKey,
  skillId: number,
): string {
  return `${servantId}:${variantIds.join(",")}:${slot}:${skillId}`;
}

async function validateRegion(target: RegionTarget): Promise<void> {
  const variants = await readJson<ServantVariants[]>(
    target.variantsFile,
    target.region,
  );
  assert.ok(Array.isArray(variants), `${target.region}: variants must be an array`);

  const runtimeCache = new Map<number, SkillMetadata>();
  const loadRuntimeSkill = async (
    skillId: number,
    context: string,
  ): Promise<SkillMetadata> => {
    const cached = runtimeCache.get(skillId);
    if (cached) return cached;

    const relativePath = `assets/skills/${skillId}/${target.skillFile}`;
    const skill = await readJson<SkillMetadata>(relativePath, context);
    assertSkillMetadata(skill, skillId, context);
    runtimeCache.set(skillId, skill);
    return skill;
  };

  const actualRuntimeAssignments = new Set<string>();
  const expectedRuntimeAssignments = new Set<string>();

  for (const servantVariants of variants) {
    const servantId = servantVariants.id;
    const servant = await readJson<SourceServant>(
      `assets/servants/${servantId}/${target.servantFile}`,
      `${target.region} servant ${servantId}`,
    );
    const staticSkills = new Map<number, SkillMetadata>();
    for (const skill of servant.skills ?? []) {
      const context = `${target.region} servant ${servantId} source skill ${skill.id}`;
      assertSkillMetadata(skill, skill.id, context);
      staticSkills.set(skill.id, skill);
    }

    for (const variant of servantVariants.variants ?? []) {
      const variantContext = `${target.region} servant ${servantId} variant [${variant.ids?.join(", ")}]`;
      assert.ok(!Object.hasOwn(variant, "rules"), `${variantContext}: rules is not allowed`);
      assert.ok(
        Array.isArray(variant.ids) && variant.ids.length > 0,
        `${variantContext}: ids is empty`,
      );

      for (const slot of slotKeys) {
        const skills = variant.skills?.[slot];
        assert.ok(
          Array.isArray(skills),
          `${variantContext} slot ${slot}: skills must be an array`,
        );

        for (const skill of skills) {
          const context = `${variantContext} slot ${slot} skill ${skill.id}`;
          assert.ok(
            skill.runtime === undefined || skill.runtime === true,
            `${context}: runtime must be true or omitted`,
          );

          if (skill.runtime === true) {
            const source = await loadRuntimeSkill(skill.id, context);
            assert.equal(
              skill.name,
              source.name,
              `${context}: name differs from downloaded skill`,
            );
            actualRuntimeAssignments.add(
              assignmentKey(servantId, variant.ids, slot, skill.id),
            );
          } else {
            const source = staticSkills.get(skill.id);
            assert.ok(
              source,
              `${context}: not found in ${target.servantFile} skills[]`,
            );
            assert.equal(
              skill.name,
              source.name,
              `${context}: name differs from servant skill`,
            );
          }
        }
      }
    }

    const rankUpMap = servant.script?.SkillRankUp ?? {};
    for (const [baseIdText, directIds] of Object.entries(rankUpMap)) {
      assert.ok(
        Array.isArray(directIds),
        `${target.region} servant ${servantId}: SkillRankUp[${baseIdText}] must be an array`,
      );
      if (directIds.length === 0) continue;

      const baseId = Number(baseIdText);
      const baseOccurrences: Array<{ variantIds: number[]; slot: SlotKey }> = [];
      for (const variant of servantVariants.variants ?? []) {
        for (const slot of slotKeys) {
          if (
            variant.skills?.[slot]?.some(
              (skill) => skill.id === baseId && skill.runtime !== true,
            )
          ) {
            baseOccurrences.push({ variantIds: variant.ids, slot });
          }
        }
      }
      assert.ok(
        baseOccurrences.length > 0,
        `${target.region} servant ${servantId}: base skill ${baseId} has no variant assignment`,
      );

      const pending = [...new Set(directIds)];
      const runtimeIds = new Set<number>();
      while (pending.length > 0) {
        const skillId = pending.shift();
        if (skillId === undefined || runtimeIds.has(skillId)) continue;
        runtimeIds.add(skillId);
        const context = `${target.region} servant ${servantId} runtime skill ${skillId}`;
        const skill = await loadRuntimeSkill(skillId, context);
        pending.push(...skillRankUpIds(skill, context));
      }

      for (const occurrence of baseOccurrences) {
        for (const skillId of runtimeIds) {
          expectedRuntimeAssignments.add(
            assignmentKey(
              servantId,
              occurrence.variantIds,
              occurrence.slot,
              skillId,
            ),
          );
        }
      }
    }
  }

  assert.deepEqual(
    [...actualRuntimeAssignments].sort(),
    [...expectedRuntimeAssignments].sort(),
    `${target.region}: runtime skill assignments are incomplete or unexpected`,
  );
}

for (const target of targets) {
  test(`${target.region} servant variants skill integrity`, async () => {
    await validateRegion(target);
  });
}
