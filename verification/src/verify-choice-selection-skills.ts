import { getServantFilePaths, readServant, sortBySkillIdentity, writePrettyJson } from "./utils.js";

type SelectionType =
  | "SelectAddInfo"
  | "selectTreasureDeviceInfo"
  | "commandTypeSelfTreasureDevice";

interface ChoiceSelectionSkillBase {
  servantCollectionNo: number;
  skillId: number;
  skillNum: number;
}

interface ChoiceSelectionSkillSingle extends ChoiceSelectionSkillBase {
  selectionType: SelectionType;
  optionCount: number;
}

interface ChoiceSelectionSkillMultiple extends ChoiceSelectionSkillBase {
  selectionType: SelectionType[];
  optionCountByType: Record<SelectionType, number>;
}

type ChoiceSelectionSkill = ChoiceSelectionSkillSingle | ChoiceSelectionSkillMultiple;

function getSelectAddInfoCount(selectAddInfo: unknown): number | null {
  if (!Array.isArray(selectAddInfo) || selectAddInfo.length === 0) {
    return null;
  }

  const firstEntry = selectAddInfo[0] as { btn?: unknown[] };
  return Array.isArray(firstEntry?.btn) ? firstEntry.btn.length : 0;
}

function getSelectTreasureDeviceInfoCount(selectTreasureDeviceInfo: unknown): number | null {
  if (!Array.isArray(selectTreasureDeviceInfo) || selectTreasureDeviceInfo.length === 0) {
    return null;
  }

  const firstEntry = selectTreasureDeviceInfo[0] as { treasureDevices?: unknown[] };
  return Array.isArray(firstEntry?.treasureDevices) ? firstEntry.treasureDevices.length : 0;
}

function getCommandTypeSelfTreasureDeviceCount(functions: unknown): number | null {
  if (!Array.isArray(functions)) {
    return null;
  }

  const actSets = new Set<number>();

  for (const func of functions as Array<{ funcTargetType?: string; svals?: Array<Record<string, unknown>> }>) {
    if (func.funcTargetType !== "commandTypeSelfTreasureDevice") {
      continue;
    }

    for (const sval of func.svals ?? []) {
      const actSet = sval.ActSet;
      if (typeof actSet === "number") {
        actSets.add(actSet);
      }
    }
  }

  return actSets.size > 0 ? actSets.size : null;
}

async function main(): Promise<void> {
  const rows: ChoiceSelectionSkill[] = [];

  for (const filePath of await getServantFilePaths()) {
    const servant = await readServant(filePath);

    for (const skill of servant.skills ?? []) {
      const selectAddInfoCount = getSelectAddInfoCount(skill.script?.SelectAddInfo);
      const selectTreasureDeviceInfoCount = getSelectTreasureDeviceInfoCount(
        skill.script?.selectTreasureDeviceInfo,
      );
      const commandTypeSelfTreasureDeviceCount = getCommandTypeSelfTreasureDeviceCount(skill.functions);

      const hasSelectAddInfo = selectAddInfoCount !== null;
      const hasSelectTreasureDeviceInfo = selectTreasureDeviceInfoCount !== null;
      const hasCommandTypeSelfTreasureDevice = commandTypeSelfTreasureDeviceCount !== null;

      if (!hasSelectAddInfo && !hasSelectTreasureDeviceInfo && !hasCommandTypeSelfTreasureDevice) {
        continue;
      }

      const selectionType: SelectionType[] = [];
      const optionCountByType: Partial<Record<SelectionType, number>> = {};

      if (hasSelectAddInfo) {
        selectionType.push("SelectAddInfo");
        optionCountByType.SelectAddInfo = selectAddInfoCount;
      }

      if (hasSelectTreasureDeviceInfo) {
        selectionType.push("selectTreasureDeviceInfo");
        optionCountByType.selectTreasureDeviceInfo = selectTreasureDeviceInfoCount;
      }

      if (hasCommandTypeSelfTreasureDevice) {
        selectionType.push("commandTypeSelfTreasureDevice");
        optionCountByType.commandTypeSelfTreasureDevice = commandTypeSelfTreasureDeviceCount;
      }

      if (selectionType.length > 1) {
        rows.push({
          servantCollectionNo: servant.collectionNo,
          skillId: skill.id,
          skillNum: skill.num,
          selectionType,
          optionCountByType: optionCountByType as Record<SelectionType, number>,
        });
        continue;
      }

      rows.push({
        servantCollectionNo: servant.collectionNo,
        skillId: skill.id,
        skillNum: skill.num,
        selectionType: selectionType[0],
        optionCount: optionCountByType[selectionType[0]]!,
      });
    }
  }

  await writePrettyJson("choice-selection-skills.json", sortBySkillIdentity(rows));
}

await main();
