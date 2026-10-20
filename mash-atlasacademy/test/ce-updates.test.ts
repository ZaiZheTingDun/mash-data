import "./setup-data-root.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { craftEssencePaths, loadOrFetchCraftEssence } from "../src/ce-cache.js";
import { combineCraftEssences } from "../src/combine-ces.js";
import { changedCraftEssences, downloadAllCraftEssences, type DownloadCraftEssencesOptions } from "../src/download-ces.js";
import { fileExists, readJson, writeJsonAtomic } from "../src/fs-utils.js";
import type { AtlasChangeRecord, BasicEquip, Region } from "../src/types.js";
import { bondSkill, equip } from "./fixtures/ces.js";

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "ce-update-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cesDir = join(root, "ces");
  const dataVersionFile = join(root, "cursor.json");
  const eventIndexFiles = { JP: join(root, "events-jp.json"), CN: join(root, "events-cn.json") };
  return { root, cesDir, dataVersionFile, eventIndexFiles, delayMs: 0 };
}

function change(commit: string, changes: Partial<AtlasChangeRecord["changes"]> = {}): AtlasChangeRecord {
  return { commit, timestamp: 1, changes: { svt: [], ce: [], skill: [], func: [], buff: [], np: [], ...changes } };
}
const versions = (hash: string) => ({ JP: { hash, timestamp: 1 }, CN: { hash, timestamp: 1 } });

async function pipeline(t: TestContext) {
  const paths = await setup(t);
  const fetched: string[] = [];
  const raw = equip(330, { skills: [bondSkill(990554, 0, 20)] });
  const deps = {
    fetchVersions: async () => versions("aaa"),
    fetchBasic: async () => [{ id: raw.id, collectionNo: raw.collectionNo }] as BasicEquip[],
    fetchEvents: async (region: Region) => [{ id: 10, name: `${region} event` }],
    fetchChanges: async (): Promise<string> => { throw new Error("unchanged must not load Changes"); },
    fetchEquip: async (region: Region, id: number) => { fetched.push(`${region}:${id}`); return structuredClone(raw); },
    downloadImage: async (_url: string, destination: string) => { await writeFile(destination, "image"); },
  };
  const options: DownloadCraftEssencesOptions = { ...paths, dependencies: deps };
  return { paths, deps, options, raw, fetched };
}

test("legacy basic files are refetched as nice raw; compact cache rebuild and extractor updates are offline", async (t) => {
  const { cesDir } = await setup(t);
  const paths = craftEssencePaths("JP", 330, cesDir);
  await writeJsonAtomic(paths.compact, { id: 9401970, collectionNo: 330, name: "old basic" });
  let fetches = 0;
  const options = { cesDir, fetcher: async () => { fetches++; return equip(330, { id: 9401970, skills: [bondSkill(990554, 0, 20)] }); } };
  const first = await loadOrFetchCraftEssence("JP", 330, options);
  assert.equal(first.refreshed, true);
  assert.equal((await readJson<{ profile: unknown }>(paths.raw)).profile !== undefined, true);
  await rm(paths.compact);
  const rebuilt = await loadOrFetchCraftEssence("JP", 330, options);
  assert.equal(rebuilt.refreshed, false);
  assert.equal(rebuilt.data.bondBonuses[0]?.values[0]?.percent, 2);
  await writeJsonAtomic(paths.compact, { obsolete: true });
  await loadOrFetchCraftEssence("JP", 330, options);
  assert.equal(fetches, 1);
  assert.equal((await readJson<{ schemaVersion: number }>(paths.compact)).schemaVersion, 1);
});

test("corrupt raw is refetched; a failed or mismatched response preserves previous raw and compact", async (t) => {
  const { cesDir } = await setup(t);
  const paths = craftEssencePaths("JP", 330, cesDir);
  await writeJsonAtomic(paths.raw, { id: 1 });
  await loadOrFetchCraftEssence("JP", 330, { cesDir, fetcher: async () => equip(330) });
  const before = await readFile(paths.raw, "utf8");
  const beforeCompact = await readFile(paths.compact, "utf8");
  await assert.rejects(loadOrFetchCraftEssence("JP", 330, { cesDir, forceRefresh: true, fetcher: async () => { throw new Error("offline"); } }), /offline/);
  await assert.rejects(loadOrFetchCraftEssence("JP", 330, { cesDir, forceRefresh: true, expectedId: 9401970, fetcher: async () => equip(330) }), /ID mismatch/);
  await assert.rejects(loadOrFetchCraftEssence("JP", 330, { cesDir, forceRefresh: true, fetcher: async () => equip(999) }), /Invalid full/);
  assert.equal(await readFile(paths.raw, "utf8"), before);
  assert.equal(await readFile(paths.compact, "utf8"), beforeCompact);
});

test("CE, skill, function, nested function and Buff changes refresh owners, without matching servant collection numbers", () => {
  const first = equip(1, { skills: [{ id: 100, functions: [{ funcId: 200, buffs: [{ id: 300 }], svals: [{ DependFunc: { funcId: 400 } }] }] }] });
  const second = equip(2, { skills: [{ id: 101, functions: [{ funcId: 201 }] }] });
  const third = equip(3);
  const raw = new Map([[1, first], [2, second], [3, third]]);
  const basic = [first, second, third] as unknown as BasicEquip[];
  for (const changes of [
    { ce: [{ id: first.id }] }, { skill: [{ id: 100 }] }, { func: [{ id: 200 }] },
    { buff: [{ id: 300 }] }, { func: [{ id: 400 }] }, { svt: [{ id: first.id }] },
  ]) assert.deepEqual([...changedCraftEssences([change("bbb", changes)], raw, basic)], [1]);
  assert.deepEqual([...changedCraftEssences([change("bbb", { svt: [{ id: 700100, collectionNo: 1 }] })], raw, basic)], []);
});

test("independent cursors migrate then skip downloads, rebuild compact files, and refresh effect dependencies", async (t) => {
  const { paths, deps, options, raw, fetched } = await pipeline(t);
  await downloadAllCraftEssences(options);
  assert.deepEqual(fetched.sort(), ["CN:330", "JP:330"]);
  fetched.length = 0;
  await rm(craftEssencePaths("JP", 330, paths.cesDir).compact);
  await downloadAllCraftEssences(options);
  assert.deepEqual(fetched, []);
  assert.equal(await fileExists(craftEssencePaths("JP", 330, paths.cesDir).compact), true);
  deps.fetchVersions = async () => versions("bbb");
  deps.fetchChanges = async () => [change("aaa"), change("bbb", { func: [{ id: 5136 }] })].map((r) => JSON.stringify(r)).join("\n");
  raw.skills = [bondSkill(990554, 0, 30)];
  await downloadAllCraftEssences(options);
  assert.deepEqual(fetched.sort(), ["CN:330", "JP:330"]);
  const compact = await readJson<{ bondBonuses: Array<{ values: Array<{ percent: number }> }> }>(craftEssencePaths("JP", 330, paths.cesDir).compact);
  assert.equal(compact.bondBonuses[0]?.values[0]?.percent, 3);
  assert.deepEqual(await readJson(paths.dataVersionFile), versions("bbb"));
});

test("download or image failure leaves the region cursor unchanged and can be retried", async (t) => {
  const { paths, deps, options, fetched } = await pipeline(t);
  await downloadAllCraftEssences(options);
  deps.fetchVersions = async () => versions("bbb");
  deps.fetchChanges = async () => [change("aaa"), change("bbb", { skill: [{ id: 990554 }] })].map((r) => JSON.stringify(r)).join("\n");
  const fetchEquip = deps.fetchEquip;
  deps.fetchEquip = async (region, id) => { if (region === "JP") throw new Error("network failure"); return fetchEquip(region, id); };
  await assert.rejects(downloadAllCraftEssences(options), /network failure/);
  assert.equal((await readJson<{ JP: { hash: string } }>(paths.dataVersionFile)).JP.hash, "aaa");
  deps.fetchEquip = fetchEquip;
  await rm(join(paths.cesDir, "330", "card_ce.png"));
  const image = deps.downloadImage;
  deps.downloadImage = async () => { throw new Error("image failure"); };
  await assert.rejects(downloadAllCraftEssences(options), /image failure/);
  assert.equal((await readJson<{ JP: { hash: string } }>(paths.dataVersionFile)).JP.hash, "aaa");
  deps.downloadImage = image;
  fetched.length = 0;
  await downloadAllCraftEssences(options);
  assert.deepEqual(fetched, ["JP:330"]);
  assert.deepEqual(await readJson(paths.dataVersionFile), versions("bbb"));
});

test("invalid event index or stale target stops updates without advancing that region", async (t) => {
  const { paths, deps, options } = await pipeline(t);
  await downloadAllCraftEssences(options);
  deps.fetchVersions = async () => versions("bbb");
  deps.fetchChanges = async () => JSON.stringify(change("aaa"));
  await assert.rejects(downloadAllCraftEssences(options), /not present in the change log/);
  assert.deepEqual(await readJson(paths.dataVersionFile), versions("aaa"));
  deps.fetchEvents = async () => [{ id: 0, name: "bad" }];
  await assert.rejects(downloadAllCraftEssences(options), /Invalid event index/);
  assert.deepEqual(await readJson(paths.dataVersionFile), versions("aaa"));
});

test("combiner rebuilds from raw, separates regions, marks CN missing, and leaves previous output on error", async (t) => {
  const paths = await setup(t);
  for (const region of ["JP", "CN"] as const) {
    await writeJsonAtomic(paths.eventIndexFiles[region], [{ id: 10, name: `${region} event` }]);
    const raw = equip(1, {
      name: `${region} name`, skills: [{ ...bondSkill(100, 0, region === "JP" ? 20 : 10),
        skillSvts: [{ svtId: 9400001, eventId: 10 }],
      }],
    });
    await writeJsonAtomic(craftEssencePaths(region, 1, paths.cesDir).raw, raw);
  }
  await writeJsonAtomic(craftEssencePaths("JP", 2, paths.cesDir).raw, equip(2));
  const options = { ...paths, output: join(paths.root, "craft_essences.json") };
  const result = await combineCraftEssences(options);
  assert.equal(result[0]?.name, "JP name");
  assert.equal(result[0]?.name_cn, "CN name");
  assert.equal(result[0]?.regions.JP?.bondBonuses[0]?.values[0]?.percent, 2);
  assert.equal(result[0]?.regions.CN?.bondBonuses[0]?.values[0]?.percent, 1);
  assert.deepEqual(result[0]?.regions.CN?.events, [{ id: 10 }]);
  assert.equal(result[1]?.regions.CN, null);
  assert.deepEqual(result[1]?.regions.JP?.events, []);
  const before = await readFile(options.output, "utf8");
  assert.equal(before.split("\n").length, 4); // brackets plus one line per CE
  await writeJsonAtomic(craftEssencePaths("CN", 2, paths.cesDir).compact, { id: 1 });
  await assert.rejects(combineCraftEssences(options), /Missing full raw cache/);
  assert.equal(await readFile(options.output, "utf8"), before);
  await rm(craftEssencePaths("CN", 2, paths.cesDir).compact);
  await writeFile(paths.eventIndexFiles.CN, "corrupt");
  await assert.rejects(combineCraftEssences(options));
  assert.equal(await readFile(options.output, "utf8"), before);
});
