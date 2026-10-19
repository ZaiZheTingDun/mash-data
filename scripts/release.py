#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

from assets_release.asset_state import (
    AssetStateError,
    asset_state_rel_path,
    read_asset_state_bytes,
    write_asset_state,
)
from assets_release.base_builder import BaseBuildError, BaseBuilder
from assets_release.manifest_builder import ManifestBuildError, ManifestBuilder
from assets_release.patch_builder import PatchBuildError, PatchBuilder
from assets_release.r2 import aws_environment
from assets_release.version_utils import VersionError, parse_version_label


def clear_dist(repo_root: Path) -> None:
    dist_dir = repo_root / "dist"
    if dist_dir.exists():
        if not dist_dir.is_dir():
            raise RuntimeError(f"dist path is not a directory: {dist_dir}")
        shutil.rmtree(dist_dir)
    print(f"cleared: {dist_dir}")


def r2_object_prefix() -> str:
    r2_prefix = os.environ.get("R2_PREFIX", "mash").strip("/")
    assets_prefix = os.environ.get("ASSETS_PREFIX", "assets").strip("/")
    if r2_prefix and assets_prefix:
        return f"{r2_prefix}/{assets_prefix}"
    return r2_prefix or assets_prefix


def aws_args() -> list[str]:
    endpoint = os.environ.get("R2_ENDPOINT")
    if not endpoint:
        raise RuntimeError("R2_ENDPOINT is required for patch releases")

    profile = os.environ.get("AWS_PROFILE", "mash")
    args: list[str] = []
    if profile:
        args.extend(["--profile", profile])
    args.extend(["--endpoint-url", endpoint])
    return args


def fetch_r2_manifest(version: int) -> dict[str, object]:
    content = fetch_r2_object(f"manifests/manifest-v{version}.json", label="previous manifest")

    try:
        manifest = json.loads(content.decode("utf-8"))
    except UnicodeDecodeError as error:
        raise RuntimeError(f"previous R2 manifest is not UTF-8: manifest-v{version}.json") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"invalid JSON in previous R2 manifest: manifest-v{version}.json") from error
    if not isinstance(manifest, dict):
        raise RuntimeError(f"previous R2 manifest must contain a JSON object: manifest-v{version}.json")
    return manifest


def fetch_r2_asset_state(version: int) -> tuple[bytes, str]:
    file_path = asset_state_rel_path(version)
    content = fetch_r2_object(file_path, label="previous asset state")
    return content, file_path


def fetch_r2_object(file_path: str, label: str | None = None) -> bytes:
    bucket = os.environ.get("R2_BUCKET")
    if not bucket:
        raise RuntimeError("R2_BUCKET is required for patch releases")

    object_prefix = r2_object_prefix()
    key = f"{object_prefix}/{file_path}" if object_prefix else file_path
    source = f"s3://{bucket}/{key}"
    object_label = label or "previous release object"
    print(f"reading {object_label}: {source}")

    command = ["aws", "s3", "cp", source, "-", *aws_args()]
    try:
        result = subprocess.run(command, check=True, capture_output=True, env=aws_environment())
    except FileNotFoundError as error:
        raise RuntimeError("missing required command: aws") from error
    except subprocess.CalledProcessError as error:
        stderr = error.stderr.decode("utf-8", errors="replace").strip()
        detail = f": {stderr}" if stderr else ""
        raise RuntimeError(f"failed to read {file_path} from R2{detail}") from error

    return result.stdout


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build FGO assets releases.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("base", help="Build base release packs from the current assets folder.")
    subparsers.add_parser(
        "offline-base",
        help="Build one user-downloadable base zip without changing dist/assets-release.",
    )

    patch_parser = subparsers.add_parser("patch", help="Build a patch release pack between two versions.")
    patch_parser.add_argument("--from", dest="from_tag", required=True, help="Source version label, e.g. v1.")
    patch_parser.add_argument("--to", dest="to_tag", required=True, help="Target version label, e.g. v2.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        configured_root = os.environ.get("MASH_DATA_ROOT")
        if not configured_root or not configured_root.strip():
            raise RuntimeError("MASH_DATA_ROOT is required")
        repo_root = Path(configured_root).resolve()
        if not (repo_root / "assets").is_dir():
            raise RuntimeError("Set MASH_DATA_ROOT to a data checkout containing an assets directory")
        if args.command == "offline-base":
            result = BaseBuilder(repo_root).build_offline_bundle()
            print(
                f"{result.name}: {result.path} "
                f"({result.file_count} files, {result.size} bytes, sha256={result.sha256})"
            )
            return 0

        fallback_manifest = None
        previous_entries = None
        output_state_version = None
        if args.command == "patch":
            from_version = parse_version_label(args.from_tag).version
            output_state_version = parse_version_label(args.to_tag).version
            fallback_manifest = fetch_r2_manifest(from_version)
            previous_state_content, previous_state_source = fetch_r2_asset_state(from_version)
            previous_entries = read_asset_state_bytes(
                previous_state_content,
                expected_version=from_version,
                source=previous_state_source,
            )

        clear_dist(repo_root)

        if args.command == "base":
            base_builder = BaseBuilder(repo_root)
            results = base_builder.build()
            output_state_version = base_builder.read_assets_version()
            for result in results:
                print(
                    f"{result.name}: {result.path} "
                    f"({result.file_count} files, {result.size} bytes, sha256={result.sha256})"
                )
        elif args.command == "patch":
            if fallback_manifest is None:
                raise RuntimeError("patch release requires a previous manifest")
            if previous_entries is None:
                raise RuntimeError("patch release requires a previous asset state")
            result = PatchBuilder(repo_root).build(
                args.from_tag,
                args.to_tag,
                previous_entries=previous_entries,
            )
            print(
                f"patch v{result.from_version}-to-v{result.to_version}: {result.path} "
                f"(A={result.added}, M={result.modified}, D={result.deleted}, "
                f"{result.size} bytes, sha256={result.sha256})"
            )

        if output_state_version is None:
            raise RuntimeError("release state version was not resolved")
        state_path = write_asset_state(repo_root, output_state_version)
        print(f"state: {state_path}")

        manifest_path = ManifestBuilder(
            repo_root,
            fallback_manifest=fallback_manifest,
            state_path=asset_state_rel_path(output_state_version),
        ).rebuild()
        print(f"manifest: {manifest_path}")
    except (AssetStateError, BaseBuildError, VersionError, PatchBuildError, ManifestBuildError, RuntimeError) as error:
        raise SystemExit(f"error: {error}") from error

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
