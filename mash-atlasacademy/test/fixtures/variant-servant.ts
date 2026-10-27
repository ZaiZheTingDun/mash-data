import type { buildServantVariants } from "../../src/build-variants.js";

export const formConditions = (condNum: number) => [{
  condType: "equipWithTargetCostume",
  condTargetId: 306200,
  condNum,
}];

// Minimal Elizabeth (457) input: only the NP changes for ascensions 3 and 4.
export function npOnlyVariantServant(): Parameters<typeof buildServantVariants>[0] {
  return {
    id: 306200,
    collectionNo: 457,
    extraAssets: {
      charaGraph: {
        ascension: { "1": "one", "2": "two", "3": "three", "4": "four" },
      },
    },
    skills: [
      { id: 2570650, num: 1, name: "Shared 1", skillSvts: [{ releaseConditions: [] }] },
      { id: 2571650, num: 2, name: "Shared 2", skillSvts: [{ releaseConditions: [] }] },
      { id: 2572550, num: 3, name: "Shared 3", skillSvts: [{ releaseConditions: [] }] },
    ],
    noblePhantasms: [
      { id: 306201, num: 1, name: "Default NP", npSvts: [{ releaseConditions: [] }] },
      { id: 306202, num: 1, name: "Special NP", npSvts: [{ releaseConditions: formConditions(3) }] },
    ],
  };
}
