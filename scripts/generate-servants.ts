#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { requireDataRoot } from "../shared/data-paths.ts";
import { formatResourceJson } from "../shared/resource-json.ts";
import type { ServantTrait, ServantTraitAddition, ServantTraitOverrides } from "../mash-atlasacademy/src/types.ts";

interface NameOverrides {
  ascension?: Record<string, unknown>;
  costume?: Record<string, unknown>;
}

interface NoblePhantasmInput {
  id: number;
  name?: unknown;
  ruby?: unknown;
  card?: unknown;
}

interface ServantInput {
  id: number;
  collectionNo: number;
  name?: unknown;
  classId?: number;
  className?: unknown;
  type?: string;
  rarity: number;
  traits?: ServantTrait[];
  traitAdd?: ServantTraitAddition[];
  noblePhantasms?: NoblePhantasmInput[];
  profile?: { costume?: Record<string, { id: number }> };
  ascensionAdd?: {
    individuality?: ServantTraitOverrides;
    overWriteTDName?: NameOverrides;
    overWriteTDRuby?: NameOverrides;
    overWriteServantName?: NameOverrides;
  };
}

interface ResourceNoblePhantasm {
  id: number;
  name: string;
  nameJP: string;
  nameCN: string;
  card: string;
  cardName: string;
}

interface ServantNameOverride {
  ids: number[];
  nameJP: string;
  nameCN: string;
}

interface ResourceTraitOverrides {
  ascension?: Record<string, number[]>;
  costume?: Record<string, number[]>;
}

type ResourceTraitAddition = Omit<ServantTraitAddition, "trait"> & { trait: number[] };

interface ResourceServant {
  id: number;
  collectionNo: number;
  nameCN: string;
  nameJP: string;
  classId?: number;
  className: string;
  type?: string;
  rarity: number;
  traits: { JP: number[] | null; CN: number[] | null };
  traitOverrides: { JP: ResourceTraitOverrides | null; CN: ResourceTraitOverrides | null };
  traitAdd: { JP: ResourceTraitAddition[] | null; CN: ResourceTraitAddition[] | null };
  noblePhantasms: ResourceNoblePhantasm[];
  overWriteServantNames?: ServantNameOverride[];
}

// Explicit input/output arguments are resolved from the caller for fixture use.
const explicitPaths = process.argv[2] !== undefined && process.argv[3] !== undefined;
const rootDir = explicitPaths ? process.cwd() : requireDataRoot();

const outputPath = resolve(rootDir, process.argv[2] ?? "assets/catalogs/servants.json");
const servantsDir = resolve(rootDir, process.argv[3] ?? "assets/servants");

const CARD_BY_ID: Record<string, string> = {
  1: "arts",
  2: "buster",
  3: "quick",
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return await readJson<T>(path);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return undefined;
    throw err;
  }
}

function displayNpName(np: NoblePhantasmInput | undefined): string | undefined {
  return asNonEmptyString(np?.ruby) || asNonEmptyString(np?.name);
}

function isUsableNpName(name: string | undefined): name is string {
  return Boolean(name && name !== "？？？" && name !== "???");
}

function cardName(card: unknown): string | undefined {
  return CARD_BY_ID[String(card)] ?? asNonEmptyString(card)?.toLowerCase();
}

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFKC")
    .replace(/[·・･‧\s/／]+/g, "");
}

function buildCnNpById(cnServant: ServantInput | undefined): Map<number, NoblePhantasmInput> {
  const map = new Map<number, NoblePhantasmInput>();
  for (const np of cnServant?.noblePhantasms ?? []) {
    if (Number.isInteger(np?.id)) map.set(np.id, np);
  }
  return map;
}

function tdNameOverrides(servant: ServantInput | undefined): NameOverrides {
  return servant?.ascensionAdd?.overWriteTDName ?? {};
}

function tdRubyOverrides(servant: ServantInput | undefined): NameOverrides {
  return servant?.ascensionAdd?.overWriteTDRuby ?? {};
}

function buildNoblePhantasmNameOverrides(
  jpServant: ServantInput,
  cnServant: ServantInput | undefined,
  baseNp: ResourceNoblePhantasm | undefined,
): ResourceNoblePhantasm[] {
  if (!baseNp) return [];

  const jpNames = tdNameOverrides(jpServant);
  const cnNames = tdNameOverrides(cnServant);
  const jpRubies = tdRubyOverrides(jpServant);
  const cnRubies = tdRubyOverrides(cnServant);
  const result: ResourceNoblePhantasm[] = [];

  for (const scope of ["ascension", "costume"] as const) {
    const keys = new Set([
      ...Object.keys(jpNames[scope] ?? {}),
      ...Object.keys(cnNames[scope] ?? {}),
    ]);
    for (const key of keys) {
      const nameJp =
        asNonEmptyString(jpNames[scope]?.[key]) ??
        asNonEmptyString(cnNames[scope]?.[key]);
      if (!isUsableNpName(nameJp)) continue;

      const nameCn = asNonEmptyString(cnNames[scope]?.[key]) ?? nameJp;
      const name =
        asNonEmptyString(cnRubies[scope]?.[key]) ??
        asNonEmptyString(jpRubies[scope]?.[key]) ??
        nameCn;
      result.push({
        ...baseNp,
        name,
        nameJP: nameJp,
        nameCN: nameCn,
      });
    }
  }

  return result;
}

function buildNoblePhantasms(jpServant: ServantInput, cnServant: ServantInput | undefined): ResourceNoblePhantasm[] {
  const cnById = buildCnNpById(cnServant);
  const resultIndexByKey = new Map<string, number>();
  const camelResult: ResourceNoblePhantasm[] = [];

  for (const jpNp of jpServant.noblePhantasms ?? []) {
    const nameJp = asNonEmptyString(jpNp.name);
    if (!isUsableNpName(nameJp)) continue;

    const cnNp = cnById.get(jpNp.id);
    const nameCn = asNonEmptyString(cnNp?.name) ?? nameJp;
    const name = displayNpName(cnNp) ?? displayNpName(jpNp) ?? nameJp;
    const rawCard = asNonEmptyString(jpNp.card) ?? "";
    const compatibleCard = cardName(rawCard) ?? rawCard;
    const dedupeKey = [
      normalizeKey(nameJp),
      normalizeKey(nameCn),
      compatibleCard,
    ].join("|");

    const camelNp = {
      id: jpNp.id,
      name,
      nameJP: nameJp,
      nameCN: nameCn,
      card: rawCard,
      cardName: compatibleCard,
    };
    const existingIndex = resultIndexByKey.get(dedupeKey);
    if (existingIndex === undefined) {
      resultIndexByKey.set(dedupeKey, camelResult.length);
      camelResult.push(camelNp);
      continue;
    }

    if (camelNp.id > camelResult[existingIndex].id) {
      camelResult[existingIndex] = camelNp;
    }
  }

  const baseNp = camelResult.reduce<ResourceNoblePhantasm | undefined>(
    (greatest, np) => (!greatest || np.id > greatest.id ? np : greatest),
    undefined,
  );
  for (const overrideNp of buildNoblePhantasmNameOverrides(
    jpServant,
    cnServant,
    baseNp,
  )) {
    const dedupeKey = [
      normalizeKey(overrideNp.nameJP),
      normalizeKey(overrideNp.nameCN),
      overrideNp.cardName,
    ].join("|");
    if (resultIndexByKey.has(dedupeKey)) continue;
    resultIndexByKey.set(dedupeKey, camelResult.length);
    camelResult.push(overrideNp);
  }

  return camelResult;
}

function ascensionVariantId(limitCount: number): number | undefined {
  if (limitCount === 0) return 1;
  if (limitCount === 1 || limitCount === 2) return 2;
  if (limitCount === 3 || limitCount === 4) return limitCount;
  return undefined;
}

function buildCostumeVariantIdByLimitCount(jpServant: ServantInput, cnServant: ServantInput | undefined): Map<number, number> {
  const result = new Map<number, number>();

  for (const servant of [jpServant, cnServant]) {
    for (const [battleCharaIdValue, costume] of Object.entries(
      servant?.profile?.costume ?? {},
    )) {
      const battleCharaId = Number(battleCharaIdValue);
      const limitCount = costume?.id;
      if (!Number.isInteger(battleCharaId) || !Number.isInteger(limitCount)) {
        continue;
      }
      if (!result.has(limitCount)) result.set(limitCount, battleCharaId);
    }
  }

  return result;
}

function buildOverWriteServantNames(jpServant: ServantInput, cnServant: ServantInput | undefined): ServantNameOverride[] {
  const jpOverwrites =
    jpServant?.ascensionAdd?.overWriteServantName ?? {};
  const cnOverwrites =
    cnServant?.ascensionAdd?.overWriteServantName ?? {};
  const costumeVariantIdByLimitCount = buildCostumeVariantIdByLimitCount(
    jpServant,
    cnServant,
  );
  const indexByName = new Map<string, number>();
  const result: ServantNameOverride[] = [];

  function addName(variantId: number, jpNameValue: unknown, cnNameValue: unknown): void {
    const nameJp = asNonEmptyString(jpNameValue);
    if (!nameJp) return;

    const nameCn = asNonEmptyString(cnNameValue) ?? nameJp;
    const dedupeKey = [nameJp, nameCn].join("\0");

    const existingIndex = indexByName.get(dedupeKey);
    if (existingIndex !== undefined) {
      if (!result[existingIndex].ids.includes(variantId)) {
        result[existingIndex].ids.push(variantId);
      }
      return;
    }

    indexByName.set(dedupeKey, result.length);
    result.push({
      ids: [variantId],
      nameJP: nameJp,
      nameCN: nameCn,
    });
  }

  for (const [limitCountValue, jpNameValue] of Object.entries(
    jpOverwrites.ascension ?? {},
  )) {
    const limitCount = Number(limitCountValue);
    const variantId = ascensionVariantId(limitCount);
    if (variantId === undefined) continue;
    addName(
      variantId,
      jpNameValue,
      cnOverwrites.ascension?.[limitCountValue],
    );
  }

  for (const [limitCountValue, jpNameValue] of Object.entries(
    jpOverwrites.costume ?? {},
  )) {
    const limitCount = Number(limitCountValue);
    const variantId = costumeVariantIdByLimitCount.get(limitCount);
    if (variantId === undefined) continue;
    addName(
      variantId,
      jpNameValue,
      cnOverwrites.costume?.[limitCountValue],
    );
  }

  for (const entry of result) entry.ids.sort((a, b) => a - b);
  return result;
}

function resourceTraits(traits: ServantTrait[] | undefined): number[] | null {
  if (!Array.isArray(traits)) return null;
  return [...new Set(traits.map((trait) => trait.id))].sort((a, b) => a - b);
}

function resourceTraitOverrides(overrides: ServantTraitOverrides | undefined): ResourceTraitOverrides | null {
  if (!overrides) return null;
  const result: ResourceTraitOverrides = {};
  for (const scope of ["ascension", "costume"] as const) {
    if (overrides[scope]) result[scope] = Object.fromEntries(
      Object.entries(overrides[scope]).map(([id, traits]) => [id, resourceTraits(traits) ?? []]),
    );
  }
  return result;
}

function resourceTraitAdditions(additions: ServantTraitAddition[] | undefined): ResourceTraitAddition[] | null {
  return additions?.map((addition) => ({ ...addition, trait: resourceTraits(addition.trait) ?? [] })) ?? null;
}

function buildEntry(jpServant: ServantInput, cnServant: ServantInput | undefined): ResourceServant {
  const collectionNo = jpServant.collectionNo;
  const id = jpServant.id;
  const nameJp = asNonEmptyString(jpServant.name) ?? "";
  const nameCn = asNonEmptyString(cnServant?.name) ?? nameJp;
  const className = asNonEmptyString(jpServant.className) ?? "";
  const rarity = Number.isInteger(jpServant.rarity) ? jpServant.rarity : 0;
  const traitsJP = resourceTraits(jpServant.traits);
  const traitsCN = resourceTraits(cnServant?.traits);
  const nps = buildNoblePhantasms(jpServant, cnServant);
  const overWriteServantNames = buildOverWriteServantNames(
    jpServant,
    cnServant,
  );

  const entry: ResourceServant = {
    id,
    collectionNo,
    nameCN: nameCn,
    nameJP: nameJp,
    classId: jpServant.classId,
    className,
    type: jpServant.type,
    rarity,
    traits: { JP: traitsJP, CN: traitsCN },
    traitOverrides: {
      JP: resourceTraitOverrides(jpServant.ascensionAdd?.individuality),
      CN: resourceTraitOverrides(cnServant?.ascensionAdd?.individuality),
    },
    traitAdd: {
      JP: resourceTraitAdditions(jpServant.traitAdd),
      CN: resourceTraitAdditions(cnServant?.traitAdd),
    },
    noblePhantasms: nps,
  };
  if (overWriteServantNames.length > 0) {
    entry.overWriteServantNames = overWriteServantNames;
  }

  return entry;
}

const names = await readdir(servantsDir);
const collectionNos = names
  .map((name) => Number(name))
  .filter((value) => Number.isInteger(value) && value > 0)
  .sort((a, b) => a - b);

const servants: ResourceServant[] = [];
const missingCn: number[] = [];
for (const collectionNo of collectionNos) {
  const servantDir = resolve(servantsDir, String(collectionNo));
  const jpServant = await readJson<ServantInput>(resolve(servantDir, "servant.json"));
  const cnServant = await readJsonIfExists<ServantInput>(resolve(servantDir, "servant-cn.json"));
  if (!cnServant) missingCn.push(collectionNo);
  servants.push(buildEntry(jpServant, cnServant));
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, formatResourceJson(servants), "utf8");

console.log(`Generated ${servants.length} servants -> ${outputPath}`);
if (missingCn.length > 0) {
  console.log(
    `CN servant JSON missing for ${missingCn.length} servant(s); used JP fallback names.`,
  );
}
