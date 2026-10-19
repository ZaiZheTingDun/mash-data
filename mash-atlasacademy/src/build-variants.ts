import { requireDataRoot } from "../../shared/data-paths.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileExists, readJson, writeJson } from "./fs-utils.js";
import { SERVANTS_DIR } from "./paths.js";
import type { NiceServant } from "./types.js";
import type { TargetingMode } from "./skill-targeting.js";

export type ServantVariantSkill = {
  id: number;
  name: string;
  runtime?: true;
  targetingMode?: Exclude<TargetingMode, "Other">;
};
export type ServantVariant = {
  ids: number[];
  noblePhantasms: string[];
  skills: Record<"1" | "2" | "3", ServantVariantSkill[]>;
};
export type ServantVariants = { id: number; variants: ServantVariant[] };

interface ReleaseCondition {
  condType?: string;
  condTargetId?: number;
  condNum?: number;
}

interface RawSkillSvt {
  releaseConditions?: ReleaseCondition[];
}

interface RawSkill {
  id: number;
  num: number;
  name: string;
  detail?: string;
  skillSvts?: RawSkillSvt[];
  targetingMode?: TargetingMode;
}

interface RawNpSvt {
  releaseConditions?: ReleaseCondition[];
}

interface RawNp {
  id: number;
  num: number;
  name: string;
  npSvts?: RawNpSvt[];
  script?: {
    tdTypeChangeIDs?: number[];
    tdChangeByBattlePoint?: {
      battlePointId: number;
      phase: number;
      noblePhantasmId: number;
    }[];
  };
}

interface RawServant extends NiceServant {
  collectionNo: number;
  extraAssets?: NiceServant["extraAssets"] & {
    charaGraph?: {
      ascension?: Record<string, string>;
      costume?: Record<string, string>;
    };
  };
  skills?: RawSkill[];
  noblePhantasms?: RawNp[];
  ascensionAdd?: {
    overWriteTDName?: {
      ascension?: Record<string, string>;
      costume?: Record<string, string>;
    };
  };
}

const SLOT_KEYS = ["1", "2", "3"] as const;
type SlotKey = (typeof SLOT_KEYS)[number];

function emptySlots(): Record<SlotKey, ServantVariantSkill[]> {
  return { "1": [], "2": [], "3": [] };
}

function variantSkill(skill: RawSkill): ServantVariantSkill {
  const result: ServantVariantSkill = { id: skill.id, name: skill.name };
  if (skill.targetingMode && skill.targetingMode !== "Other") {
    result.targetingMode = skill.targetingMode;
  }
  return result;
}

function collectEquipReqs(
  releaseConditionLists: (ReleaseCondition[] | undefined)[],
): Set<number> {
  const out = new Set<number>();
  for (const list of releaseConditionLists) {
    if (!list) continue;
    for (const cond of list) {
      if (cond.condType === "equipWithTargetCostume" && typeof cond.condNum === "number") {
        out.add(cond.condNum);
      }
    }
  }
  return out;
}

function resolveRequirementIds(
  requirementIds: Iterable<number>,
  costumeIdToBattleCharaId: Map<number, number>,
  ascensionKeys: number[],
  ascensionRequirementIds: Set<number>,
): Set<number> {
  const out = new Set<number>();

  for (const requirementId of requirementIds) {
    const battleCharaId = costumeIdToBattleCharaId.get(requirementId);
    if (battleCharaId !== undefined) {
      out.add(battleCharaId);
      continue;
    }

    if (!ascensionRequirementIds.has(requirementId)) continue;
    for (const ascensionId of ascensionKeys) {
      const battleFormId = Math.min(ascensionId, 3);
      if (battleFormId === requirementId) out.add(ascensionId);
    }
  }

  return out;
}

function intersects(a: Set<number>, b: Set<number>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function ascensionVariantId(limitCount: number): number | undefined {
  if (limitCount === 0) return 1;
  if (limitCount === 1 || limitCount === 2) return 2;
  if (limitCount === 3 || limitCount === 4) return limitCount;
  return undefined;
}

function visibleNpNameOverrides(
  data: RawServant,
  costumeIdToBattleCharaId: Map<number, number>,
): Map<string, Set<number>> {
  const names = data.ascensionAdd?.overWriteTDName;
  const result = new Map<string, Set<number>>();

  const add = (name: string, formId: number | undefined): void => {
    const normalizedName = name.trim();
    if (!normalizedName || formId === undefined) return;
    const ids = result.get(normalizedName) ?? new Set<number>();
    ids.add(formId);
    result.set(normalizedName, ids);
  };

  for (const [limitCountText, name] of Object.entries(names?.ascension ?? {})) {
    add(name, ascensionVariantId(Number(limitCountText)));
  }
  for (const [limitCountText, name] of Object.entries(names?.costume ?? {})) {
    add(name, costumeIdToBattleCharaId.get(Number(limitCountText)));
  }

  return result;
}

function appendVisibleNpNameOverrides(
  names: string[],
  seenNames: Set<string>,
  variantIds: number[],
  overrides: Map<string, Set<number>>,
): void {
  const variantIdSet = new Set(variantIds);
  for (const [name, formIds] of overrides) {
    if (!intersects(variantIdSet, formIds) || seenNames.has(name)) continue;
    seenNames.add(name);
    names.push(name);
  }
}

function dedupePush<T>(items: T[], keySet: Set<string>, key: string, value: T): void {
  if (keySet.has(key)) return;
  keySet.add(key);
  items.push(value);
}

class UnionFind {
  private parent = new Map<number, number>();

  add(x: number): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  find(x: number): number {
    let cur = x;
    while (this.parent.get(cur) !== cur) {
      const p = this.parent.get(cur)!;
      const gp = this.parent.get(p)!;
      this.parent.set(cur, gp);
      cur = gp;
    }
    return cur;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function buildServantVariants(data: RawServant): ServantVariants {
  const collectionNo = data.collectionNo;

  const ascensionKeys = Object.keys(data.extraAssets?.charaGraph?.ascension ?? {})
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  const costumeBattleCharaIds = Object.keys(data.extraAssets?.charaGraph?.costume ?? {})
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);

  const costumeIdToBattleCharaId = new Map<number, number>();
  for (const [battleCharaIdStr, costume] of Object.entries(data.profile?.costume ?? {})) {
    const battleCharaId = Number(battleCharaIdStr);
    if (!Number.isInteger(battleCharaId)) continue;
    if (costume && typeof costume.id === "number") {
      costumeIdToBattleCharaId.set(costume.id, battleCharaId);
    }
  }
  const npNameOverrides = visibleNpNameOverrides(data, costumeIdToBattleCharaId);

  const skills = (data.skills ?? []).filter((s) =>
    SLOT_KEYS.includes(String(s.num) as SlotKey),
  );
  const nps = data.noblePhantasms ?? [];
  const npById = new Map(nps.map((np) => [np.id, np]));
  const ascensionRequirementIds = new Set<number>();

  const collectRequirements = (
    releaseConditionLists: (ReleaseCondition[] | undefined)[],
  ): Set<number> => {
    for (const list of releaseConditionLists) {
      for (const cond of list ?? []) {
        if (
          cond.condType === "equipWithTargetCostume" &&
          cond.condTargetId === data.id &&
          typeof cond.condNum === "number" &&
          !costumeIdToBattleCharaId.has(cond.condNum) &&
          ascensionKeys.some(
            (ascensionId) => Math.min(ascensionId, 3) === cond.condNum,
          )
        ) {
          ascensionRequirementIds.add(cond.condNum);
        }
      }
    }
    return collectEquipReqs(releaseConditionLists);
  };

  const skillReqs = new Map<number, Set<number>>();
  for (const skill of skills) {
    skillReqs.set(
      skill.id,
      collectRequirements((skill.skillSvts ?? []).map((s) => s.releaseConditions)),
    );
  }

  const npOwnReqs = new Map<number, Set<number>>();
  for (const np of nps) {
    npOwnReqs.set(
      np.id,
      collectRequirements((np.npSvts ?? []).map((s) => s.releaseConditions)),
    );
  }
  const npFinalReqs = new Map<number, Set<number>>();
  for (const np of nps) {
    const merged = new Set(npOwnReqs.get(np.id) ?? []);
    for (const otherId of np.script?.tdTypeChangeIDs ?? []) {
      if (otherId === np.id) continue;
      const other = npOwnReqs.get(otherId);
      if (other && other.size > 0) {
        for (const r of other) merged.add(r);
      }
    }
    npFinalReqs.set(np.id, merged);
  }

  const dynamicNpIds = new Set<number>();
  for (const np of nps) {
    const ids = np.script?.tdTypeChangeIDs;
    if (!ids || ids.length === 0) continue;
    const uniqueIds = [...new Set(ids)].filter((id) => npById.has(id));
    if (uniqueIds.length === 0) continue;

    const allNoCostumeReqs = uniqueIds.every((id) => {
      const reqs = npOwnReqs.get(id);
      return !reqs || reqs.size === 0;
    });

    for (const id of uniqueIds) {
      const target = npById.get(id);
      const ownReqs = npOwnReqs.get(id);
      const finalReqs = npFinalReqs.get(id);
      if (!target) continue;
      if (allNoCostumeReqs && target.num >= 90) dynamicNpIds.add(id);
      if (
        !allNoCostumeReqs &&
        (!ownReqs || ownReqs.size === 0) &&
        finalReqs &&
        finalReqs.size > 0
      ) {
        dynamicNpIds.add(id);
      }
    }
  }

  for (const np of nps) {
    for (const change of np.script?.tdChangeByBattlePoint ?? []) {
      if (npById.has(change.noblePhantasmId)) {
        dynamicNpIds.add(change.noblePhantasmId);
      }
    }
  }

  const uf = new UnionFind();
  const overrideReqSets: Set<number>[] = [];
  for (const reqs of skillReqs.values()) {
    if (reqs.size > 0) overrideReqSets.push(reqs);
  }
  for (const reqs of npFinalReqs.values()) {
    if (reqs.size > 0) overrideReqSets.push(reqs);
  }
  for (const reqs of overrideReqSets) {
    const arr = [...reqs];
    for (const x of arr) uf.add(x);
    const first = arr[0];
    if (first === undefined) continue;
    for (let i = 1; i < arr.length; i++) {
      const next = arr[i];
      if (next === undefined) continue;
      uf.union(first, next);
    }
  }

  const components = new Map<number, Set<number>>();
  for (const reqs of overrideReqSets) {
    for (const cid of reqs) {
      const root = uf.find(cid);
      if (!components.has(root)) components.set(root, new Set());
      components.get(root)!.add(cid);
    }
  }

  const overridingFormIds = new Set<number>();
  for (const comp of components.values()) {
    for (const id of resolveRequirementIds(
      comp,
      costumeIdToBattleCharaId,
      ascensionKeys,
      ascensionRequirementIds,
    )) {
      overridingFormIds.add(id);
    }
  }

  const variants: ServantVariant[] = [];

  const defaultIds = [
    ...ascensionKeys.filter((id) => !overridingFormIds.has(id)),
    ...costumeBattleCharaIds.filter((id) => !overridingFormIds.has(id)),
  ];
  if (defaultIds.length > 0) {
    const slots = emptySlots();
    const seenSkill = new Set<number>();
    for (const skill of skills) {
      const reqs = skillReqs.get(skill.id);
      if (reqs && reqs.size > 0) continue;
      if (seenSkill.has(skill.id)) continue;
      seenSkill.add(skill.id);
      slots[String(skill.num) as SlotKey].push(variantSkill(skill));
    }
    const npNames: string[] = [];
    const seenNp = new Set<string>();
    for (const np of nps) {
      if (dynamicNpIds.has(np.id)) continue;
      const reqs = npFinalReqs.get(np.id);
      if (reqs && reqs.size > 0) continue;
      if (seenNp.has(np.name)) continue;
      seenNp.add(np.name);
      npNames.push(np.name);
    }
    appendVisibleNpNameOverrides(npNames, seenNp, defaultIds, npNameOverrides);
    variants.push({ ids: defaultIds, noblePhantasms: npNames, skills: slots });
  }

  const orderedComponents = [...components.values()].sort((a, b) => {
    const minA = Math.min(
      ...resolveRequirementIds(
        a,
        costumeIdToBattleCharaId,
        ascensionKeys,
        ascensionRequirementIds,
      ),
    );
    const minB = Math.min(
      ...resolveRequirementIds(
        b,
        costumeIdToBattleCharaId,
        ascensionKeys,
        ascensionRequirementIds,
      ),
    );
    return minA - minB;
  });

  for (const comp of orderedComponents) {
    const ids = [
      ...resolveRequirementIds(
        comp,
        costumeIdToBattleCharaId,
        ascensionKeys,
        ascensionRequirementIds,
      ),
    ].sort((a, b) => a - b);

    const slots = emptySlots();
    const seenSkill = new Set<number>();
    for (const skill of skills) {
      const reqs = skillReqs.get(skill.id);
      if (!reqs || reqs.size === 0) continue;
      if (!intersects(reqs, comp)) continue;
      if (seenSkill.has(skill.id)) continue;
      seenSkill.add(skill.id);
      slots[String(skill.num) as SlotKey].push(variantSkill(skill));
    }
    const npNames: string[] = [];
    const seenNp = new Set<string>();
    for (const np of nps) {
      if (dynamicNpIds.has(np.id)) continue;
      const reqs = npFinalReqs.get(np.id);
      if (!reqs || reqs.size === 0) continue;
      if (!intersects(reqs, comp)) continue;
      if (seenNp.has(np.name)) continue;
      seenNp.add(np.name);
      npNames.push(np.name);
    }
    appendVisibleNpNameOverrides(npNames, seenNp, ids, npNameOverrides);
    variants.push({ ids, noblePhantasms: npNames, skills: slots });
  }

  return { id: collectionNo, variants };
}

interface BuildVariantTarget {
  servantFile: string;
  variantsFile: string;
  label: string;
}

const BUILD_TARGETS: BuildVariantTarget[] = [
  {
    servantFile: "servant.json",
    variantsFile: "servant_variants.json",
    label: "JP",
  },
  {
    servantFile: "servant-cn.json",
    variantsFile: "servant_variants_cn.json",
    label: "CN",
  },
];

export async function buildAllServantVariants(): Promise<void> {
  const entries = await readdir(SERVANTS_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => /^\d+$/.test(n))
    .sort((a, b) => Number(a) - Number(b));

  for (const target of BUILD_TARGETS) {
    let written = 0;
    let skipped = 0;
    let failed = 0;

    for (const dir of dirs) {
      const jsonPath = join(SERVANTS_DIR, dir, target.servantFile);
      const outPath = join(SERVANTS_DIR, dir, target.variantsFile);
      if (!(await fileExists(jsonPath))) {
        skipped += 1;
        continue;
      }
      try {
        const data = await readJson<RawServant>(jsonPath);
        const variants = buildServantVariants(data);
        await writeJson(outPath, variants);
        written += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `[${target.label} servant ${dir}] Failed to build variants:`,
          err,
        );
      }
    }

    console.log(
      `${target.label} variants build done. written=${written} skipped=${skipped} failed=${failed}`,
    );
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  buildAllServantVariants().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
