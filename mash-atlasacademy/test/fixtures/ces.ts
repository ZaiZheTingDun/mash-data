import type { NiceEquip } from "../../src/types.js";

export function equip(collectionNo = 330, overrides: Partial<NiceEquip> = {}): NiceEquip {
  const id = overrides.id ?? 9400000 + collectionNo;
  return {
    id, collectionNo, name: `CE ${collectionNo}`, rarity: 5,
    flags: [], type: "servantEquip", atkMax: 1000, hpMax: 1600,
    extraAssets: { faces: { equip: { [id]: `https://example.com/Faces/f_${id}0.png` } } },
    profile: { comments: [{ comment: "private lore" }] },
    skills: [], ...overrides,
  };
}

export function bondSkill(id: number, limitBreak: number, percentTenths: number, supportTenths?: number) {
  return {
    id, condLimitCount: limitBreak, detail: `bond skill ${id}`,
    skillSvts: [], extraPassive: [],
    functions: [{
      funcId: 5136, funcType: "servantFriendshipUp", funcTargetType: "ptFull",
      funcTargetTeam: "playerAndEnemy", functvals: [], funcquestTvals: [],
      svals: [{ Individuality: 0, RateCount: percentTenths }],
      ...(supportTenths === undefined ? {} : { followerVals: [{ Individuality: 0, RateCount: supportTenths }] }),
    }],
  };
}
