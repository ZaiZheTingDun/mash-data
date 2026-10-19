import "./setup-data-root.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { compactServant } from "../src/compact-servant.js";
import { classifySkillTargeting } from "../src/skill-targeting.js";

const selfTargetBranches = {
  condBranchSkillInfo: [
    { condType: "isSelfTarget", condValue: [0], skillId: 970731 },
    { condType: "isSelfTarget", condValue: [1], skillId: 970732 },
  ],
};

test("classifies the four selectable target modes and Other", () => {
  assert.equal(classifySkillTargeting({ functions: [{ funcTargetType: "ptOne" }] }), "singleAlly");
  assert.equal(
    classifySkillTargeting({ functions: [{ funcTargetType: "ptOneOther" }] }),
    "singleAllyExceptSelf",
  );
  assert.equal(
    classifySkillTargeting({
      functions: [{ funcTargetType: "ptOne" }, { funcTargetType: "ptOneOther" }],
    }),
    "mixed",
  );
  assert.equal(
    classifySkillTargeting({ functions: [], script: selfTargetBranches }),
    "singleAllyIncludingSelf",
  );
  assert.equal(classifySkillTargeting({ functions: [{ funcTargetType: "self" }] }), "Other");
  assert.equal(classifySkillTargeting({ functions: [] }), "Other");
  assert.equal(
    classifySkillTargeting({
      functions: [],
      script: { condBranchSkillInfo: [{ condType: "isSelfTarget", condValue: [1] }] },
    }),
    "Other",
  );
});

test("compact servant keeps the target mode and branch evidence", () => {
  const compact = compactServant({
    id: 445,
    skills: [
      { id: 2511650, num: 3, name: "公主的指令 EX", functions: [], script: selfTargetBranches },
      { id: 2510550, num: 1, name: "胸部之袋 A", functions: [] },
    ],
  });
  const skills = compact.skills as Array<Record<string, unknown>>;
  assert.equal(skills[0]?.targetingMode, "singleAllyIncludingSelf");
  assert.deepEqual((skills[0]?.script as Record<string, unknown>).condBranchSkillInfo, [
    { condType: "isSelfTarget", condValue: [0], skillId: 970731 },
    { condType: "isSelfTarget", condValue: [1], skillId: 970732 },
  ]);
  assert.equal(skills[1]?.targetingMode, "Other");
});
