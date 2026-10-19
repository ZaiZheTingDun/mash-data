#!/usr/bin/env python3
"""Stage a successful update and record its exact changes in the private checkout."""
from __future__ import annotations

import json
import os
import re
import subprocess
from collections import Counter
from pathlib import Path

from assets_release.json_utils import utc_timestamp, write_json


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
    # Only generated data belongs in this commit; never stage code or credentials.
    git(root, "add", "--all", "--", "assets", "resources", "state", "verification/result")
    fields = git(root, "diff", "--cached", "--no-renames", "--name-status", "-z").split("\0")
    changes = [{"status": fields[i], "path": fields[i + 1]} for i in range(0, len(fields) - 1, 2)]
    counts = dict(Counter(item["status"] for item in changes))
    result = {"changed": bool(changes), "files": len(changes), "counts": counts}
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
        "counts": counts,
        "files": changes,
    })
    git(root, "add", "--", report_path)
    return {**result, "record": report_path}


def main() -> None:
    root = Path(os.environ["MASH_DATA_ROOT"]).resolve()
    result = record_update(
        root,
        f'{os.environ["GITHUB_RUN_ID"]}-{os.environ["GITHUB_RUN_ATTEMPT"]}',
        os.environ["GITHUB_SHA"],
        f'{os.environ["GITHUB_SERVER_URL"]}/{os.environ["GITHUB_REPOSITORY"]}/actions/runs/{os.environ["GITHUB_RUN_ID"]}',
    )
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a", encoding="utf-8") as file:
            file.write(f'changed={str(result["changed"]).lower()}\nfiles={result["files"]}\n')
    # Public Actions logs contain counts only; the detailed record stays private.
    print(json.dumps({key: value for key, value in result.items() if key != "record"}))


if __name__ == "__main__":
    main()
