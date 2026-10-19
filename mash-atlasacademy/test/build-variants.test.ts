import "./setup-data-root.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { buildServantVariants } from "../src/build-variants.js";

test("keeps visible ascension-overridden Noble Phantasm names in one skill variant", () => {
  const result = buildServantVariants({
    id: 2300900,
    collectionNo: 418,
    extraAssets: {
      charaGraph: {
        ascension: { "1": "one", "2": "two", "3": "three", "4": "four" },
      },
    },
    noblePhantasms: [
      {
        id: 2300901,
        num: 1,
        name: "第七聖典・断罪死",
        npSvts: [{ releaseConditions: [] }],
      },
    ],
    ascensionAdd: {
      overWriteTDName: {
        ascension: { "3": "原理血戒・断頭台", "4": "原理血戒・断頭台" },
      },
    },
  });

  assert.deepEqual(result, {
    id: 418,
    variants: [
      {
        ids: [1, 2, 3, 4],
        noblePhantasms: ["第七聖典・断罪死", "原理血戒・断頭台"],
        skills: { "1": [], "2": [], "3": [] },
      },
    ],
  });
});

test("carries selectable targeting modes into variant skill metadata", () => {
  const result = buildServantVariants({
    id: 445,
    collectionNo: 445,
    extraAssets: {
      charaGraph: { ascension: { "1": "one" } },
    },
    skills: [
      { id: 2511650, num: 3, name: "公主的指令 EX", targetingMode: "singleAllyIncludingSelf" },
      { id: 2510550, num: 1, name: "胸部之袋 A", targetingMode: "Other" },
    ],
  });

  assert.deepEqual(result?.variants[0]?.skills["3"], [
    { id: 2511650, name: "公主的指令 EX", targetingMode: "singleAllyIncludingSelf" },
  ]);
  assert.deepEqual(result?.variants[0]?.skills["1"], [
    { id: 2510550, name: "胸部之袋 A" },
  ]);
});
