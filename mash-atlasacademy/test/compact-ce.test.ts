import "./setup-data-root.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { compactCraftEssence } from "../src/compact-ce.js";
import { buildCraftEssenceOwnerIndex, type CombinedCraftEssence } from "../src/combine-ces.js";
import { bondSkill, equip } from "./fixtures/ces.js";

// Values/IDs correspond to Atlas Lunch Time, Teatime and Castle of Snow.
test("bond CE ownership does not imply a bond point bonus; valentine ownership is independent", () => {
  const snow = compactCraftEssence(equip(197, {
    id: 9300070, name: "雪の城", bondEquipOwner: 700100,
    skills: [{ id: 990347, functions: [{ funcId: 292, funcType: "addState", svals: [{ Value: 500 }] }] }],
  }));
  assert.equal(snow.bondEquipOwner, 700100);
  assert.deepEqual(snow.bondBonuses, []);
  assert.equal(snow.valentineEquipOwner, null);
  assert.equal("skills" in snow, false);
  assert.equal("profile" in snow, false);
  assert.equal(snow.face, "https://example.com/EquipFaces/f_93000700.png");
  const valentine = compactCraftEssence(equip(113, { id: 9800700, valentineEquipOwner: 800100 }));
  assert.equal(valentine.valentineEquipOwner, 800100);
  assert.equal(valentine.bondEquipOwner, null);
});

test("Lunch Time preserves normal and MLB percentages; Teatime preserves separate support values", () => {
  const lunch = compactCraftEssence(equip(330, {
    id: 9401970, skills: [bondSkill(990554, 0, 20), bondSkill(990555, 4, 100)],
  }));
  assert.deepEqual(lunch.bondBonuses.map((bonus) => [bonus.limitBreak, bonus.values[0]?.percent, bonus.supportValues]), [
    [0, 2, null], [4, 10, null],
  ]);
  const tea = compactCraftEssence(equip(910, {
    id: 9403520, skills: [bondSkill(991520, 0, 10, 30), bondSkill(991521, 4, 50, 150)],
  }));
  assert.deepEqual(tea.bondBonuses.map((bonus) => [bonus.limitBreak, bonus.values[0]?.percent, bonus.supportValues?.[0]?.percent]), [
    [0, 1, 3], [4, 5, 15],
  ]);
});

test("conditional and flat bonuses retain source conditions and every value", () => {
  const skill = bondSkill(100, 4, 50);
  const f = skill.functions[0]!;
  const raw = equip(1, { skills: [{
    ...skill, condQuestId: 123,
    functions: [{ ...f, functvals: [{ id: 200 }], funcquestTvals: [{ id: 300 }],
      svals: [{ AddCount: 50, Individuality: 201, EventId: 80627 }, { RateCount: 125, Individuality: 202 }],
      followerVals: [{ AddCount: 100, Individuality: 201 }],
    }],
  }] });
  const bonus = compactCraftEssence(raw).bondBonuses[0]!;
  assert.deepEqual(bonus.values, [
    { percent: null, flat: 50, conditions: { Individuality: 201, EventId: 80627 } },
    { percent: 12.5, flat: null, conditions: { Individuality: 202 } },
  ]);
  assert.equal(bonus.supportValues?.[0]?.flat, 100);
  assert.equal((bonus.conditions.skill as Record<string, unknown>).condQuestId, 123);
  assert.deepEqual((bonus.conditions.function as Record<string, unknown>).functvals, [{ id: 200 }]);
});

test("events come only from explicit IDs, include reruns and all value sources, and ignore other CE bindings", () => {
  const raw = equip(2705, { id: 9409530, skills: [{
    id: 995449,
    detail: "This name alone is not an event association",
    skillSvts: [{ svtId: 9409530, eventId: 80627 }, { svtId: 999, eventId: 999 }],
    extraPassive: [{ eventId: 80628, script: { otherValidEventId: 80629 } }],
    functions: [{ funcType: "eventPointUp", funcGroup: [{ eventId: 80627 }, { eventId: 0 }],
      svals: [{ EventId: 80628 }], followerVals: [{ EventId: 80630 }],
    }],
  }] });
  assert.deepEqual(compactCraftEssence(raw, [{ id: 80627, name: "Original" }, { id: 80628, name: "Rerun" }]).events, [
    { id: 80627, name: "Original" }, { id: 80628, name: "Rerun" },
    { id: 80629, name: null }, { id: 80630, name: null },
  ]);
  assert.deepEqual(compactCraftEssence(equip(551, { flags: ["svtEquipEvent"] })).events, []);
});

test("owner index supports multiple Mash bond CEs and valentine CEs, using internal IDs", () => {
  const raws = [
    equip(1, { id: 9309050, bondEquipOwner: 800100 }),
    equip(2, { id: 9311670, bondEquipOwner: 800100 }),
    equip(3, { id: 9800700, valentineEquipOwner: 800100 }),
  ];
  const ces: CombinedCraftEssence[] = raws.map((raw) => ({
    id: raw.id, collectionNo: raw.collectionNo, name: raw.name, name_cn: null,
    rarity: raw.rarity, flag: null, flags: [], regions: { JP: compactCraftEssence(raw), CN: null },
  }));
  assert.deepEqual(buildCraftEssenceOwnerIndex(ces, "JP").get(800100), {
    bondEquipIds: [9309050, 9311670], valentineEquipIds: [9800700],
  });
  assert.equal(buildCraftEssenceOwnerIndex(ces, "CN").size, 0);
});

test("invalid full responses and unsupported bonus values fail instead of reporting no bonus", () => {
  assert.throws(() => compactCraftEssence({ id: 1, collectionNo: 1 } as never), /Invalid full/);
  const raw = equip(1, { skills: [{ ...bondSkill(1, 0, 50), functions: [{ funcId: 1, funcType: "servantFriendshipUp", svals: [{}] }] }] });
  assert.throws(() => compactCraftEssence(raw), /no RateCount or AddCount/);
});
