from __future__ import annotations

import zipfile
from pathlib import Path

from .asset_state import IMAGE_EXTENSIONS, is_asset_path, scan_asset_entries
from .hashing import ensure_zip_sha256, sha256_file
from .json_utils import read_json, to_json_bytes, utc_timestamp
from .models import BasePackSpec, FileEntry, ZipResult


class BaseBuildError(RuntimeError):
    pass


class BaseBuilder:
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root
        self.assets_root = repo_root / "assets"
        self.release_root = repo_root / "dist" / "assets-release"

    def build(self) -> list[ZipResult]:
        version = self.read_assets_version()
        created_at = utc_timestamp()
        output_dir = self.release_root / "base" / f"v{version}"
        output_dir.mkdir(parents=True, exist_ok=True)

        return [self._build_pack(spec, version, created_at, output_dir) for spec in self.pack_specs()]

    def build_offline_bundle(self) -> ZipResult:
        version = self.read_assets_version()
        entries = sorted(scan_asset_entries(self.repo_root).values(), key=lambda entry: entry.path)
        if not entries:
            raise BaseBuildError(f"No asset files found below {self.assets_root}")

        output_dir = self.repo_root / "dist" / "offline"
        output_dir.mkdir(parents=True, exist_ok=True)
        zip_path = output_dir / f"mash-assets-v{version}.zip"
        with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in entries:
                archive.write(self.assets_root / entry.path, entry.path)
            archive.writestr("assets-version.json", to_json_bytes({"version": version}))

        sha256 = ensure_zip_sha256(zip_path)
        return ZipResult("offline-base", zip_path, sha256, zip_path.stat().st_size, len(entries))

    def read_assets_version(self) -> int:
        version_path = self.assets_root / "version.json"
        try:
            payload = read_json(version_path)
        except ValueError as error:
            raise BaseBuildError(str(error)) from error

        version = payload.get("version")
        if not isinstance(version, int):
            raise BaseBuildError(f"{version_path} must contain an integer 'version' field")
        return version

    def pack_specs(self) -> tuple[BasePackSpec, ...]:
        return (
            BasePackSpec(
                name="assets-json",
                output_name="assets-json",
                roots=(self.assets_root / "servants", self.assets_root / "ces", self.assets_root / "catalogs", self.assets_root / "events"),
                extensions=(".json",),
            ),
            BasePackSpec(
                name="servant-images",
                output_name="servant-images",
                roots=(self.assets_root / "servants",),
                extensions=IMAGE_EXTENSIONS,
            ),
            BasePackSpec(
                name="ce-images",
                output_name="ce-images",
                roots=(self.assets_root / "ces",),
                extensions=IMAGE_EXTENSIONS,
            ),
            BasePackSpec(
                name="icon-images",
                output_name="icon-images",
                roots=(self.assets_root / "icons",),
                extensions=IMAGE_EXTENSIONS,
            ),
            BasePackSpec(
                name="mystic-code-json",
                output_name="mystic-code-json",
                roots=(self.assets_root / "mystic-codes",),
                extensions=(".json",),
            ),
            BasePackSpec(
                name="mystic-code-images",
                output_name="mystic-code-images",
                roots=(self.assets_root / "mystic-codes",),
                extensions=IMAGE_EXTENSIONS,
            ),
            BasePackSpec(
                name="skill-json",
                output_name="skill-json",
                roots=(self.assets_root / "skills",),
                extensions=(".json",),
            ),
        )

    def _build_pack(self, spec: BasePackSpec, version: int, created_at: str, output_dir: Path) -> ZipResult:
        files = self._find_files(spec)
        if not files:
            roots = ", ".join(str(root) for root in spec.roots)
            extensions = ", ".join(spec.extensions)
            raise BaseBuildError(f"No files matched for {spec.name}: roots={roots}, extensions={extensions}")

        zip_path = output_dir / f"{spec.output_name}-v{version}.zip"
        entries = [self._file_entry(path) for path in files]
        pack_manifest = {
            "packName": spec.name,
            "version": version,
            "createdAt": created_at,
            "fileCount": len(entries),
            "files": [
                {
                    "path": entry.path,
                    "size": entry.size,
                    "sha256": entry.sha256,
                }
                for entry in entries
            ],
        }

        with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            for source, entry in zip(files, entries, strict=True):
                archive.write(source, entry.path)
            archive.writestr("pack-manifest.json", to_json_bytes(pack_manifest))

        sha256 = ensure_zip_sha256(zip_path)
        return ZipResult(spec.name, zip_path, sha256, zip_path.stat().st_size, len(entries))

    def _find_files(self, spec: BasePackSpec) -> list[Path]:
        extensions = {extension.lower() for extension in spec.extensions}
        paths: list[Path] = []
        for root in spec.roots:
            if root.is_dir():
                paths.extend(
                    path
                    for path in root.rglob("*")
                    if path.is_file()
                    and path.suffix.lower() in extensions
                    and is_asset_path(path.relative_to(self.assets_root).as_posix())
                )
        return sorted(paths, key=lambda path: path.relative_to(self.assets_root).as_posix())

    def _file_entry(self, path: Path) -> FileEntry:
        return FileEntry(
            path=path.relative_to(self.assets_root).as_posix(),
            size=path.stat().st_size,
            sha256=sha256_file(path),
        )
