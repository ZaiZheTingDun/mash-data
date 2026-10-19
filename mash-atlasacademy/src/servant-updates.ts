import { join } from "node:path";
import { fileExists, readJson, writeJsonAtomic } from "./fs-utils.js";
import { DATA_VERSION_FILE, SERVANTS_DIR } from "./paths.js";
import type {
  AtlasChangeEntity,
  AtlasChangeRecord,
  AtlasDataVersion,
  AtlasDataVersions,
  NiceServant,
  Region,
} from "./types.js";

type DependencyType = "skill" | "np" | "func" | "buff";

export interface ServantCacheEntry {
  collectionNo: number;
  data: NiceServant;
}

export interface ServantCacheInspection {
  valid: ServantCacheEntry[];
  missing: Set<number>;
  invalid: Set<number>;
}

export interface ServantDependencyIndex {
  skill: Map<number, Set<number>>;
  np: Map<number, Set<number>>;
  func: Map<number, Set<number>>;
  buff: Map<number, Set<number>>;
}

export interface ChangeRange {
  mode: "incremental" | "full";
  records: AtlasChangeRecord[];
  reason: "version_changed" | "cursor_missing" | "version_rollback";
}

export interface ChangedServantIds {
  direct: Set<number>;
  dependency: Set<number>;
  unassociatedEntities: number;
}

const SKILL_ARRAY_KEYS = ["skills"] as const;

export class TargetDataVersionNotFoundError extends Error {
  constructor(region: Region | undefined, hash: string) {
    super(
      `${region ? `${region} ` : ""}target data version ${hash} is not present in the change log`,
    );
    this.name = "TargetDataVersionNotFoundError";
  }
}

export function parseChangeLog(text: string): AtlasChangeRecord[] {
  const lines = text.split(/\r?\n/);
  const records: AtlasChangeRecord[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid change log JSON on line ${index + 1}`, {
        cause: error,
      });
    }

    if (!isChangeRecord(value)) {
      throw new Error(`Invalid change log record on line ${index + 1}`);
    }
    records.push(value);
  }

  if (records.length === 0) {
    throw new Error("Change log contains no records");
  }
  return records;
}

export function selectChangeRange(
  records: AtlasChangeRecord[],
  localHash: string,
  targetHash: string,
  region?: Region,
): ChangeRange {
  const targetIndex = uniqueCommitIndex(records, targetHash);
  if (targetIndex === undefined) {
    throw new TargetDataVersionNotFoundError(region, targetHash);
  }

  const localIndex = uniqueCommitIndex(records, localHash);
  if (localIndex === undefined) {
    return { mode: "full", records: [], reason: "cursor_missing" };
  }
  if (localIndex > targetIndex) {
    return { mode: "full", records: [], reason: "version_rollback" };
  }

  return {
    mode: "incremental",
    records: records.slice(localIndex + 1, targetIndex + 1),
    reason: "version_changed",
  };
}

export function buildServantDependencyIndex(
  servants: ServantCacheEntry[],
): ServantDependencyIndex {
  const index = emptyDependencyIndex();

  for (const servant of servants) {
    const value = servant.data as Record<string, unknown>;
    for (const key of SKILL_ARRAY_KEYS) {
      const skills = asRecordArray(value[key]);
      for (const skill of skills) {
        addOwner(index.skill, skill.id, servant.collectionNo);
        indexFunctions(skill.functions, servant.collectionNo, index);
      }
    }

    for (const np of asRecordArray(value.noblePhantasms)) {
      addOwner(index.np, np.id, servant.collectionNo);
      indexFunctions(np.functions, servant.collectionNo, index);
    }
  }

  return index;
}

export function collectChangedServantIds(
  records: AtlasChangeRecord[],
  index: ServantDependencyIndex,
  currentCollectionNos: Set<number>,
): ChangedServantIds {
  const direct = new Set<number>();
  const dependency = new Set<number>();
  const unassociated = new Set<string>();

  for (const record of records) {
    for (const svt of record.changes.svt) {
      const collectionNo = svt.collectionNo;
      if (
        typeof collectionNo === "number" &&
        collectionNo > 0 &&
        currentCollectionNos.has(collectionNo)
      ) {
        direct.add(collectionNo);
      } else {
        unassociated.add(`svt:${svt.id}:${collectionNo ?? "unknown"}`);
      }
    }

    collectOwners(
      "skill",
      record.changes.skill,
      index,
      currentCollectionNos,
      dependency,
      unassociated,
    );
    collectOwners(
      "np",
      record.changes.np,
      index,
      currentCollectionNos,
      dependency,
      unassociated,
    );
    collectOwners(
      "func",
      record.changes.func,
      index,
      currentCollectionNos,
      dependency,
      unassociated,
    );
    collectOwners(
      "buff",
      record.changes.buff,
      index,
      currentCollectionNos,
      dependency,
      unassociated,
    );
  }

  for (const collectionNo of direct) dependency.delete(collectionNo);
  return {
    direct,
    dependency,
    unassociatedEntities: unassociated.size,
  };
}

export async function inspectServantCache(
  region: Region,
  collectionNos: number[],
  servantsDir = SERVANTS_DIR,
): Promise<ServantCacheInspection> {
  const valid: ServantCacheEntry[] = [];
  const missing = new Set<number>();
  const invalid = new Set<number>();
  const fileName = region === "JP" ? "servant.json" : "servant-cn.json";
  const rawFileName = region === "JP" ? "servant-raw.json" : "servant-cn-raw.json";

  for (const collectionNo of collectionNos) {
    const path = join(servantsDir, String(collectionNo), fileName);
    const rawPath = join(servantsDir, String(collectionNo), rawFileName);
    if (!(await fileExists(path)) || !(await fileExists(rawPath))) {
      missing.add(collectionNo);
      continue;
    }

    try {
      const data = await readJson<NiceServant>(path);
      if (!data || typeof data !== "object" || !("profile" in data)) {
        invalid.add(collectionNo);
        continue;
      }
      valid.push({ collectionNo, data });
    } catch {
      invalid.add(collectionNo);
    }
  }

  return { valid, missing, invalid };
}

export async function readDataVersions(
  filePath = DATA_VERSION_FILE,
): Promise<AtlasDataVersions> {
  if (!(await fileExists(filePath))) return {};

  try {
    const value = await readJson<unknown>(filePath);
    if (!value || typeof value !== "object") return {};
    const record = value as Record<string, unknown>;
    const versions: AtlasDataVersions = {};
    for (const region of ["JP", "CN"] as const) {
      const version = normalizeDataVersion(record[region]);
      if (version) versions[region] = version;
    }
    return versions;
  } catch {
    return {};
  }
}

export async function writeDataVersions(
  versions: AtlasDataVersions,
  filePath = DATA_VERSION_FILE,
): Promise<void> {
  await writeJsonAtomic(filePath, versions);
}

export function normalizeDataVersion(
  value: unknown,
): AtlasDataVersion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.hash !== "string" ||
    record.hash.length === 0 ||
    typeof record.timestamp !== "number" ||
    !Number.isInteger(record.timestamp)
  ) {
    return undefined;
  }
  return { hash: record.hash, timestamp: record.timestamp };
}

function emptyDependencyIndex(): ServantDependencyIndex {
  return {
    skill: new Map(),
    np: new Map(),
    func: new Map(),
    buff: new Map(),
  };
}

function indexFunctions(
  value: unknown,
  collectionNo: number,
  index: ServantDependencyIndex,
): void {
  for (const func of asRecordArray(value)) {
    addOwner(index.func, func.funcId, collectionNo);
    for (const buff of asRecordArray(func.buffs)) {
      addOwner(index.buff, buff.id, collectionNo);
    }
  }
}

function collectOwners(
  type: DependencyType,
  entities: AtlasChangeEntity[],
  index: ServantDependencyIndex,
  currentCollectionNos: Set<number>,
  output: Set<number>,
  unassociated: Set<string>,
): void {
  for (const entity of entities) {
    const owners = index[type].get(entity.id);
    let found = false;
    for (const owner of owners ?? []) {
      if (!currentCollectionNos.has(owner)) continue;
      output.add(owner);
      found = true;
    }
    if (!found) unassociated.add(`${type}:${entity.id}`);
  }
}

function addOwner(
  map: Map<number, Set<number>>,
  id: unknown,
  collectionNo: number,
): void {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return;
  const owners = map.get(id) ?? new Set<number>();
  owners.add(collectionNo);
  map.set(id, owners);
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object",
  );
}

function uniqueCommitIndex(
  records: AtlasChangeRecord[],
  hash: string,
): number | undefined {
  if (!hash) return undefined;
  const matches: number[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const commit = records[index]?.commit;
    if (commit === hash || commit?.startsWith(hash)) matches.push(index);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function isChangeRecord(value: unknown): value is AtlasChangeRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.commit !== "string" ||
    record.commit.length === 0 ||
    typeof record.timestamp !== "number" ||
    !record.changes ||
    typeof record.changes !== "object"
  ) {
    return false;
  }
  const changes = record.changes as Record<string, unknown>;
  return ["svt", "ce", "skill", "buff", "np", "func"].every((key) =>
    Array.isArray(changes[key]),
  );
}
