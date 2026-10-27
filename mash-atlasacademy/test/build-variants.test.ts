import "./setup-data-root.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { buildServantVariants } from "../src/build-variants.js";
import { formConditions, npOnlyVariantServant } from "./fixtures/variant-servant.js";

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

test("Elizabeth 457 keeps all three shared skills when only the NP changes", () => {
  const result = buildServantVariants(npOnlyVariantServant());
  assert.deepEqual(result.variants, [
    {
      ids: [1, 2], noblePhantasms: ["Default NP"],
      skills: {
        "1": [{ id: 2570650, name: "Shared 1" }],
        "2": [{ id: 2571650, name: "Shared 2" }],
        "3": [{ id: 2572550, name: "Shared 3" }],
      },
    },
    {
      ids: [3, 4], noblePhantasms: ["Special NP"],
      skills: {
        "1": [{ id: 2570650, name: "Shared 1" }],
        "2": [{ id: 2571650, name: "Shared 2" }],
        "3": [{ id: 2572550, name: "Shared 3" }],
      },
    },
  ]);
});

test("a form-specific skill replaces only its own slot, even when it follows shared skills", () => {
  const data = npOnlyVariantServant();
  data.skills!.push({
    id: 9001, num: 2, name: "Special 2", targetingMode: "singleAllyIncludingSelf",
    skillSvts: [{ releaseConditions: formConditions(3) }],
  });
  const [base, special] = buildServantVariants(data).variants;
  assert.deepEqual(special?.skills, {
    "1": base?.skills["1"],
    "2": [{ id: 9001, name: "Special 2", targetingMode: "singleAllyIncludingSelf" }],
    "3": base?.skills["3"],
  });
  assert.deepEqual(base?.skills["2"], [{ id: 2571650, name: "Shared 2" }]);
});

test("multiple special forms inherit shared slots without borrowing each other's skills", () => {
  const data = npOnlyVariantServant();
  // Insert form 3 before form 1 to verify that component order stays stable.
  data.skills!.unshift(
    { id: 9003, num: 3, name: "Form 3 skill", skillSvts: [{ releaseConditions: formConditions(3) }] },
    { id: 9001, num: 1, name: "Form 1 skill", skillSvts: [{ releaseConditions: formConditions(1) }] },
  );
  const result = buildServantVariants(data);
  assert.deepEqual(result.variants.map(({ ids, noblePhantasms }) => ({ ids, noblePhantasms })), [
    { ids: [2], noblePhantasms: ["Default NP"] },
    { ids: [1], noblePhantasms: [] },
    { ids: [3, 4], noblePhantasms: ["Special NP"] },
  ]);
  assert.deepEqual(result.variants.map(({ skills }) => skills), [
    { "1": [{ id: 2570650, name: "Shared 1" }], "2": [{ id: 2571650, name: "Shared 2" }], "3": [{ id: 2572550, name: "Shared 3" }] },
    { "1": [{ id: 9001, name: "Form 1 skill" }], "2": [{ id: 2571650, name: "Shared 2" }], "3": [{ id: 2572550, name: "Shared 3" }] },
    { "1": [{ id: 2570650, name: "Shared 1" }], "2": [{ id: 2571650, name: "Shared 2" }], "3": [{ id: 9003, name: "Form 3 skill" }] },
  ]);
});

test("inherited rank-up versions keep source order, ID deduplication and targeting metadata", () => {
  const data = npOnlyVariantServant();
  data.skills = [
    { id: 200, num: 1, name: "Same name", targetingMode: "singleAllyIncludingSelf" },
    { id: 100, num: 1, name: "Same name", targetingMode: "Other", skillSvts: [{ releaseConditions: [] }] },
    { id: 200, num: 1, name: "Ignored duplicate", targetingMode: "Other" },
    { id: 300, num: 1, name: "Other form only", skillSvts: [{ releaseConditions: formConditions(1) }] },
  ];
  const variants = buildServantVariants(data).variants;
  const expected = [
    { id: 200, name: "Same name", targetingMode: "singleAllyIncludingSelf" },
    { id: 100, name: "Same name" },
  ];
  assert.deepEqual(variants[0]?.skills["1"], expected);
  assert.deepEqual(variants[2]?.skills, { "1": expected, "2": [], "3": [] });
  assert.deepEqual(variants[1]?.skills["1"], [{ id: 300, name: "Other form only" }]);
});

test("shared skills are inherited even when every form belongs to a special component", () => {
  const data = npOnlyVariantServant();
  data.extraAssets!.charaGraph!.ascension = { "3": "three", "4": "four" };
  const variants = buildServantVariants(data).variants;
  assert.equal(variants.length, 1);
  assert.deepEqual(variants[0]?.ids, [3, 4]);
  assert.deepEqual(variants[0]?.skills["1"], [{ id: 2570650, name: "Shared 1" }]);
});
