#!/usr/bin/env python3
"""Build from a private snapshot, then publish verified objects and switch latest."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

from assets_release.asset_state import asset_state_rel_path, read_asset_state_bytes, scan_asset_entries, write_asset_state
from assets_release.base_builder import BaseBuilder
from assets_release.hashing import sha256_file
from assets_release.json_utils import read_json, to_json_bytes, write_json
from assets_release.manifest_builder import ManifestBuilder
from assets_release.patch_builder import PatchBuilder
from assets_release.r2 import R2Store, safe_path, verify_file
from release import clear_dist
from validate_assets import validate_assets


def positive_version(value: object) -> int:
    if type(value) is not int or value < 1:
        raise ValueError("release versions must be positive integers")
    return value


def check_deletions(root: Path, version: int, deleted: set[str]) -> None:
    if not deleted:
        return
    approval_path = root / "state" / "release-deletions.json"
    if not approval_path.is_file():
        raise ValueError(f"release deletes {len(deleted)} assets; commit the exact list in state/release-deletions.json")
    approval = read_json(approval_path)
    if approval.get("version") != version or sorted(approval.get("files", [])) != sorted(deleted):
        raise ValueError("state/release-deletions.json must match the target version and exact deleted paths")


def prepare(root: Path, store: R2Store, mode: str, base_compatible: bool = False) -> dict:
    version = positive_version(read_json(root / "assets" / "version.json").get("version"))
    validate_assets(root)
    latest, etag = store.read_json("latest.json", missing_ok=True)
    previous_version = positive_version(latest.get("latest")) if latest else 0
    if version <= previous_version:
        raise ValueError(f"private assets/version.json must be newer than R2 v{previous_version}; got v{version}")
    previous_manifest = None
    previous_entries = None
    if latest:
        manifest_path = safe_path(latest["manifest"])
        if manifest_path != f"manifests/manifest-v{previous_version}.json":
            raise ValueError("R2 latest points to an unexpected manifest path")
        previous_manifest, _ = store.read_json(manifest_path)
        if previous_manifest is None or previous_manifest.get("latest") != previous_version:
            raise ValueError("R2 previous manifest version does not match latest")
        state = latest.get("state")
        if isinstance(state, dict):
            state_path = safe_path(state["file"])
            if state_path != asset_state_rel_path(previous_version):
                raise ValueError("R2 latest points to an unexpected asset state path")
            store.verify(state_path, state)
            payload, _ = store.read_json(state_path)
            previous_entries = read_asset_state_bytes(to_json_bytes(payload), previous_version, state_path)
        if mode == "patch" and previous_entries is None:
            raise ValueError("previous release has no asset state; restore its exact state before creating a patch")
    elif mode == "patch":
        raise ValueError("patch requires an existing R2 release; use base for an empty destination")
    if mode == "base" and latest and not base_compatible:
        raise ValueError("rebuilding base requires explicit confirmation of old-client compatibility")
    current_entries = scan_asset_entries(root)
    deleted = set(previous_entries or {}) - set(current_entries)
    check_deletions(root, version, deleted)
    if mode == "base":
        source = {
            "latest": version, "latestBase": version,
            "base": {"version": version, "packs": [
                {"name": spec.name, "file": f"base/v{version}/{spec.output_name}-v{version}.zip"}
                for spec in BaseBuilder(root).pack_specs()
            ]},
            "patches": [],
        }
    else:
        # Preserve the installed base and all existing patch routes.
        source = json.loads(json.dumps(previous_manifest))
        source["latest"] = version
        source["patches"].append({"from": previous_version, "to": version,
                                  "file": f"patches/v{previous_version}-to-v{version}.zip"})

    # Only the runner's snapshot is used. Never commit release preparation to private.
    manifest_source = root / "assets" / "manifest.json"
    original_source = manifest_source.read_bytes() if manifest_source.exists() else None
    try:
        write_json(manifest_source, source)
        clear_dist(root)
        if mode == "base":
            BaseBuilder(root).build()
        else:
            PatchBuilder(root).build(f"v{previous_version}", f"v{version}", previous_entries)
        write_asset_state(root, version)
        manifest_path = ManifestBuilder(root, fallback_manifest=previous_manifest,
                                        state_path=asset_state_rel_path(version)).rebuild()
        data_commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
        manifest = read_json(manifest_path)
        manifest["source"] = {"dataCommit": data_commit, "codeCommit": os.environ.get("GITHUB_SHA", "local")}
        write_json(manifest_path, manifest)
        context = {"previousVersion": previous_version, "previousETag": etag,
                   "version": version, "mode": mode, "dataCommit": data_commit,
                   "codeCommit": os.environ.get("GITHUB_SHA", "local"), "deleted": len(deleted),
                   "destination": {"endpoint": store.endpoint, "bucket": store.bucket, "prefix": store.prefix}}
        write_json(root / "dist" / "release-context.json", context)
        return context
    finally:
        if original_source is None:
            manifest_source.unlink(missing_ok=True)
        else:
            manifest_source.write_bytes(original_source)


def release_objects(release_root: Path) -> tuple[dict, dict[str, dict]]:
    latest = read_json(release_root / "latest.json")
    version = positive_version(latest.get("latest"))
    manifest_path = f"manifests/manifest-v{version}.json"
    if latest.get("manifest") != manifest_path:
        raise ValueError("unexpected manifest path in latest.json")
    manifest = read_json(release_root / manifest_path)
    if manifest.get("latest") != version or manifest.get("latestBase") != latest.get("latestBase"):
        raise ValueError("latest.json and release manifest disagree")
    if manifest.get("state") != latest.get("state") or latest["state"]["file"] != asset_state_rel_path(version):
        raise ValueError("latest.json and release manifest must reference the current asset state")
    objects = {}
    for entry in [*manifest["base"]["packs"], *manifest["patches"], latest["state"]]:
        key = safe_path(entry["file"])
        if key.split("/")[0] not in {"base", "patches", "states"}:
            raise ValueError(f"unexpected release object: {key}")
        if key in objects and objects[key] != entry:
            raise ValueError(f"conflicting release object: {key}")
        objects[key] = entry
    objects[manifest_path] = {"size": (release_root / manifest_path).stat().st_size,
                              "sha256": sha256_file(release_root / manifest_path)}
    return latest, objects


def publish(root: Path, store: R2Store) -> None:
    context = read_json(root / "dist" / "release-context.json")
    if context["destination"] != {"endpoint": store.endpoint, "bucket": store.bucket, "prefix": store.prefix}:
        raise ValueError("release was prepared for a different R2 destination")
    release_root = root / "dist" / "assets-release"
    latest, objects = release_objects(release_root)
    if latest["latest"] != context["version"]:
        raise ValueError("release context version does not match artifacts")
    current, etag = store.read_json("latest.json", missing_ok=True)
    if etag != context["previousETag"] or (current and current["latest"] != context["previousVersion"]):
        raise ValueError("R2 latest changed since preparation; rebuild against the current release")
    # Verify local files before performing any writes.
    for key, entry in objects.items():
        path = release_root / key
        if path.exists():
            verify_file(path, entry)
            checksum = path.with_suffix(path.suffix + ".sha256")
            if checksum.exists() and checksum.read_text(encoding="utf-8").strip() != entry["sha256"]:
                raise ValueError(f"invalid checksum sidecar: {checksum.name}")
    # ZIPs/state first, versioned manifest after its complete dependency set.
    for key, entry in sorted(objects.items(), key=lambda item: item[0].startswith("manifests/")):
        path = release_root / key
        if path.exists():
            store.put_immutable(key, path, entry)
            checksum = path.with_suffix(path.suffix + ".sha256")
            if checksum.exists():
                checksum_entry = {"size": checksum.stat().st_size, "sha256": sha256_file(checksum)}
                store.put_immutable(key + ".sha256", checksum, checksum_entry)
        else:
            store.verify(key, entry)
    # R2 evaluates this ETag condition atomically, including writers outside Actions.
    store.put("latest.json", release_root / "latest.json", etag=context["previousETag"])
    store.verify("latest.json", {"size": (release_root / "latest.json").stat().st_size,
                                 "sha256": sha256_file(release_root / "latest.json")})
    print(f'Published v{latest["latest"]}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("prepare")
    build.add_argument("--mode", choices=("patch", "base"), default="patch")
    build.add_argument("--base-compatible", action="store_true")
    subparsers.add_parser("publish")
    args = parser.parse_args()
    root = Path(os.environ["MASH_DATA_ROOT"]).resolve()
    store = R2Store()
    if args.command == "publish":
        publish(root, store)
    else:
        print(json.dumps(prepare(root, store, args.mode, args.base_compatible)))


if __name__ == "__main__":
    main()
