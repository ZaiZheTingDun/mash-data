#!/usr/bin/env python3
"""Stage a successful update and record its exact changes in the private checkout."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from collections import Counter
from pathlib import Path, PurePosixPath

from assets_release.json_utils import read_json, utc_timestamp, write_json


RESOURCE_TYPES = (
    "从者数据 JSON", "从者原始 JSON", "从者图片", "战斗形态 JSON",
    "概念礼装 JSON", "概念礼装原始 JSON", "概念礼装图片", "技能 JSON", "技能图标",
    "魔术礼装 JSON", "魔术礼装图片", "资源汇总", "客户端资源",
    "活动道具 JSON", "活动道具图标",
    "Atlas 更新游标", "分析报告", "其他状态与配置",
)


def resource_type(value: str) -> str:
    path = PurePosixPath(value)
    if value.startswith("assets/catalogs/"):
        return "客户端资源"
    if path.name in {"servants_variants.json", "servants_variants_cn.json", "servant_variants.json", "servant_variants_cn.json"} and path.parts[0] == "assets":
        return "战斗形态 JSON"
    if value.startswith("assets/servants/"):
        if path.name in {"servant-raw.json", "servant-cn-raw.json"}:
            return "从者原始 JSON"
        return "从者数据 JSON" if path.suffix == ".json" else "从者图片"
    if value.startswith("assets/ces/") and path.name in {"craft-essence-raw.json", "craft-essence-cn-raw.json"}:
        return "概念礼装原始 JSON"
    for directory, data_label, image_label in (
        ("ces", "概念礼装 JSON", "概念礼装图片"),
        ("mystic-codes", "魔术礼装 JSON", "魔术礼装图片"),
    ):
        if value.startswith(f"assets/{directory}/"):
            return data_label if path.suffix == ".json" else image_label
    if value.startswith("assets/skills/"):
        return "技能 JSON"
    if value == "assets/events/items.json":
        return "活动道具 JSON"
    if value.startswith("assets/icons/items/"):
        return "活动道具图标"
    if value.startswith("assets/icons/"):
        return "技能图标"
    if value.startswith("assets/") and path.name not in {"version.json", "manifest.json"}:
        return "资源汇总"
    if value in {"state/atlas-data-version.json", "state/atlas-ce-data-version.json"}:
        return "Atlas 更新游标"
    if value.startswith("verification/result/"):
        return "分析报告"
    return "其他状态与配置"


def resource_counts(changes: list[dict]) -> dict:
    counts = {label: {"A": 0, "M": 0, "D": 0} for label in RESOURCE_TYPES}
    for change in changes:
        status = "M" if change["status"] == "T" else change["status"]
        counts[resource_type(change["path"])][status] += 1
    return counts


def render_summary(result: dict, commit: str, push_outcome: str) -> str:
    status = "无变化" if not result["changed"] else "已提交并推送" if push_outcome == "success" else "推送失败"
    lines = [f"更新结果：{status}", "", f"Private commit: `{commit}`", "",
             "统计单位为文件，JP/CN 分别计数；原始 JSON 与精简数据分开统计。", "",
             "| 资源类型 | 新增 | 修改 | 删除 |", "| --- | ---: | ---: | ---: |"]
    for label, counts in result["countsByResource"].items():
        lines.append(f'| {label} | {counts["A"]} | {counts["M"]} | {counts["D"]} |')
    return "\n".join(lines) + "\n"


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args]).decode("utf-8")


def record_update(root: Path, run_id: str, code_commit: str, run_url: str) -> dict:
    if not re.fullmatch(r"[0-9]+-[0-9]+", run_id):
        raise ValueError("run ID must be <run-number>-<attempt>")
    if git(root, "diff", "--cached", "--name-only").strip():
        raise ValueError("private checkout must have an empty index before recording an update")
    before_commit = git(root, "rev-parse", "HEAD").strip()
    state_path = "state/atlas-data-version.json"
    before_state = json.loads(git(root, "show", f"HEAD:{state_path}"))
    after_state = json.loads((root / state_path).read_text(encoding="utf-8"))
    ce_state_path = "state/atlas-ce-data-version.json"
    before_ce_state = (
        json.loads(git(root, "show", f"HEAD:{ce_state_path}"))
        if git(root, "ls-tree", "--name-only", "HEAD", "--", ce_state_path).strip() else None
    )
    after_ce_state = read_json(root / ce_state_path) if (root / ce_state_path).exists() else None
    # Only generated data belongs in this commit; never stage code or credentials.
    git(root, "add", "--all", "--", "assets", "state", "verification/result")
    fields = git(root, "diff", "--cached", "--no-renames", "--name-status", "-z").split("\0")
    changes = [{"status": fields[i], "path": fields[i + 1]} for i in range(0, len(fields) - 1, 2)]
    counts = dict(Counter(item["status"] for item in changes))
    by_resource = resource_counts(changes)
    result = {"changed": bool(changes), "files": len(changes), "counts": counts, "countsByResource": by_resource}
    if not changes:
        return result
    report_path = f"state/updates/{run_id}.json"
    if (root / report_path).exists():
        raise ValueError(f"update record already exists: {report_path}")
    write_json(root / report_path, {
        "createdAt": utc_timestamp(),
        "run": run_url,
        "codeCommit": code_commit,
        "previousDataCommit": before_commit,
        "atlasStateBefore": before_state,
        "atlasStateAfter": after_state,
        "atlasCeStateBefore": before_ce_state,
        "atlasCeStateAfter": after_ce_state,
        "counts": counts,
        "countsByResource": by_resource,
        "files": changes,
    })
    git(root, "add", "--", report_path)
    return {**result, "record": report_path}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", action="store_true")
    args = parser.parse_args()
    root = Path(os.environ["MASH_DATA_ROOT"]).resolve()
    if args.summary:
        result = read_json(Path(os.environ["UPDATE_SUMMARY_PATH"]))
        summary = render_summary(result, git(root, "rev-parse", "HEAD").strip(), os.environ.get("PUSH_OUTCOME", ""))
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as file:
            file.write(summary)
        return
    result = record_update(
        root,
        f'{os.environ["GITHUB_RUN_ID"]}-{os.environ["GITHUB_RUN_ATTEMPT"]}',
        os.environ["GITHUB_SHA"],
        f'{os.environ["GITHUB_SERVER_URL"]}/{os.environ["GITHUB_REPOSITORY"]}/actions/runs/{os.environ["GITHUB_RUN_ID"]}',
    )
    if path := os.environ.get("UPDATE_SUMMARY_PATH"):
        write_json(Path(path), result)
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a", encoding="utf-8") as file:
            file.write(f'changed={str(result["changed"]).lower()}\nfiles={result["files"]}\n')
    # Public Actions logs contain counts only; the detailed record stays private.
    print(json.dumps({key: value for key, value in result.items() if key != "record"}))


if __name__ == "__main__":
    main()
