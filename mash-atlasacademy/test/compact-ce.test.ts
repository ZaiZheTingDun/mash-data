import "./setup-data-root.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { compactCraftEssence, craftEssenceSummary } from "../src/compact-ce.js";
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
    condLimitCount: 0,
    detail: "This name alone is not an event association",
    skillSvts: [{ svtId: 9409530, eventId: 80627 }, { svtId: 999, eventId: 999 }],
    extraPassive: [{ eventId: 80628, script: { otherValidEventId: 80629 } }],
    functions: [{ funcId: 1, funcType: "eventPointUp", funcGroup: [{ eventId: 80627 }, { eventId: 0 }],
      svals: [{ EventId: 80628, RateCount: 100 }], followerVals: [{ EventId: 80630, RateCount: 100 }],
    }],
  }] });
  assert.deepEqual(compactCraftEssence(raw, [{ id: 80627, name: "Original" }, { id: 80628, name: "Rerun" }]).events, [
    { id: 80627, name: "Original" }, { id: 80628, name: "Rerun" },
    { id: 80629, name: null }, { id: 80630, name: null },
  ]);
  assert.deepEqual(compactCraftEssence(equip(551, { flags: ["svtEquipEvent"] })).events, []);
});

test("event bonuses preserve material, point and damage values by event and limit break", () => {
  const raw = equip(100, { skills: [
    { id: 1, condLimitCount: 0, detail: "event material +1", skillSvts: [{ svtId: 9400100, eventId: 80001 }],
      functions: [{ funcId: 10, funcType: "eventDropUp", svals: [{ Individuality: 123, EventId: 80001, AddCount: 1 }],
        funcGroup: [{ eventId: 80001, name: "drop", icon: "item.png" }, { eventId: 80002, name: "old display" }] }] },
    { id: 2, condLimitCount: 4, detail: "event material +2", skillSvts: [{ svtId: 9400100, eventId: 80001 }],
      functions: [{ funcId: 10, funcType: "eventDropUp", svals: [{ Individuality: 123, EventId: 80001, AddCount: 2 }],
        funcGroup: [{ eventId: 80001, name: "drop", icon: "item.png" }] }] },
    { id: 3, condLimitCount: 0, skillSvts: [{ svtId: 9400100, eventId: 80002 }],
      functions: [{ funcId: 11, funcType: "eventPointUp", svals: [{ Individuality: 456, EventId: 80002, RateCount: 300 }],
        funcGroup: [{ eventId: 80002, name: "points" }] }] },
    { id: 4, condLimitCount: 0, skillSvts: [{ svtId: 9400100, eventId: 80002 }],
      functions: [{ funcId: 12, funcType: "addStateShort", svals: [{ Value: 1000 }],
        buffs: [{ type: "upDamage" }], funcGroup: [{ eventId: 80002, name: "attack" }] }] },
  ] });
  const bonuses = compactCraftEssence(raw).eventBonuses;
  assert.deepEqual(bonuses.map(({ eventId, type, limitBreak, targetId, flat, percent }) =>
    [eventId, type, limitBreak, targetId, flat, percent]), [
    [80001, "dropCount", 0, 123, 1, null],
    [80001, "dropCount", 4, 123, 2, null],
    [80002, "points", 0, 456, null, 30],
    [80002, "damage", 0, null, null, 100],
  ]);
  assert.equal(bonuses[0]?.group?.icon, "item.png");
  assert.equal(bonuses.some((bonus) => bonus.eventId === 80002 && bonus.type === "dropCount"), false);
});

test("event bonus supports percentage drops and variable event-point damage", () => {
  const raw = equip(101, { skills: [{ id: 1, condLimitCount: 0, functions: [
    { funcId: 1, funcType: "eventDropUp", svals: [{ EventId: 80001, RateCount: 1200 }] },
    { funcId: 2, funcType: "addStateShort", svals: [{ Value: 0 }],
      buffs: [{ type: "upDamageEventPoint" }], funcGroup: [{ eventId: 80001 }] },
  ] }] });
  const bonuses = compactCraftEssence(raw).eventBonuses;
  assert.deepEqual(bonuses.map(({ type, percent, dynamic }) => [type, percent, dynamic]), [
    ["dropAmountPercent", 120, false], ["damage", null, true],
  ]);
});

test("CE summary keeps searchable event values while detail stays in the per-CE file", () => {
  const raw = equip(2440, { skills: [{
    id: 994969, condLimitCount: 4, detail: "event quest damage +30%",
    skillSvts: [{ svtId: 9402440, eventId: 80559 }],
    functions: [{ funcId: 22839, funcType: "addStateShort", svals: [{ Value: 300 }],
      buffs: [{ type: "upDamage" }], funcquestTvals: [{ id: 94000176 }],
      funcGroup: [{ eventId: 80559, name: "attack bonus", icon: "effect.png", priority: 300 }],
    }],
  }] });
  const full = compactCraftEssence(raw);
  const summary = craftEssenceSummary(full).eventBonuses[0]!;
  assert.equal(summary.percent, 30);
  assert.equal(summary.eventId, 80559);
  assert.equal(summary.limitBreak, 4);
  assert.equal("group" in summary, false);
  assert.equal("detail" in summary, false);
  assert.equal("conditions" in summary, false);
  assert.equal(full.eventBonuses[0]?.detail, "event quest damage +30%");
  assert.equal(full.eventBonuses[0]?.group?.icon, "effect.png");
  assert.deepEqual((full.eventBonuses[0]?.conditions.function as Record<string, unknown>).funcquestTvals, [{ id: 94000176 }]);
});

test("CE summary keeps bond values and their value conditions without display metadata", () => {
  const full = compactCraftEssence(equip(330, { skills: [bondSkill(990554, 0, 20, 30)] }));
  const bonus = craftEssenceSummary(full).bondBonuses[0]!;
  assert.equal(bonus.values[0]?.percent, 2);
  assert.equal(bonus.supportValues?.[0]?.percent, 3);
  assert.equal("detail" in bonus, false);
  assert.equal("conditions" in bonus, false);
  assert.ok(full.bondBonuses[0]?.conditions);
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


test("QP bonuses preserve normal, MLB, support and flat values without treating other rewards as QP", () => {
  const qpSkill = (id: number, limitBreak: number, rate: number, support: number) => ({
    ...bondSkill(id, limitBreak, rate, support),
    detail: "QP drop bonus",
    functions: [{ funcId: 98, funcType: "qpDropUp", svals: [{ RateCount: rate }], followerVals: [{ RateCount: support }] }],
  });
  const full = compactCraftEssence(equip(988, { skills: [
    qpSkill(1, 0, 10, 30), qpSkill(2, 4, 50, 150),
    { id: 3, condLimitCount: 0, detail: "QP +2025", functions: [{ funcId: 91, funcType: "qpUp", svals: [{ AddCount: 2025 }] }] },
    bondSkill(4, 0, 20),
  ] }));
  assert.equal(full.qpBonuses.length, 3);
  assert.equal(full.bondBonuses.length, 1);
  assert.deepEqual(full.qpBonuses.slice(0, 2).map((bonus) => [bonus.limitBreak, bonus.values[0]?.percent, bonus.supportValues?.[0]?.percent]), [
    [0, 1, 3], [4, 5, 15],
  ]);
  assert.equal(full.qpBonuses[2]?.values[0]?.flat, 2025);
  assert.equal(full.qpBonuses[2]?.values[0]?.percent, null);
  const summary = craftEssenceSummary(full).qpBonuses[1]!;
  assert.equal(summary.values[0]?.percent, 5);
  assert.equal(summary.supportValues?.[0]?.percent, 15);
  assert.equal("detail" in summary, false);
  assert.equal("conditions" in summary, false);
  assert.equal(full.qpBonuses[1]?.detail, "QP drop bonus");
});

test("QP value conditions retain event restrictions and malformed values fail extraction", () => {
  const full = compactCraftEssence(equip(1, { skills: [{ id: 1, condLimitCount: 4,
    functions: [{ funcId: 98, funcType: "qpDropUp", svals: [{ RateCount: 125, EventId: 80627 }] }],
  }] }));
  assert.deepEqual(full.qpBonuses[0]?.values, [{ percent: 12.5, flat: null, conditions: { EventId: 80627 } }]);
  assert.deepEqual(full.events, [{ id: 80627, name: null }]);
  const broken = equip(1, { skills: [{ id: 1, condLimitCount: 0,
    functions: [{ funcId: 98, funcType: "qpDropUp", svals: [{}] }],
  }] });
  assert.throws(() => compactCraftEssence(broken), /no RateCount or AddCount/);
  assert.deepEqual(compactCraftEssence(equip(1)).qpBonuses, []);
});


test("master EXP preserves percentages, fixed amounts and MLB variants without mixing mystic-code EXP", () => {
  const raw = equip(1, { skills: [
    { id: 1, condLimitCount: 0, functions: [{ funcId: 90, funcType: "expUp", svals: [{ RateCount: 20 }] }] },
    { id: 2, condLimitCount: 4, detail: "master EXP", functions: [{ funcId: 90, funcType: "expUp", svals: [{ RateCount: 100, EventId: 2 }], followerVals: [{ RateCount: 150, EventId: 2 }] }] },
    { id: 3, condLimitCount: 0, functions: [{ funcId: 90, funcType: "expUp", svals: [{ AddCount: 50 }] }] },
    { id: 4, condLimitCount: 0, functions: [{ funcId: 96, funcType: "userEquipExpUp", svals: [{ AddCount: 50 }] }] },
  ] });
  const full = compactCraftEssence(raw);
  assert.deepEqual(full.masterExpBonuses?.map(b => [b.limitBreak, b.values[0]?.percent, b.values[0]?.flat]), [
    [0, 2, null], [4, 10, null], [0, null, 50],
  ]);
  assert.equal(full.masterExpBonuses?.[1]?.supportValues?.[0]?.percent, 15);
  assert.deepEqual(full.masterExpBonuses?.[1]?.values[0]?.conditions, { EventId: 2 });
  assert.deepEqual(full.bondBonuses, []);
  assert.deepEqual(full.qpBonuses, []);
  const summary = craftEssenceSummary(full).masterExpBonuses!;
  assert.equal(summary.length, 3);
  assert.equal("detail" in summary[1]!, false);
  assert.equal("conditions" in summary[1]!, false);
  assert.deepEqual(compactCraftEssence(equip(2)).masterExpBonuses, undefined);
});


test("mystic-code EXP preserves its own percentages, fixed amounts, support and conditions", () => {
  const full = compactCraftEssence(equip(1, { skills: [
    { id: 1, condLimitCount: 0, functions: [{ funcId: 96, funcType: "userEquipExpUp", svals: [{ RateCount: 20 }] }] },
    { id: 2, condLimitCount: 4, detail: "mystic-code EXP", functions: [{ funcId: 96, funcType: "userEquipExpUp", svals: [{ RateCount: 100, EventId: 2 }], followerVals: [{ RateCount: 150, EventId: 2 }] }] },
    { id: 3, condLimitCount: 0, functions: [{ funcId: 96, funcType: "userEquipExpUp", svals: [{ AddCount: 50 }] }] },
    { id: 4, condLimitCount: 0, functions: [{ funcId: 90, funcType: "expUp", svals: [{ AddCount: 20 }] }] },
  ] }));
  assert.deepEqual(full.mysticCodeExpBonuses?.map(b => [b.limitBreak, b.values[0]?.percent, b.values[0]?.flat]), [
    [0, 2, null], [4, 10, null], [0, null, 50],
  ]);
  assert.equal(full.mysticCodeExpBonuses?.[1]?.supportValues?.[0]?.percent, 15);
  assert.deepEqual(full.mysticCodeExpBonuses?.[1]?.values[0]?.conditions, { EventId: 2 });
  assert.equal(full.masterExpBonuses?.length, 1);
  assert.equal(full.masterExpBonuses?.[0]?.values[0]?.flat, 20);
  const summary = craftEssenceSummary(full).mysticCodeExpBonuses!;
  assert.equal(summary.length, 3);
  assert.equal("detail" in summary[1]!, false);
  assert.equal("conditions" in summary[1]!, false);
  assert.equal(compactCraftEssence(equip(2)).mysticCodeExpBonuses, undefined);
});


test("friend points preserve stacking type, fixed values, MLB, support and event conditions", () => {
  const full = compactCraftEssence(equip(36, { skills: [
    { id: 1, condLimitCount: 0, functions: [{ funcId: 93, funcType: "friendPointUp", svals: [{ AddCount: 75 }] }] },
    { id: 2, condLimitCount: 0, functions: [{ funcId: 5607, funcType: "friendPointUpDuplicate", svals: [{ AddCount: 5 }] }] },
    { id: 3, condLimitCount: 4, detail: "stackable points", functions: [{ funcId: 5607, funcType: "friendPointUpDuplicate", svals: [{ AddCount: 25, EventId: 2 }], followerVals: [{ AddCount: 30, EventId: 2 }] }] },
    { id: 4, condLimitCount: 4, functions: [{ funcId: 5136, funcType: "servantFriendshipUp", svals: [{ RateCount: 100 }] }] },
  ] }));
  assert.deepEqual(full.friendPointBonuses?.map(b => [b.functionType, b.limitBreak, b.values[0]?.flat]), [
    ["friendPointUp", 0, 75], ["friendPointUpDuplicate", 0, 5], ["friendPointUpDuplicate", 4, 25],
  ]);
  assert.equal(full.friendPointBonuses?.[2]?.supportValues?.[0]?.flat, 30);
  assert.deepEqual(full.friendPointBonuses?.[2]?.values[0]?.conditions, { EventId: 2 });
  assert.equal(full.bondBonuses.length, 1);
  const summary = craftEssenceSummary(full).friendPointBonuses!;
  assert.equal(summary[2]?.functionType, "friendPointUpDuplicate");
  assert.equal("detail" in summary[2]!, false);
  assert.equal("conditions" in summary[2]!, false);
  assert.equal(compactCraftEssence(equip(2)).friendPointBonuses, undefined);
});
