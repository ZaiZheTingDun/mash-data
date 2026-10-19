import type { BasicEvent, NiceEquip } from "./types.js";

type JsonRecord = Record<string, unknown>;

export interface BondBonusValue {
  percent: number | null;
  flat: number | null;
  /** Source parameters restricting this value, e.g. Individuality or EventId. */
  conditions: JsonRecord;
}

export interface BondBonus {
  skillId: number;
  functionId: number;
  limitBreak: number;
  detail: string | null;
  values: BondBonusValue[];
  /** null means the normal values also apply when borrowed as support. */
  supportValues: BondBonusValue[] | null;
  conditions: JsonRecord;
}

export interface CraftEssenceSummary {
  bondEquipOwner: number | null;
  valentineEquipOwner: number | null;
  bondBonuses: BondBonus[];
  events: Array<{ id: number; name: string | null }>;
}

export interface CompactCraftEssence extends CraftEssenceSummary {
  schemaVersion: 1;
  id: number;
  collectionNo: number;
  name: string;
  originalName?: string;
  type?: string;
  flag?: string;
  flags: string[];
  rarity: number;
  atkMax?: number;
  hpMax?: number;
  face?: string;
}

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value) || !value.every(record)) throw new Error(`Invalid ${label}: expected object array`);
  return value;
}

function optionalRecords(value: unknown, label: string): JsonRecord[] {
  return value == null ? [] : records(value, label);
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function pick(source: JsonRecord, keys: string[]): JsonRecord {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]));
}

export function validateRawCraftEssence(value: unknown, collectionNo?: number): asserts value is NiceEquip {
  if (!record(value) || !positiveId(value.id) || !positiveId(value.collectionNo)
    || (collectionNo !== undefined && value.collectionNo !== collectionNo)
    || typeof value.name !== "string" || typeof value.rarity !== "number"
    || !record(value.extraAssets) || !Object.hasOwn(value, "profile")) {
    throw new Error(`Invalid full craft essence response${collectionNo === undefined ? "" : ` for ${collectionNo}`}`);
  }
  for (const field of ["bondEquipOwner", "valentineEquipOwner"]) {
    if (value[field] != null && !positiveId(value[field])) throw new Error(`Invalid ${field}`);
  }
  for (const skill of records(value.skills, "CE skills")) {
    if (!positiveId(skill.id)) throw new Error("Invalid CE skill ID");
    records(skill.functions, "CE skill functions");
  }
}

export function validateEventIndex(value: unknown): asserts value is BasicEvent[] {
  for (const event of records(value, "event index")) {
    if (!positiveId(event.id) || typeof event.name !== "string") throw new Error("Invalid event index entry");
  }
}

function bonusValues(value: unknown): BondBonusValue[] {
  const vals = records(value, "bond bonus values");
  if (vals.length === 0) throw new Error("Bond bonus has no values");
  return vals.map((val) => {
    for (const key of ["RateCount", "AddCount"]) {
      if (val[key] !== undefined && (typeof val[key] !== "number" || !Number.isFinite(val[key]))) {
        throw new Error(`Invalid bond bonus ${key}`);
      }
    }
    if (val.RateCount === undefined && val.AddCount === undefined) throw new Error("Bond bonus has no RateCount or AddCount");
    const { RateCount, AddCount, ...conditions } = val;
    return {
      percent: typeof RateCount === "number" ? RateCount / 10 : null,
      flat: typeof AddCount === "number" ? AddCount : null,
      conditions,
    };
  });
}

/** Pure projection: no network access, no full skill/function trees in the result. */
export function compactCraftEssence(raw: NiceEquip, events: BasicEvent[] = []): CompactCraftEssence {
  validateRawCraftEssence(raw);
  validateEventIndex(events);
  const eventNames = new Map(events.map((event) => [event.id, event.name]));
  const eventIds = new Set<number>();
  const addEvent = (id: unknown) => { if (positiveId(id)) eventIds.add(id); };
  const bondBonuses: BondBonus[] = [];

  for (const skill of raw.skills) {
    const bindings = optionalRecords(skill.skillSvts, "skill bindings")
      .filter((binding) => binding.svtId === raw.id);
    const passives = optionalRecords(skill.extraPassive, "extra passives");
    for (const binding of [...bindings, ...passives]) {
      addEvent(binding.eventId);
      if (record(binding.script)) addEvent(binding.script.otherValidEventId);
    }
    for (const func of records(skill.functions, "CE functions")) {
      const groups = optionalRecords(func.funcGroup, "function groups");
      const vals = optionalRecords(func.svals, "function values");
      const followerVals = optionalRecords(func.followerVals, "support values");
      for (const group of groups) addEvent(group.eventId);
      for (const val of [...vals, ...followerVals]) addEvent(val.EventId);
      if (func.funcType !== "servantFriendshipUp") continue;
      if (!positiveId(func.funcId)) throw new Error("Invalid bond bonus function ID");
      if (typeof skill.condLimitCount !== "number" || !Number.isInteger(skill.condLimitCount) || skill.condLimitCount < 0) {
        throw new Error("Invalid bond bonus limit break condition");
      }
      bondBonuses.push({
        skillId: skill.id as number,
        functionId: func.funcId,
        limitBreak: skill.condLimitCount,
        detail: typeof skill.detail === "string" ? skill.detail : null,
        values: bonusValues(func.svals),
        supportValues: func.followerVals == null ? null : bonusValues(func.followerVals),
        conditions: {
          skill: pick(skill, ["condQuestId", "condQuestPhase", "condLv", "script", "actIndividuality"]),
          bindings,
          extraPassive: passives,
          function: pick(func, ["funcTargetType", "funcTargetTeam", "functvals", "overWriteTvalsList", "funcquestTvals", "script", "funcGroup"]),
        },
      });
    }
  }

  const face = raw.extraAssets.equipFace?.equip?.[String(raw.id)]
    ?? raw.extraAssets.faces?.equip?.[String(raw.id)];
  return {
    schemaVersion: 1,
    id: raw.id,
    collectionNo: raw.collectionNo,
    name: raw.name,
    ...pick(raw, ["originalName", "type", "flag", "atkMax", "hpMax"]),
    flags: Array.isArray(raw.flags) ? raw.flags as string[] : [],
    rarity: raw.rarity,
    ...(face ? { face: face.replace("/Faces/", "/EquipFaces/") } : {}),
    bondEquipOwner: raw.bondEquipOwner ?? null,
    valentineEquipOwner: raw.valentineEquipOwner ?? null,
    bondBonuses,
    events: [...eventIds].sort((a, b) => a - b).map((id) => ({ id, name: eventNames.get(id) ?? null })),
  };
}

export function craftEssenceSummary(ce: CompactCraftEssence): CraftEssenceSummary {
  return {
    bondEquipOwner: ce.bondEquipOwner,
    valentineEquipOwner: ce.valentineEquipOwner,
    bondBonuses: ce.bondBonuses,
    events: ce.events,
  };
}
