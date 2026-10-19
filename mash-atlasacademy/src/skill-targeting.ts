export type TargetingMode =
  | "singleAlly"
  | "singleAllyExceptSelf"
  | "mixed"
  | "singleAllyIncludingSelf"
  | "Other";

interface SkillTargetSource {
  functions?: unknown;
  script?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function classifySkillTargeting(skill: SkillTargetSource): TargetingMode {
  const targetTypes = new Set(
    (Array.isArray(skill.functions) ? skill.functions : [])
      .map((value: unknown) => record(value)?.funcTargetType)
      .filter((value: unknown): value is string => typeof value === "string"),
  );
  const script = record(skill.script);
  const branches = script?.condBranchSkillInfo;
  const selfTargetValues = new Set(
    (Array.isArray(branches) ? branches : [])
      .filter((value: unknown) => record(value)?.condType === "isSelfTarget")
      .flatMap((value: unknown) => {
        const values = record(value)?.condValue;
        return Array.isArray(values) ? values : [];
      }),
  );

  if (selfTargetValues.has(0) && selfTargetValues.has(1)) {
    return "singleAllyIncludingSelf";
  }
  if (targetTypes.has("ptOne") && targetTypes.has("ptOneOther")) return "mixed";
  if (targetTypes.has("ptOne")) return "singleAlly";
  if (targetTypes.has("ptOneOther")) return "singleAllyExceptSelf";
  return "Other";
}
