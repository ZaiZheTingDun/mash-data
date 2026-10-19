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
