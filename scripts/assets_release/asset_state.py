from __future__ import annotations

from pathlib import Path

from .hashing import sha256_file
from .json_utils import read_json_bytes, to_json_bytes, utc_timestamp
from .models import FileEntry

IMAGE_EXTENSIONS = (".png", ".webp", ".jpg", ".jpeg")
ASSET_ROOTS = ("servants", "ces", "catalogs", "events", "icons", "mystic-codes", "skills")
ASSET_EXTENSIONS = (".json", *IMAGE_EXTENSIONS)
IGNORED_ASSET_NAMES = {".DS_Store"}
RAW_JSON_NAMES = {
    "servant-raw.json", "servant-cn-raw.json",
    "craft-essence-raw.json", "craft-essence-cn-raw.json",
}


class AssetStateError(RuntimeError):
    pass


def asset_state_rel_path(version: int) -> str:
    return f"states/asset-state-v{version}.json"


def scan_asset_entries(repo_root: Path) -> dict[str, FileEntry]:
    assets_root = repo_root / "assets"
    entries: dict[str, FileEntry] = {}
    for root_name in ASSET_ROOTS:
        root = assets_root / root_name
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            asset_path = path.relative_to(assets_root).as_posix()
            if not is_asset_path(asset_path):
                continue
            entries[asset_path] = FileEntry(
                path=asset_path,
                size=path.stat().st_size,
                sha256=sha256_file(path),
            )
    return entries


def write_asset_state(repo_root: Path, version: int) -> Path:
    entries = scan_asset_entries(repo_root)
    state = {
        "version": version,
        "createdAt": utc_timestamp(),
        "fileCount": len(entries),
        "files": [
            {
                "path": entry.path,
                "size": entry.size,
                "sha256": entry.sha256,
            }
            for entry in sorted(entries.values(), key=lambda item: item.path)
        ],
    }
    path = repo_root / "dist" / "assets-release" / asset_state_rel_path(version)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(to_json_bytes(state))
    return path


def read_asset_state_bytes(content: bytes, expected_version: int, source: str) -> dict[str, FileEntry]:
    try:
        payload = read_json_bytes(content, source)
    except ValueError as error:
        raise AssetStateError(str(error)) from error

    version = payload.get("version")
    if version != expected_version:
        raise AssetStateError(f"{source} version must be {expected_version}, got {version!r}")

    files = payload.get("files")
    if not isinstance(files, list):
        raise AssetStateError(f"{source} files must be an array")

    entries: dict[str, FileEntry] = {}
    for item in files:
        if not isinstance(item, dict):
            raise AssetStateError(f"{source} files entries must be objects")
        path = _expect_string(item, "path", source)
        size = _expect_int(item, "size", source)
        sha256 = _expect_string(item, "sha256", source)
        if is_asset_path(path):
            entries[path] = FileEntry(path=path, size=size, sha256=sha256)
    return entries


def is_asset_path(asset_path: str) -> bool:
    path = Path(asset_path)
    return (
        len(path.parts) >= 2
        and path.parts[0] in ASSET_ROOTS
        and path.name not in IGNORED_ASSET_NAMES
        and path.name not in RAW_JSON_NAMES
        and path.suffix.lower() in ASSET_EXTENSIONS
    )


def _expect_int(payload: dict[str, object], key: str, source: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int):
        raise AssetStateError(f"{source} {key} must be an integer")
    return value


def _expect_string(payload: dict[str, object], key: str, source: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AssetStateError(f"{source} {key} must be a non-empty string")
    return value
