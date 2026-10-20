import { requireDataRoot } from "../../shared/data-paths.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileExists, readJson, writeJson } from "./fs-utils.js";
import { SERVANTS_DIR } from "./paths.js";
import type { NiceServant, ServantTrait, ServantTraitAddition, ServantTraitOverrides } from "./types.js";
import { classifySkillTargeting } from "./skill-targeting.js";

type JsonRecord = Record<string, unknown>;

const ROOT_FIELDS = [
  "id",
  "collectionNo",
  "name",
  "originalName",
  "ruby",
  "classId",
  "className",
  "type",
  "rarity",
  "attribute",
  "gender",
] as const;

const COSTUME_FIELDS = [
  "id",
  "costumeCollectionNo",
  "battleCharaId",
  "shortName",
  "name",
] as const;

const RELEASE_CONDITION_FIELDS = ["condType", "condTargetId", "condNum"] as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pick(source: JsonRecord, fields: readonly string[]): JsonRecord {
  const result: JsonRecord = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field)) result[field] = source[field];
  }
  return result;
}

function compactAssetGroup(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  return pick(value, ["ascension", "costume"]);
}

function compactExtraAssets(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const result: JsonRecord = {};
  for (const field of ["commands", "faces", "narrowFigure", "charaGraph"]) {
    const group = compactAssetGroup(value[field]);
    if (group) result[field] = group;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function compactProfile(value: unknown): JsonRecord {
  if (!isRecord(value) || !isRecord(value.costume)) return {};
  const costume: JsonRecord = {};
  for (const [battleCharaId, rawCostume] of Object.entries(value.costume)) {
    if (isRecord(rawCostume)) costume[battleCharaId] = pick(rawCostume, COSTUME_FIELDS);
  }
  return { costume };
}

function compactReleaseConditions(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((condition) => pick(condition, RELEASE_CONDITION_FIELDS));
}

function compactSkillSvts(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((svt) => {
    const releaseConditions = compactReleaseConditions(svt.releaseConditions);
    return releaseConditions ? { releaseConditions } : {};
  });
}

function compactFunctions(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((func) => {
    const result = pick(func, ["funcId", "funcTargetType"]);
    if (Array.isArray(func.buffs)) {
      result.buffs = func.buffs.filter(isRecord).map((buff) => pick(buff, ["id"]));
    }
    if (Array.isArray(func.svals)) {
      result.svals = func.svals.filter(isRecord).map((sval) => pick(sval, ["ActSet"]));
    }
    return result;
  });
}

function compactSkillScript(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const result = pick(value, ["SkillRankUp", "SelectAddInfo", "selectTreasureDeviceInfo"]);
  if (Array.isArray(value.condBranchSkillInfo)) {
    result.condBranchSkillInfo = value.condBranchSkillInfo
      .filter(isRecord)
      .map((branch) => pick(branch, ["condType", "condValue", "skillId"]));
  }
  return result;
}

function compactSkills(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((skill) => {
    const result = pick(skill, ["id", "num", "name", "detail", "icon"]);
    result.targetingMode = classifySkillTargeting(skill);
    const functions = compactFunctions(skill.functions);
    const script = compactSkillScript(skill.script);
    const skillSvts = compactSkillSvts(skill.skillSvts);
    if (functions) result.functions = functions;
    if (script && Object.keys(script).length > 0) result.script = script;
    if (skillSvts) result.skillSvts = skillSvts;
    return result;
  });
}

function compactNpSvts(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((svt) => {
    const releaseConditions = compactReleaseConditions(svt.releaseConditions);
    return releaseConditions ? { releaseConditions } : {};
  });
}

function compactNpScript(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const result = pick(value, ["tdTypeChangeIDs"]);
  if (Array.isArray(value.tdChangeByBattlePoint)) {
    result.tdChangeByBattlePoint = value.tdChangeByBattlePoint
      .filter(isRecord)
      .map((change) => pick(change, ["battlePointId", "phase", "noblePhantasmId"]));
  }
  return result;
}

function compactNoblePhantasms(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((np) => {
    const result = pick(np, ["id", "num", "name", "ruby", "card", "detail"]);
    const functions = compactFunctions(np.functions);
    const npSvts = compactNpSvts(np.npSvts);
    const script = compactNpScript(np.script);
    if (functions) result.functions = functions;
    if (npSvts) result.npSvts = npSvts;
    if (script && Object.keys(script).length > 0) result.script = script;
    return result;
  });
}

function compactTraits(value: unknown): ServantTrait[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Invalid servant traits");
  return value.map((trait: unknown) => {
    if (!isRecord(trait) || typeof trait.id !== "number" || !Number.isInteger(trait.id)) {
      throw new Error("Invalid servant trait ID");
    }
    return { id: trait.id, ...(typeof trait.name === "string" ? { name: trait.name } : {}) };
  });
}

function compactTraitOverrides(value: unknown): ServantTraitOverrides | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Invalid servant trait overrides");
  const result: ServantTraitOverrides = {};
  for (const scope of ["ascension", "costume"] as const) {
    if (value[scope] === undefined) continue;
    if (!isRecord(value[scope])) throw new Error(`Invalid ${scope} trait overrides`);
    result[scope] = Object.fromEntries(Object.entries(value[scope]).map(([id, traits]) => {
      const projected = compactTraits(traits);
      if (!projected) throw new Error(`Missing traits for ${scope} ${id}`);
      return [id, projected];
    }));
  }
  return result;
}

function compactTraitAdditions(value: unknown): ServantTraitAddition[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Invalid servant trait additions");
  return value.map((addition: unknown) => {
    if (!isRecord(addition)) throw new Error("Invalid servant trait addition");
    const trait = compactTraits(addition.trait);
    if (!trait) throw new Error("Missing conditional servant traits");
    if (typeof addition.condType !== "string") throw new Error("Invalid servant trait condition type");
    const number = (field: string): number => {
      const value = addition[field];
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`Invalid servant trait condition ${field}`);
      }
      return value;
    };
    return {
      idx: number("idx"),
      limitCount: number("limitCount"),
      condType: addition.condType,
      condId: number("condId"),
      condNum: number("condNum"),
      eventId: number("eventId"),
      startedAt: number("startedAt"),
      endedAt: number("endedAt"),
      trait,
    };
  });
}

function compactAscensionAdd(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const result: JsonRecord = {};
  for (const field of ["overWriteTDName", "overWriteTDRuby", "overWriteServantName"]) {
    const overrides = value[field];
    if (!isRecord(overrides)) continue;
    result[field] = pick(overrides, ["ascension", "costume"]);
  }
  const individuality = compactTraitOverrides(value.individuality);
  if (individuality) result.individuality = individuality;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Keeps the data Mash consumes from Atlas's large `nice/servant?lore=true`
 * response.  The retained fields cover image downloading, variants, generated
 * catalog data, selection checks, and incremental-refresh dependency indexing.
 */
export function compactServant(value: NiceServant): NiceServant {
  const source = value as JsonRecord;
  const result = pick(source, ROOT_FIELDS);
  result.profile = compactProfile(source.profile);
  const traits = compactTraits(value.traits);
  if (traits) result.traits = traits;
  const traitAdd = compactTraitAdditions(value.traitAdd);
  if (traitAdd) result.traitAdd = traitAdd;

  const extraAssets = compactExtraAssets(source.extraAssets);
  const ascensionAdd = compactAscensionAdd(source.ascensionAdd);
  const skills = compactSkills(source.skills);
  const noblePhantasms = compactNoblePhantasms(source.noblePhantasms);
  const script = compactSkillScript(source.script);

  if (extraAssets) result.extraAssets = extraAssets;
  if (ascensionAdd) result.ascensionAdd = ascensionAdd;
  if (skills) result.skills = skills;
  if (noblePhantasms) result.noblePhantasms = noblePhantasms;
  if (script && Object.keys(script).length > 0) result.script = script;

  return result as NiceServant;
}

export function hasCurrentServantTraits(cached: NiceServant, raw: NiceServant): boolean {
  const rawAscensionAdd = isRecord(raw.ascensionAdd) ? raw.ascensionAdd : {};
  const cachedAscensionAdd = isRecord(cached.ascensionAdd) ? cached.ascensionAdd : {};
  return JSON.stringify({
    traits: cached.traits,
    individuality: cachedAscensionAdd.individuality,
    traitAdd: cached.traitAdd,
  }) === JSON.stringify({
    traits: compactTraits(raw.traits),
    individuality: compactTraitOverrides(rawAscensionAdd.individuality),
    traitAdd: compactTraitAdditions(raw.traitAdd),
  });
}

export interface CompactAllServantsResult {
  files: number;
  migratedRaw: number;
  missingRaw: number;
  rawBytes: number;
  compactBytes: number;
}

export async function compactAllServants(): Promise<CompactAllServantsResult> {
  const entries = await readdir(SERVANTS_DIR, { withFileTypes: true });
  let files = 0;
  let migratedRaw = 0;
  let missingRaw = 0;
  let rawBytes = 0;
  let compactBytes = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    for (const [fileName, rawFileName] of [
      ["servant.json", "servant-raw.json"],
      ["servant-cn.json", "servant-cn-raw.json"],
    ] as const) {
      const compactPath = join(SERVANTS_DIR, entry.name, fileName);
      const rawPath = join(SERVANTS_DIR, entry.name, rawFileName);
      if (!(await fileExists(compactPath)) && !(await fileExists(rawPath))) continue;

      let raw: NiceServant;
      if (await fileExists(rawPath)) {
        raw = await readJson<NiceServant>(rawPath);
      } else {
        const current = await readJson<NiceServant>(compactPath);
        const compactedCurrent = compactServant(current);
        if (JSON.stringify(current) === JSON.stringify(compactedCurrent)) {
          missingRaw += 1;
          continue;
        }
        raw = current;
        await writeJson(rawPath, raw);
        migratedRaw += 1;
      }

      const compacted = compactServant(raw);
      rawBytes += Buffer.byteLength(JSON.stringify(raw));
      compactBytes += Buffer.byteLength(JSON.stringify(compacted));
      await writeJson(compactPath, compacted);
      files += 1;
    }
  }

  return { files, migratedRaw, missingRaw, rawBytes, compactBytes };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  requireDataRoot();
  compactAllServants()
    .then(({ files, migratedRaw, missingRaw, rawBytes, compactBytes }) => {
      const saved = rawBytes - compactBytes;
      const percent = rawBytes === 0 ? 0 : (saved / rawBytes) * 100;
      console.log(
        `Prepared ${files} servant JSON files: ${(rawBytes / 1024 / 1024).toFixed(1)} MiB raw -> ${(compactBytes / 1024 / 1024).toFixed(1)} MiB compact (${percent.toFixed(1)}% saved); migratedRaw=${migratedRaw} missingRaw=${missingRaw}`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
