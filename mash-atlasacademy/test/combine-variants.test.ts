import "./setup-data-root.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { buildServantVariants, type ServantVariants } from "../src/build-variants.js";
import { combineServantVariants } from "../src/combine-variants.js";
import { writeJson } from "../src/fs-utils.js";
import { CATALOGS_DIR, SERVANTS_DIR, SKILLS_DIR } from "../src/paths.js";
import { formConditions, npOnlyVariantServant } from "./fixtures/variant-servant.js";

test("JP/CN combine follows inherited skills, preserves metadata and isolates replaced slots", async () => {
  for (const region of ["JP", "CN"] as const) {
    const servantFile = region === "JP" ? "servant.json" : "servant-cn.json";
    const variantsFile = region === "JP" ? "servant_variants.json" : "servant_variants_cn.json";
    const skillFile = region === "JP" ? "skill.json" : "skill_cn.json";

    for (const collectionNo of [457, 458]) {
      const source = npOnlyVariantServant();
      source.collectionNo = collectionNo;
      source.skills![0]!.targetingMode = "singleAllyIncludingSelf";
      if (collectionNo === 458) source.skills!.push({
        id: 9001, num: 1, name: `${region} exclusive`,
        skillSvts: [{ releaseConditions: formConditions(3) }],
      });
      await writeJson(join(SERVANTS_DIR, String(collectionNo), servantFile), {
        ...source,
        script: { SkillRankUp: { "2570650": [8001, 8001], ...(collectionNo === 458 ? { "9001": [9002] } : {}) } },
      });
      await writeJson(join(SERVANTS_DIR, String(collectionNo), variantsFile), buildServantVariants(source));
    }

    for (const id of [8001, 8002, 9002]) {
      await writeJson(join(SKILLS_DIR, String(id), skillFile), {
        id, name: `${region} runtime ${id}`, icon: `icon-${id}.png`,
        script: { SkillRankUp: id === 8001 ? { "8001": [8002] } : id === 8002 ? { "8002": [8001] } : {} },
      });
    }
  }

  await combineServantVariants();
  const outputs = ["servants_variants.json", "servants_variants_cn.json"];
  const before = await Promise.all(outputs.map((file) => readFile(join(CATALOGS_DIR, file), "utf8")));

  for (const [index, region] of ["JP", "CN"].entries()) {
    const [inherited, overridden] = JSON.parse(before[index]!) as ServantVariants[];
    assert.deepEqual(inherited?.variants.map(({ ids }) => ids), [[1, 2], [3, 4]]);
    const shared = [
      { id: 2570650, name: "Shared 1", targetingMode: "singleAllyIncludingSelf" },
      { id: 8001, name: `${region} runtime 8001`, runtime: true },
      { id: 8002, name: `${region} runtime 8002`, runtime: true },
    ];
    for (const variant of inherited!.variants) assert.deepEqual(variant.skills["1"], shared);
    assert.deepEqual(overridden?.variants[0]?.skills["1"], shared);
    assert.deepEqual(overridden?.variants[1]?.skills["1"], [
      { id: 9001, name: `${region} exclusive` },
      { id: 9002, name: `${region} runtime 9002`, runtime: true },
    ]);
    assert.deepEqual(overridden?.variants[1]?.skills["2"], [{ id: 2571650, name: "Shared 2" }]);
    assert.deepEqual(overridden?.variants[1]?.skills["3"], [{ id: 2572550, name: "Shared 3" }]);
  }

  await combineServantVariants();
  assert.deepEqual(await Promise.all(outputs.map((file) => readFile(join(CATALOGS_DIR, file), "utf8"))), before);
});
