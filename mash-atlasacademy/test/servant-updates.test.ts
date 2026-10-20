import "./setup-data-root.ts";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { downloadAllServants } from "../src/download-servants.js";
import {
  downloadServantImages,
  loadOrFetchServant,
} from "../src/downloader.js";
import { compactServant } from "../src/compact-servant.js";
import {
  TargetDataVersionNotFoundError,
  buildServantDependencyIndex,
  collectChangedServantIds,
  inspectServantCache,
  parseChangeLog,
  readDataVersions,
  selectChangeRange,
  writeDataVersions,
} from "../src/servant-updates.js";
import type {
  AtlasDataVersions,
  BasicServant,
  NiceServant,
  Region,
} from "../src/types.js";

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), "utf8");
}

function servant(collectionNo: number): NiceServant {
  return {
    id: collectionNo * 100,
    collectionNo,
    profile: {},
    skills: [
      {
        id: 100,
        functions: [{ funcId: 300, buffs: [{ id: 400 }] }],
      },
    ],
    classPassive: [{ id: 101, functions: [] }],
    extraPassive: [{ id: 102, functions: [] }],
    appendPassive: [{ id: 103, functions: [] }],
    noblePhantasms: [
      {
        id: 200,
        functions: [{ funcId: 301, buffs: [{ id: 401 }] }],
      },
    ],
  };
}

test("compacts servant responses without losing cache consumers' fields", () => {
  const compacted = compactServant({
    id: 100,
    collectionNo: 1,
    name: "test",
    traits: [{ id: 304, name: "alignmentEvil" }, { id: 203, name: "attributeStar" }],
    profile: {
      lore: { huge: "discard" },
      costume: {
        "10": { id: 3, battleCharaId: 10, name: "costume", unused: "discard" },
      },
    },
    extraAssets: {
      commands: { ascension: { "1": "command-url" } },
      charaGraph: { costume: { "10": "graph-url" } },
      image: { "1": "discard" },
    } as NiceServant["extraAssets"] & Record<string, unknown>,
    skills: [
      {
        id: 200,
        num: 1,
        name: "skill",
        detail: "detail",
        icon: "skill.png",
        functions: [
          {
            funcId: 300,
            funcTargetType: "ptOne",
            buffs: [{ id: 400, ignored: true }],
            svals: [{ ActSet: 2, ignored: true }],
            ignored: true,
          },
        ],
        skillSvts: [
          {
            releaseConditions: [
              { condType: "equipWithTargetCostume", condTargetId: 100, condNum: 3, ignored: true },
            ],
          },
        ],
        script: { SkillRankUp: { "200": [201] }, ignored: true },
      },
    ],
    noblePhantasms: [
      {
        id: 500,
        num: 1,
        name: "np",
        ruby: "ruby",
        card: "arts",
        npSvts: [{ releaseConditions: [{ condType: "equipWithTargetCostume", condNum: 3 }] }],
        script: {
          tdTypeChangeIDs: [500, 501],
          tdChangeByBattlePoint: [{ battlePointId: 1, phase: 2, noblePhantasmId: 501, ignored: true }],
        },
      },
    ],
    extraPassive: [{ id: 600, functions: [{ funcId: 700, buffs: [{ id: 800 }] }] }],
    ascensionAdd: {
      overWriteTDName: { ascension: { "3": "renamed" }, ignored: "discard" },
    },
    script: { SkillRankUp: { "200": [201] }, ignored: true },
  });

  assert.deepEqual(compacted, {
    id: 100,
    collectionNo: 1,
    name: "test",
    traits: [{ id: 304, name: "alignmentEvil" }, { id: 203, name: "attributeStar" }],
    profile: { costume: { "10": { id: 3, battleCharaId: 10, name: "costume" } } },
    extraAssets: {
      commands: { ascension: { "1": "command-url" } },
      charaGraph: { costume: { "10": "graph-url" } },
    },
    skills: [
      {
        id: 200,
        num: 1,
        name: "skill",
        detail: "detail",
        icon: "skill.png",
        targetingMode: "singleAlly",
        functions: [{ funcId: 300, funcTargetType: "ptOne", buffs: [{ id: 400 }], svals: [{ ActSet: 2 }] }],
        skillSvts: [{ releaseConditions: [{ condType: "equipWithTargetCostume", condTargetId: 100, condNum: 3 }] }],
        script: { SkillRankUp: { "200": [201] } },
      },
    ],
    noblePhantasms: [
      {
        id: 500,
        num: 1,
        name: "np",
        ruby: "ruby",
        card: "arts",
        npSvts: [{ releaseConditions: [{ condType: "equipWithTargetCostume", condNum: 3 }] }],
        script: {
          tdTypeChangeIDs: [500, 501],
          tdChangeByBattlePoint: [{ battlePointId: 1, phase: 2, noblePhantasmId: 501 }],
        },
      },
    ],
    ascensionAdd: { overWriteTDName: { ascension: { "3": "renamed" } } },
    script: { SkillRankUp: { "200": [201] } },
  });
});

test("parses JSONL and selects only the stored-to-target range", async () => {
  const records = parseChangeLog(await fixture("changes.log"));
  const range = selectChangeRange(records, "aaaaaa", "cccccc", "JP");

  assert.equal(records.length, 4);
  assert.equal(range.mode, "incremental");
  assert.deepEqual(
    range.records.map((record) => record.commit.slice(0, 6)),
    ["bbbbbb", "cccccc"],
  );
});

test("uses a full refresh for a missing cursor or rollback", async () => {
  const records = parseChangeLog(await fixture("changes.log"));
  assert.equal(selectChangeRange(records, "eeeeee", "cccccc").mode, "full");
  assert.equal(
    selectChangeRange(records, "dddddd", "cccccc").reason,
    "version_rollback",
  );
});

test("fails when the info target has not reached the change log", async () => {
  const records = parseChangeLog(await fixture("changes.log"));
  assert.throws(
    () => selectChangeRange(records, "aaaaaa", "eeeeee", "JP"),
    TargetDataVersionNotFoundError,
  );
});

test("rejects malformed change log records", () => {
  assert.throws(() => parseChangeLog("{not-json}"), /line 1/);
  assert.throws(
    () => parseChangeLog('{"commit":"a","timestamp":1,"changes":{}}'),
    /record on line 1/,
  );
});

test("maps skill, NP, function, and buff changes back to collection servants", async () => {
  const records = parseChangeLog(await fixture("changes.log"));
  const index = buildServantDependencyIndex([
    { collectionNo: 1, data: servant(1) },
    { collectionNo: 2, data: servant(2) },
  ]);
  const changed = collectChangedServantIds(
    records.slice(1, 3),
    index,
    new Set([1, 2]),
  );

  assert.deepEqual([...changed.direct], [1]);
  assert.deepEqual([...changed.dependency], [2]);
  assert.equal(changed.unassociatedEntities, 5);
  assert.deepEqual([...index.skill.get(100) ?? []].sort(), [1, 2]);
  assert.equal(index.skill.has(103), false);
  assert.deepEqual([...index.np.get(200) ?? []].sort(), [1, 2]);
  assert.deepEqual([...index.func.get(301) ?? []].sort(), [1, 2]);
  assert.deepEqual([...index.buff.get(401) ?? []].sort(), [1, 2]);
});

test("classifies valid, missing, and damaged servant caches", async () => {
  const root = await mkdtemp(join(tmpdir(), "mash-servant-cache-"));
  await mkdir(join(root, "1"), { recursive: true });
  await mkdir(join(root, "3"), { recursive: true });
  await writeFile(join(root, "1", "servant.json"), JSON.stringify(servant(1)));
  await writeFile(join(root, "1", "servant-raw.json"), JSON.stringify(servant(1)));
  await writeFile(join(root, "3", "servant.json"), "{broken");
  await writeFile(join(root, "3", "servant-raw.json"), JSON.stringify(servant(3)));

  const result = await inspectServantCache("JP", [1, 2, 3], root);
  assert.deepEqual(result.valid.map((entry) => entry.collectionNo), [1]);
  assert.deepEqual([...result.missing], [2]);
  assert.deepEqual([...result.invalid], [3]);
});

test("force refresh overwrites valid JSON while normal loading reuses it", async () => {
  const root = await mkdtemp(join(tmpdir(), "mash-servant-json-"));
  const path = join(root, "servant.json");
  await writeFile(path, JSON.stringify({ id: 1, profile: {}, name: "old" }));
  await writeFile(
    join(root, "servant-raw.json"),
    JSON.stringify({ id: 1, profile: { lore: "old raw" }, name: "old" }),
  );
  let calls = 0;
  const fetcher = async (): Promise<NiceServant> => {
    calls += 1;
    return { id: 1, profile: { lore: "new raw" }, name: "new", extraPassive: [{ id: 2 }] };
  };

  const cached = await loadOrFetchServant("test", "JP", 1, path, { fetcher });
  assert.equal(cached.refreshed, false);
  assert.equal(calls, 0);

  const refreshed = await loadOrFetchServant("test", "JP", 1, path, {
    fetcher,
    forceRefresh: true,
  });
  assert.equal(refreshed.refreshed, true);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    id: 1,
    name: "new",
    profile: {},
  });
  assert.deepEqual(JSON.parse(await readFile(join(root, "servant-raw.json"), "utf8")), {
    id: 1,
    profile: { lore: "new raw" },
    name: "new",
    extraPassive: [{ id: 2 }],
  });
});

test("old JP/CN compact caches missing traits or names rebuild from raw without a network refresh", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mash-servant-traits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "1"));
  for (const region of ["JP", "CN"] as const) {
    const stem = region === "JP" ? "servant" : "servant-cn";
    const compactPath = join(root, "1", `${stem}.json`);
    const raw = { ...servant(1), traits: [{ id: region === "JP" ? 304 : 203, name: "source name" }] };
    await writeFile(compactPath, JSON.stringify(compactServant(servant(1))));
    await writeFile(join(root, "1", `${stem}-raw.json`), JSON.stringify(raw));
    const before = await inspectServantCache(region, [1], root);
    assert.deepEqual([...before.missing], [1]);
    assert.equal(before.invalid.size, 0);
    const result = await loadOrFetchServant("test", region, 1, compactPath, {
      fetcher: async () => { throw new Error("should rebuild locally"); },
    });
    assert.equal(result.refreshed, false);
    assert.deepEqual(result.data.traits, [{ id: region === "JP" ? 304 : 203, name: "source name" }]);
    const after = await inspectServantCache(region, [1], root);
    assert.equal(after.missing.size, 0);
    assert.equal(after.valid.length, 1);
    await writeFile(compactPath, JSON.stringify({
      ...result.data, traits: result.data.traits?.map((trait) => ({ id: trait.id })),
    }));
    const idOnly = await inspectServantCache(region, [1], root);
    assert.deepEqual([...idOnly.missing], [1]);
    const named = await loadOrFetchServant("test", region, 1, compactPath, {
      fetcher: async () => { throw new Error("should restore names locally"); },
    });
    assert.equal(named.refreshed, false);
    assert.deepEqual(named.data.traits, raw.traits);
    assert.deepEqual(JSON.parse(await readFile(join(root, "1", `${stem}-raw.json`), "utf8")), raw);
  }
});

test("rebuilds a missing compact file from the raw cache without fetching", async () => {
  const root = await mkdtemp(join(tmpdir(), "mash-servant-rebuild-"));
  const path = join(root, "servant-cn.json");
  await writeFile(
    join(root, "servant-cn-raw.json"),
    JSON.stringify({ id: 1, name: "raw", profile: { lore: "kept only in raw" } }),
  );
  let calls = 0;

  const result = await loadOrFetchServant("test", "CN", 1, path, {
    fetcher: async () => {
      calls += 1;
      return { id: 1, profile: {} };
    },
  });

  assert.equal(result.refreshed, false);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    id: 1,
    name: "raw",
    profile: {},
  });
});

test("existing image paths are retained and only missing paths download", async () => {
  const root = await mkdtemp(join(tmpdir(), "mash-servant-images-"));
  const servantDir = join(root, "1");
  await mkdir(servantDir, { recursive: true });
  await writeFile(
    join(servantDir, "servant.json"),
    JSON.stringify({
      id: 1,
      profile: {},
      extraAssets: {
        commands: { ascension: { "1": "old-url", "2": "new-url" } },
      },
    }),
  );
  await writeFile(join(servantDir, "card_servant_1.png"), "existing");
  const downloads: string[] = [];

  const count = await downloadServantImages(1, {
    servantsDir: root,
    downloader: async (url, destination) => {
      downloads.push(url);
      await writeFile(destination, "downloaded");
    },
  });

  assert.equal(count, 1);
  assert.deepEqual(downloads, ["new-url"]);
  assert.equal(
    await readFile(join(servantDir, "card_servant_1.png"), "utf8"),
    "existing",
  );
});

test("writes the version state atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "mash-data-version-"));
  const path = join(root, "data-version.json");
  const versions: AtlasDataVersions = {
    JP: { hash: "aaaaaa", timestamp: 100 },
    CN: { hash: "bbbbbb", timestamp: 200 },
  };

  await writeDataVersions(versions, path);
  assert.deepEqual(await readDataVersions(path), versions);
  assert.deepEqual(await readdir(root), ["data-version.json"]);
});

test("advances JP independently when CN JSON refresh fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "mash-region-version-"));
  const versionPath = join(root, "data-version.json");
  const oldVersions: AtlasDataVersions = {
    JP: { hash: "aaaaaa", timestamp: 100 },
    CN: { hash: "aaaaaa", timestamp: 100 },
  };
  const info = JSON.parse(await fixture("info.json")) as AtlasDataVersions;
  const changes = await fixture("changes.log");
  await writeDataVersions(oldVersions, versionPath);

  const basic = (region: Region): BasicServant[] => [
    {
      id: region === "JP" ? 100 : 200,
      collectionNo: 1,
      name: "test",
      type: "normal",
      rarity: 1,
      atkMax: 1,
      hpMax: 1,
      face: "",
    },
  ];

  await assert.rejects(
    downloadAllServants({
      dataVersionFile: versionPath,
      dependencies: {
        fetchVersions: async () => info,
        fetchBasic: async (region) => basic(region),
        fetchChanges: async () => changes,
        inspectCache: async () => ({
          valid: [{ collectionNo: 1, data: servant(1) }],
          missing: new Set(),
          invalid: new Set(),
        }),
        downloadJson: async (region) => {
          if (region === "CN") throw new Error("CN failed");
          return "downloaded";
        },
        downloadImages: async () => 0,
      },
    }),
    /CN failed/,
  );

  const written = await readDataVersions(versionPath);
  assert.equal(written.JP?.hash, "cccccc");
  assert.equal(written.CN?.hash, "aaaaaa");
});

test("image failures fail the update while preserving the JSON cursor semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "mash-image-failure-"));
  const versionPath = join(root, "data-version.json");
  const versions: AtlasDataVersions = {
    JP: { hash: "cccccc", timestamp: 300 },
    CN: { hash: "cccccc", timestamp: 300 },
  };
  await assert.rejects(downloadAllServants({
    dataVersionFile: versionPath,
    dependencies: {
      fetchVersions: async () => versions,
      readVersions: async () => ({}),
      fetchBasic: async () => [{ id: 1, collectionNo: 1 }] as BasicServant[],
      inspectCache: async () => ({ valid: [], missing: new Set(), invalid: new Set() }),
      downloadJson: async () => "downloaded",
      downloadImages: async () => { throw new Error("broken image download"); },
    },
  }), /1 servant image downloads failed/);
  const written = await readDataVersions(versionPath);
  assert.equal(written.JP?.hash, "cccccc");
  assert.equal(written.CN?.hash, "cccccc");
});

test("unchanged hashes skip Changes but still repair a missing cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "mash-unchanged-version-"));
  const versionPath = join(root, "data-version.json");
  const versions: AtlasDataVersions = {
    JP: { hash: "cccccc", timestamp: 300 },
    CN: { hash: "cccccc", timestamp: 300 },
  };
  await writeDataVersions(versions, versionPath);
  let changesCalls = 0;
  const downloaded: Region[] = [];

  await downloadAllServants({
    dataVersionFile: versionPath,
    dependencies: {
      fetchVersions: async () => versions,
      fetchBasic: async () => [
        {
          id: 1,
          collectionNo: 1,
          name: "test",
          type: "normal",
          rarity: 1,
          atkMax: 1,
          hpMax: 1,
          face: "",
        },
      ],
      fetchChanges: async () => {
        changesCalls += 1;
        return "";
      },
      inspectCache: async () => ({
        valid: [],
        missing: new Set([1]),
        invalid: new Set(),
      }),
      downloadJson: async (region) => {
        downloaded.push(region);
        return "downloaded";
      },
      downloadImages: async () => 0,
    },
  });

  assert.equal(changesCalls, 0);
  assert.deepEqual(downloaded, ["JP", "CN"]);
});

test("a missing version state forces every current servant JSON to refresh", async () => {
  const info = JSON.parse(await fixture("info.json")) as AtlasDataVersions;
  const downloaded: Array<[Region, number, boolean]> = [];
  let changesCalls = 0;
  let written: AtlasDataVersions = {};

  await downloadAllServants({
    dependencies: {
      fetchVersions: async () => info,
      fetchBasic: async () => [
        {
          id: 1,
          collectionNo: 1,
          name: "one",
          type: "normal",
          rarity: 1,
          atkMax: 1,
          hpMax: 1,
          face: "",
        },
        {
          id: 2,
          collectionNo: 2,
          name: "two",
          type: "normal",
          rarity: 1,
          atkMax: 1,
          hpMax: 1,
          face: "",
        },
      ],
      fetchChanges: async () => {
        changesCalls += 1;
        return "";
      },
      inspectCache: async () => ({
        valid: [
          { collectionNo: 1, data: servant(1) },
          { collectionNo: 2, data: servant(2) },
        ],
        missing: new Set(),
        invalid: new Set(),
      }),
      downloadJson: async (region, collectionNo, force) => {
        downloaded.push([region, collectionNo, force]);
        return "downloaded";
      },
      downloadImages: async () => 0,
      readVersions: async () => ({}),
      writeVersions: async (versions) => {
        written = structuredClone(versions);
      },
    },
  });

  assert.equal(changesCalls, 0);
  assert.equal(downloaded.length, 4);
  assert.ok(downloaded.every((entry) => entry[2]));
  assert.equal(written.JP?.hash, "cccccc");
  assert.equal(written.CN?.hash, "cccccc");
});

test("does not download or advance when the target hash is absent from Changes", async () => {
  const oldVersions: AtlasDataVersions = {
    JP: { hash: "aaaaaa", timestamp: 100 },
    CN: { hash: "aaaaaa", timestamp: 100 },
  };
  let downloads = 0;
  let writes = 0;

  await assert.rejects(
    downloadAllServants({
      dependencies: {
        fetchVersions: async () => ({
          JP: { hash: "eeeeee", timestamp: 500 },
          CN: { hash: "eeeeee", timestamp: 500 },
        }),
        fetchBasic: async () => [
          {
            id: 1,
            collectionNo: 1,
            name: "test",
            type: "normal",
            rarity: 1,
            atkMax: 1,
            hpMax: 1,
            face: "",
          },
        ],
        fetchChanges: async () => fixture("changes.log"),
        inspectCache: async () => ({
          valid: [{ collectionNo: 1, data: servant(1) }],
          missing: new Set(),
          invalid: new Set(),
        }),
        downloadJson: async () => {
          downloads += 1;
          return "downloaded";
        },
        downloadImages: async () => 0,
        readVersions: async () => oldVersions,
        writeVersions: async () => {
          writes += 1;
        },
      },
    }),
    /target data version eeeeee/,
  );

  assert.equal(downloads, 0);
  assert.equal(writes, 0);
});

test("trait projections retain separate ascension/costume lists and all addition conditions", () => {
  const base = [{ id: 201, name: "attributeEarth" }, { id: 303, name: "alignmentGood" }];
  const evil = [{ id: 304, name: "alignmentEvil" }];
  const conditional = {
    idx: 100, trait: [{ id: 2919, name: "bunnyServant", unused: "discard" }],
    limitCount: 3, condType: "questClear", condId: 123, condNum: 1,
    eventId: 456, startedAt: 1000, endedAt: 2000, unused: "discard",
  };
  const compact = compactServant({
    ...servant(1), traits: base, traitAdd: [conditional],
    ascensionAdd: {
      overWriteTDName: { ascension: { "3": "NP name" } },
      individuality: { ascension: { "0": [], "1": evil, "3": base }, costume: { "100130": evil } },
      unused: "discard",
    },
  });
  assert.deepEqual(compact.traits, base);
  assert.deepEqual(compact.ascensionAdd, {
    overWriteTDName: { ascension: { "3": "NP name" } },
    individuality: { ascension: { "0": [], "1": evil, "3": base }, costume: { "100130": evil } },
  });
  assert.deepEqual(compact.traitAdd, [{
    idx: 100, trait: [{ id: 2919, name: "bunnyServant" }],
    limitCount: 3, condType: "questClear", condId: 123, condNum: 1,
    eventId: 456, startedAt: 1000, endedAt: 2000,
  }]);
  assert.throws(() => compactServant({ ...servant(1), traitAdd: [{ trait: base } as never] }), /Invalid servant trait condition/);
  assert.throws(() => compactServant({ ...servant(1), ascensionAdd: { individuality: { ascension: { "3": null } } } }), /Invalid servant traits/);
});

test("named trait caches missing form overrides or additions are upgraded offline in JP and CN", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mash-servant-form-traits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "1"));
  for (const region of ["JP", "CN"] as const) {
    const stem = region === "JP" ? "servant" : "servant-cn";
    const path = join(root, "1", `${stem}.json`);
    const old = { ...servant(1), traits: [{ id: 201, name: "attributeEarth" }] };
    const raw = {
      ...old,
      ascensionAdd: { individuality: { ascension: { "3": [{ id: region === "JP" ? 304 : 203, name: "regional trait" }] }, costume: {} } },
      traitAdd: [{ idx: 1, trait: [{ id: 2919, name: "bunnyServant" }], limitCount: -1,
        condType: "none", condId: 0, condNum: 0, eventId: 456, startedAt: 1000, endedAt: 2000 }],
    };
    await writeFile(path, JSON.stringify(compactServant(old)));
    await writeFile(join(root, "1", `${stem}-raw.json`), JSON.stringify(raw));
    assert.deepEqual([...(await inspectServantCache(region, [1], root)).missing], [1]);
    const loaded = await loadOrFetchServant("test", region, 1, path, {
      fetcher: async () => { throw new Error("form traits must rebuild from raw"); },
    });
    assert.equal(loaded.refreshed, false);
    assert.deepEqual(loaded.data.traits, old.traits);
    assert.deepEqual(loaded.data.ascensionAdd, raw.ascensionAdd);
    assert.deepEqual(loaded.data.traitAdd, raw.traitAdd);
    assert.equal((await inspectServantCache(region, [1], root)).valid.length, 1);
    const missingAddition = { ...loaded.data };
    delete missingAddition.traitAdd;
    await writeFile(path, JSON.stringify(missingAddition));
    assert.deepEqual([...(await inspectServantCache(region, [1], root)).missing], [1]);
  }
});
