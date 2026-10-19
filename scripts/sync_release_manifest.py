#!/usr/bin/env python3
"""Stage the published manifest and version in a fresh private checkout."""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from assets_release.json_utils import read_json, write_json
from assets_release.r2 import R2Store, safe_path
from record_data_update import git


def sync_manifest(root: Path, store: R2Store, version: int, data_commit: str) -> bool:
    if type(version) is not int or version < 1:
        raise ValueError("expected a positive published version")
    if git(root, "diff", "--cached", "--name-only").strip():
        raise ValueError("manifest sync requires an empty index")
    metadata_paths = ["assets/manifest.json", "assets/version.json"]
    if git(root, "diff", "--", *metadata_paths).strip():
        raise ValueError("release metadata has uncommitted changes")
    version_path = root / "assets" / "version.json"
    version_config = read_json(version_path)
    private_version = version_config.get("version")
    if type(private_version) is not int or private_version < 1 or private_version > version:
        raise ValueError("private version must be valid and cannot be newer than this release")
    latest, etag = store.read_json("latest.json")
    manifest_path = f"manifests/manifest-v{version}.json"
    if latest["latest"] != version or latest["manifest"] != manifest_path:
        raise ValueError("R2 latest does not match this release; refusing to write an older or unpublished manifest")
    manifest, _ = store.read_json(manifest_path)
    if (manifest.get("latest") != version or manifest.get("latestBase") != latest.get("latestBase")
            or manifest.get("base", {}).get("version") != latest.get("latestBase")
            or manifest.get("state") != latest.get("state")):
        raise ValueError("published manifest does not match R2 latest")
    if manifest.get("source", {}).get("dataCommit") != data_commit:
        raise ValueError("published manifest comes from a different data commit")
    # Copy all integrity metadata and history, without redownloading the ZIPs that
    # the successful release job has already verified.
    entries = [*manifest["base"]["packs"], *manifest["patches"], manifest["state"]]
    if not manifest["base"]["packs"]:
        raise ValueError("published manifest has no base packs")
    for entry in entries:
        safe_path(entry["file"])
        digest, size = entry.get("sha256"), entry.get("size")
        if (not isinstance(digest, str) or len(digest) != 64
                or any(c not in "0123456789abcdef" for c in digest)
                or type(size) is not int or size < 0):
            raise ValueError("published manifest has incomplete integrity metadata")
    path = root / "assets" / "manifest.json"
    if path.exists():
        previous_version = read_json(path).get("latest", 0)
        if type(previous_version) is not int or previous_version > version:
            raise ValueError("private manifest is newer than this release; refusing to overwrite it")
    current, current_etag = store.read_json("latest.json")
    if current_etag != etag or current != latest:
        raise ValueError("R2 latest changed while reading the published manifest")
    write_json(path, manifest)
    write_json(version_path, {**version_config, "version": version})
    git(root, "add", "--", *metadata_paths)
    staged = git(root, "diff", "--cached", "--name-only").splitlines()
    if any(path not in metadata_paths for path in staged):
        raise ValueError("release sync must stage only assets/manifest.json and assets/version.json")
    return bool(staged)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, type=int)
    parser.add_argument("--data-commit", required=True)
    args = parser.parse_args()
    changed = sync_manifest(Path(os.environ["MASH_DATA_ROOT"]).resolve(), R2Store(), args.version, args.data_commit)
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a", encoding="utf-8") as file:
            file.write(f"changed={str(changed).lower()}\n")
    print(f"Published manifest and version v{args.version}: {'staged for commit' if changed else 'already synchronized'}")


if __name__ == "__main__":
    main()
