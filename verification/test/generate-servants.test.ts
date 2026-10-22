import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

test("resource generation keeps the greatest ID for same-name Noble Phantasms", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "mash-servants-"));
  const servantsDir = path.join(fixtureRoot, "servants");
  const servantDir = path.join(servantsDir, "175");
  const outputPath = path.join(fixtureRoot, "servants.json");

  try {
    await mkdir(servantDir, { recursive: true });
    const servant = {
      id: 503200,
      collectionNo: 175,
      name: "ネロ・クラウディウス",
      classId: 5,
      className: "caster",
      type: "normal",
      rarity: 5,
      noblePhantasms: [
        {
          id: 503202,
          name: "誉れ歌う黄金劇場",
          ruby: "Lauda Lentum Domus Illustrius",
          card: "2",
        },
        {
          id: 503201,
          name: "誉れ歌う黄金劇場",
          ruby: "Lauda Lentum Domus Illustrius",
          card: "2",
        },
      ],
    };
    const cnServant = {
      ...servant,
      name: "尼禄·克劳狄乌斯",
      noblePhantasms: servant.noblePhantasms.map((np) => ({
        ...np,
        name: "讴歌荣耀的黄金剧场",
      })),
    };

    await Promise.all([
      writeFile(
        path.join(servantDir, "servant.json"),
        JSON.stringify(servant),
        "utf8",
      ),
      writeFile(
        path.join(servantDir, "servant-cn.json"),
        JSON.stringify(cnServant),
        "utf8",
      ),
    ]);

    await execFileAsync(
      process.execPath,
      [
        path.join(repoRoot, "scripts/generate-servants.ts"),
        outputPath,
        servantsDir,
      ],
      { cwd: repoRoot },
    );

    const generated = JSON.parse(await readFile(outputPath, "utf8")) as Array<{
      collectionNo: number;
      noblePhantasms: Array<{ id: number }>;
    }>;
    assert.deepEqual(
      generated[0]?.noblePhantasms.map((np) => np.id),
      [503202],
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("resource generation includes ascension-overridden Noble Phantasm names", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "mash-servants-"));
  const servantsDir = path.join(fixtureRoot, "servants");
  const servantDir = path.join(servantsDir, "418");
  const outputPath = path.join(fixtureRoot, "servants.json");

  try {
    await mkdir(servantDir, { recursive: true });
    const servant = {
      id: 2300900,
      collectionNo: 418,
      name: "謎の代行者C.I.E.L",
      classId: 23,
      className: "moonCancer",
      type: "normal",
      rarity: 5,
      noblePhantasms: [
        {
          id: 2300901,
          name: "第七聖典・断罪死",
          ruby: "コード：オリジナル・シン",
          card: "2",
        },
      ],
      ascensionAdd: {
        overWriteTDName: {
          ascension: { "3": "原理血戒・断頭台", "4": "原理血戒・断頭台" },
        },
        overWriteTDRuby: {
          ascension: { "3": "カルヴァリア・ガルガリン", "4": "カルヴァリア・ガルガリン" },
        },
      },
    };
    const cnServant = {
      ...servant,
      name: "谜之代行者C.I.E.L",
      noblePhantasms: [
        {
          ...servant.noblePhantasms[0],
          name: "第七圣典·断罪死",
          ruby: "Code：Original Sin",
        },
      ],
      ascensionAdd: {
        overWriteTDName: {
          ascension: { "3": "原理血戒·断头台", "4": "原理血戒·断头台" },
        },
        overWriteTDRuby: {
          ascension: { "3": "Calvaria Galgalim", "4": "Calvaria Galgalim" },
        },
      },
    };

    await Promise.all([
      writeFile(
        path.join(servantDir, "servant.json"),
        JSON.stringify(servant),
        "utf8",
      ),
      writeFile(
        path.join(servantDir, "servant-cn.json"),
        JSON.stringify(cnServant),
        "utf8",
      ),
    ]);

    await execFileAsync(
      process.execPath,
      [
        path.join(repoRoot, "scripts/generate-servants.ts"),
        outputPath,
        servantsDir,
      ],
      { cwd: repoRoot },
    );

    const generated = JSON.parse(await readFile(outputPath, "utf8")) as Array<{
      noblePhantasms: Array<{
        id: number;
        name: string;
        nameJP: string;
        nameCN: string;
      }>;
    }>;
    assert.deepEqual(generated[0]?.noblePhantasms, [
      {
        id: 2300901,
        name: "Code：Original Sin",
        nameJP: "第七聖典・断罪死",
        nameCN: "第七圣典·断罪死",
        card: "2",
        cardName: "buster",
      },
      {
        id: 2300901,
        name: "Calvaria Galgalim",
        nameJP: "原理血戒・断頭台",
        nameCN: "原理血戒·断头台",
        card: "2",
        cardName: "buster",
      },
    ]);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("resource servants use one record per line, preserving empty traits and missing CN", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mash-servant-traits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const servantsDir = path.join(root, "servants");
  const output = path.join(root, "servants.json");
  for (const collectionNo of [1, 2, 3]) {
    const dir = path.join(servantsDir, String(collectionNo));
    await mkdir(dir, { recursive: true });
    const base = { id: collectionNo * 100, collectionNo, name: "test", rarity: 5, noblePhantasms: [] };
    await writeFile(path.join(dir, "servant.json"), JSON.stringify({
      ...base, traits: collectionNo === 3 ? [] : [
        { id: 304, name: "alignmentEvil" }, { id: 203, name: "attributeStar" }, { id: 304, name: "alignmentEvil" },
      ],
    }));
    if (collectionNo === 1) await writeFile(path.join(dir, "servant-cn.json"), JSON.stringify({
      ...base, traits: [{ id: 203, name: "CN source trait" }],
    }));
  }
  await execFileAsync(process.execPath, [path.join(repoRoot, "scripts/generate-servants.ts"), output, servantsDir], { cwd: repoRoot });
  const text = await readFile(output, "utf8");
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, 5);
  for (const line of lines.slice(1, -1)) assert.doesNotThrow(() => JSON.parse(line.replace(/,$/, "")));
  assert.ok(text.endsWith("\n"));
  assert.ok(text.includes('"JP":[203,304]'));
  assert.ok(text.includes('"CN":[203]'));
  const generated = JSON.parse(text);
  assert.ok(Array.isArray(generated));
  assert.ok(generated.every((entry: Record<string, unknown>) => !Object.hasOwn(entry, "traitIds")));
  const jp = [203, 304];
  assert.deepEqual(generated.map((entry: { traits: unknown }) => entry.traits), [
    { JP: jp, CN: [203] },
    { JP: jp, CN: null },
    { JP: [], CN: null },
  ]);
});

test("resource form trait overrides retain source numbering and conditional additions without merging into base", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mash-form-traits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const servantsDir = path.join(root, "servants");
  const output = path.join(root, "servants.json");
  const base = [{ id: 201, name: "attributeEarth" }];
  const evil = [{ id: 304, name: "alignmentEvil" }];
  const star = [{ id: 203, name: "attributeStar" }];
  const jpOverrides = { ascension: { "0": [], "1": evil, "3": base }, costume: { "100130": star } };
  const cnOverrides = { ascension: { "3": star }, costume: {} };
  const conditional = { idx: 1, trait: [{ id: 2919, name: "bunnyServant" }], limitCount: 11,
    condType: "questClear", condId: 123, condNum: 1, eventId: 456, startedAt: 1000, endedAt: 2000 };
  for (const collectionNo of [1, 2, 3]) {
    const dir = path.join(servantsDir, String(collectionNo));
    await mkdir(dir, { recursive: true });
    const common = { id: collectionNo * 100, collectionNo, name: "test", rarity: 5, traits: base, noblePhantasms: [] };
    await writeFile(path.join(dir, "servant.json"), JSON.stringify({
      ...common,
      ...(collectionNo === 1 ? {
        ascensionAdd: { individuality: jpOverrides }, traitAdd: [conditional],
        profile: { costume: { "100130": { id: 11, battleCharaId: 100130 } } },
      } : collectionNo === 2 ? { ascensionAdd: { individuality: { ascension: {}, costume: {} } }, traitAdd: [] } : {}),
    }));
    if (collectionNo === 1) await writeFile(path.join(dir, "servant-cn.json"), JSON.stringify({
      ...common, ascensionAdd: { individuality: cnOverrides }, traitAdd: [],
    }));
  }
  await execFileAsync(process.execPath, [path.join(repoRoot, "scripts/generate-servants.ts"), output, servantsDir], { cwd: repoRoot });
  const text = await readFile(output, "utf8");
  assert.ok(text.includes('"1":[304]'));
  assert.ok(text.includes('"100130":[203]'));
  assert.ok(text.includes('"trait":[2919]'));
  const generated = JSON.parse(text);
  assert.deepEqual(generated.map((entry: { traits: { JP: unknown } }) => entry.traits.JP), [[201], [201], [201]]);
  assert.deepEqual(generated.map((entry: { traitOverrides: unknown }) => entry.traitOverrides), [
    { JP: { ascension: { "0": [], "1": [304], "3": [201] }, costume: { "100130": [203] } },
      CN: { ascension: { "3": [203] }, costume: {} } },
    { JP: { ascension: {}, costume: {} }, CN: null },
    { JP: null, CN: null },
  ]);
  assert.deepEqual(generated.map((entry: { traitAdd: unknown }) => entry.traitAdd), [
    { JP: [{ ...conditional, trait: [2919] }], CN: [] },
    { JP: [], CN: null },
    { JP: null, CN: null },
  ]);
});
