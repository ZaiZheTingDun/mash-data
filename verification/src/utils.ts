import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { requireDataRoot } from "../../shared/data-paths.ts";

export interface SkillFunction {
  funcTargetType?: string;
  svals?: Array<Record<string, unknown>>;
}

export interface SelectAddInfoEntry {
  btn?: unknown[];
}

export interface SelectTreasureDeviceInfoEntry {
  treasureDevices?: unknown[];
}

export interface SkillScript {
  SelectAddInfo?: SelectAddInfoEntry[];
  selectTreasureDeviceInfo?: SelectTreasureDeviceInfoEntry[];
}

export interface Skill {
  id: number;
  num: number;
  functions?: SkillFunction[];
  script?: SkillScript;
}

export interface Servant {
  collectionNo: number;
  skills?: Skill[];
}

export const repoRoot = requireDataRoot();
export const resultRoot = path.join(repoRoot, "verification", "result");
const servantsRoot = path.join(repoRoot, "assets", "servants");

export async function getServantFilePaths(): Promise<string[]> {
  const entries = await readdir(servantsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(servantsRoot, entry.name, "servant.json"))
    .filter((filePath) => existsSync(filePath))
    .sort((a, b) => a.localeCompare(b));
}

export async function readServant(filePath: string): Promise<Servant> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as Servant;
}

export function sortBySkillIdentity<T extends { servantCollectionNo: number; skillNum: number; skillId: number }>(
  rows: T[],
): T[] {
  return rows.sort(
    (a, b) =>
      a.servantCollectionNo - b.servantCollectionNo ||
      a.skillNum - b.skillNum ||
      a.skillId - b.skillId,
  );
}

export async function writePrettyJson(filename: string, value: unknown): Promise<void> {
  await mkdir(resultRoot, { recursive: true });
  const outputPath = path.join(resultRoot, filename);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(outputPath, content, "utf8");
}
