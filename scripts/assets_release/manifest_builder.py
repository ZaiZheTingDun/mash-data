from __future__ import annotations

import json
from pathlib import Path

from .hashing import ensure_zip_sha256, sha256_file
from .json_utils import read_json, write_json


class ManifestBuildError(RuntimeError):
    pass


class ManifestBuilder:
    def __init__(
        self,
        repo_root: Path,
        fallback_manifest: dict[str, object] | None = None,
        state_path: str | None = None,
    ) -> None:
        self.repo_root = repo_root
        self.assets_root = repo_root / "assets"
        self.release_root = repo_root / "dist" / "assets-release"
        self.fallback_entries = self._index_fallback_entries(fallback_manifest)
        self.state_path = state_path

    def rebuild(self) -> Path:
        try:
            source = read_json(self.assets_root / "manifest.json")
        except ValueError as error:
            raise ManifestBuildError(str(error)) from error

        self._validate_source(source)
        release_manifest = json.loads(json.dumps(source))
        if not isinstance(release_manifest, dict):
            raise ManifestBuildError("assets/manifest.json must contain a JSON object")
        self._enrich_packs(release_manifest)
        self._enrich_patches(release_manifest)

        latest = self._expect_int(source, "latest")
        latest_base = self._expect_int(source, "latestBase")
        state_entry = self._state_entry()
        if self.state_path is not None:
            release_manifest["state"] = state_entry
        manifest_rel_path = f"manifests/manifest-v{latest}.json"
        manifest_path = self.release_root / manifest_rel_path
        write_json(manifest_path, release_manifest)
        latest_payload = {
            "latest": latest,
            "latestBase": latest_base,
            "manifest": manifest_rel_path,
        }
        if self.state_path is not None:
            latest_payload["state"] = state_entry
        write_json(self.release_root / "latest.json", latest_payload)
        return manifest_path

    def _validate_source(self, source: dict[str, object]) -> None:
        latest = self._expect_int(source, "latest")
        latest_base = self._expect_int(source, "latestBase")
        base = self._expect_object(source, "base")
        base_version = self._expect_int(base, "version")
        if base_version != latest_base:
            raise ManifestBuildError("assets/manifest.json base.version must equal latestBase")
        if latest < latest_base:
            raise ManifestBuildError("assets/manifest.json latest must be greater than or equal to latestBase")

        packs = base.get("packs")
        if not isinstance(packs, list) or not packs:
            raise ManifestBuildError("assets/manifest.json base.packs must be a non-empty array")
        for pack in packs:
            if not isinstance(pack, dict):
                raise ManifestBuildError("assets/manifest.json base.packs entries must be objects")
            self._expect_string(pack, "name")
            self._expect_string(pack, "file")

        patches = source.get("patches")
        if not isinstance(patches, list):
            raise ManifestBuildError("assets/manifest.json patches must be an array")
        for patch in patches:
            if not isinstance(patch, dict):
                raise ManifestBuildError("assets/manifest.json patches entries must be objects")
            self._expect_int(patch, "from")
            self._expect_int(patch, "to")
            self._expect_string(patch, "file")

    def _enrich_packs(self, manifest: dict[str, object]) -> None:
        base = self._expect_object(manifest, "base")
        packs = base["packs"]
        if not isinstance(packs, list):
            raise ManifestBuildError("assets/manifest.json base.packs must be an array")
        for pack in packs:
            if not isinstance(pack, dict):
                raise ManifestBuildError("assets/manifest.json base.packs entries must be objects")
            self._enrich_zip_entry(pack)

    def _enrich_patches(self, manifest: dict[str, object]) -> None:
        patches = manifest["patches"]
        if not isinstance(patches, list):
            raise ManifestBuildError("assets/manifest.json patches must be an array")
        for patch in patches:
            if not isinstance(patch, dict):
                raise ManifestBuildError("assets/manifest.json patches entries must be objects")
            self._enrich_zip_entry(patch)

    def _enrich_zip_entry(self, entry: dict[str, object]) -> None:
        file_path = self._expect_string(entry, "file")
        if file_path.startswith("/") or ".." in Path(file_path).parts:
            raise ManifestBuildError(f"Manifest file path must be relative inside dist/assets-release: {file_path}")

        zip_path = self.release_root / file_path
        if zip_path.is_file():
            entry["sha256"] = ensure_zip_sha256(zip_path)
            entry["size"] = zip_path.stat().st_size
            return

        fallback = self.fallback_entries.get(file_path)
        if fallback is not None:
            entry["sha256"] = fallback["sha256"]
            entry["size"] = fallback["size"]
            return

        if self._has_integrity_metadata(entry):
            return
        raise ManifestBuildError(f"Manifest references missing zip: {zip_path}")

    def _has_integrity_metadata(self, entry: dict[str, object]) -> bool:
        sha256 = entry.get("sha256")
        size = entry.get("size")
        if sha256 is None and size is None:
            return False
        if (
            not isinstance(sha256, str)
            or len(sha256) != 64
            or any(character not in "0123456789abcdef" for character in sha256.lower())
            or not isinstance(size, int)
            or size < 0
        ):
            raise ManifestBuildError(
                "Manifest zip integrity metadata must contain a SHA-256 and a non-negative size"
            )
        return True

    def _state_entry(self) -> dict[str, object] | None:
        if self.state_path is None:
            return None
        if self.state_path.startswith("/") or ".." in Path(self.state_path).parts:
            raise ManifestBuildError(
                f"State file path must be relative inside dist/assets-release: {self.state_path}"
            )
        path = self.release_root / self.state_path
        if not path.is_file():
            raise ManifestBuildError(f"State file is missing: {path}")
        return {
            "file": self.state_path,
            "sha256": sha256_file(path),
            "size": path.stat().st_size,
        }

    def _index_fallback_entries(self, manifest: dict[str, object] | None) -> dict[str, dict[str, object]]:
        if manifest is None:
            return {}

        entries: dict[str, dict[str, object]] = {}
        base = manifest.get("base")
        if isinstance(base, dict):
            packs = base.get("packs")
            if isinstance(packs, list):
                for pack in packs:
                    self._add_fallback_entry(entries, pack)

        patches = manifest.get("patches")
        if isinstance(patches, list):
            for patch in patches:
                self._add_fallback_entry(entries, patch)
        return entries

    def _add_fallback_entry(self, entries: dict[str, dict[str, object]], entry: object) -> None:
        if not isinstance(entry, dict):
            return
        file_path = entry.get("file")
        sha256 = entry.get("sha256")
        size = entry.get("size")
        if isinstance(file_path, str) and isinstance(sha256, str) and isinstance(size, int):
            entries[file_path] = {"sha256": sha256, "size": size}

    def _expect_object(self, payload: dict[str, object], key: str) -> dict[str, object]:
        value = payload.get(key)
        if not isinstance(value, dict):
            raise ManifestBuildError(f"assets/manifest.json {key} must be an object")
        return value

    def _expect_int(self, payload: dict[str, object], key: str) -> int:
        value = payload.get(key)
        if not isinstance(value, int):
            raise ManifestBuildError(f"assets/manifest.json {key} must be an integer")
        return value

    def _expect_string(self, payload: dict[str, object], key: str) -> str:
        value = payload.get(key)
        if not isinstance(value, str) or not value:
            raise ManifestBuildError(f"assets/manifest.json {key} must be a non-empty string")
        return value
