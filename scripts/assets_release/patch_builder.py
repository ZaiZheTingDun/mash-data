from __future__ import annotations

import zipfile
from pathlib import Path

from .asset_state import scan_asset_entries
from .hashing import ensure_zip_sha256
from .json_utils import to_json_bytes, utc_timestamp
from .models import FileEntry, PatchResult
from .version_utils import VersionError, parse_version_label


class PatchBuildError(RuntimeError):
    pass


class PatchBuilder:
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root
        self.release_root = repo_root / "dist" / "assets-release"

    def build(
        self,
        from_tag: str,
        to_tag: str,
        previous_entries: dict[str, FileEntry],
    ) -> PatchResult:
        try:
            from_version = parse_version_label(from_tag).version
            to_version = parse_version_label(to_tag).version
        except VersionError as error:
            raise PatchBuildError(str(error)) from error
        if from_version >= to_version:
            raise PatchBuildError("--from must be lower than --to")

        current_entries = scan_asset_entries(self.repo_root)

        added_paths = sorted(set(current_entries) - set(previous_entries))
        deleted_paths = sorted(set(previous_entries) - set(current_entries))
        modified_paths = sorted(
            path
            for path in set(current_entries) & set(previous_entries)
            if current_entries[path].sha256 != previous_entries[path].sha256
        )

        output_dir = self.release_root / "patches"
        output_dir.mkdir(parents=True, exist_ok=True)
        zip_path = output_dir / f"v{from_version}-to-v{to_version}.zip"
        created_at = utc_timestamp()
        patch_manifest = {
            "fromVersion": from_version,
            "toVersion": to_version,
            "createdAt": created_at,
            "added": len(added_paths),
            "modified": len(modified_paths),
            "deleted": len(deleted_paths),
        }
        deletes = {"files": deleted_paths}

        with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            for asset_path in [*added_paths, *modified_paths]:
                archive.write(self.repo_root / "assets" / asset_path, asset_path)
            archive.writestr("deletes.json", to_json_bytes(deletes))
            archive.writestr("patch-manifest.json", to_json_bytes(patch_manifest))

        sha256 = ensure_zip_sha256(zip_path)
        return PatchResult(
            from_version=from_version,
            to_version=to_version,
            path=zip_path,
            sha256=sha256,
            size=zip_path.stat().st_size,
            added=len(added_paths),
            modified=len(modified_paths),
            deleted=len(deleted_paths),
        )
