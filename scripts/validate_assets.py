#!/usr/bin/env python3
"""Validate the existing data snapshot without fetching or modifying it."""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image

from assets_release.asset_state import scan_asset_entries
from assets_release.base_builder import BaseBuilder


APPEND_ICONS = ("skill_00301.png", "skill_00601.png", "skill_00300.png", "skill_00303.png", "skill_00613.png")


def validate_assets(root: Path) -> int:
    builder = BaseBuilder(root)
    for spec in builder.pack_specs():
        if not builder._find_files(spec):
            raise ValueError(f"no files found for required pack: {spec.name}")
    assets = root / "assets"
    entries = scan_asset_entries(root)

    def require_image(path: Path) -> None:
        if path.relative_to(assets).as_posix() not in entries:
            raise ValueError(f"missing referenced image: {path.relative_to(assets)}")

    for name in APPEND_ICONS:
        require_image(assets / "icons" / name)
    for entry in entries.values():
        path = assets / entry.path
        if path.is_symlink() or not path.resolve().is_relative_to(assets.resolve()):
            raise ValueError(f"asset must be a regular file inside assets: {entry.path}")
        if path.suffix.lower() != ".json":
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                image.load()
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"asset JSON must contain an object: {entry.path}")
        icons = [payload.get("icon"), *(skill.get("icon") for skill in payload.get("skills", []))]
        for icon in icons:
            if isinstance(icon, str) and icon:
                require_image(assets / "icons" / Path(urlparse(icon).path).name)
        if path.name == "servant.json":
            for group_name, prefix in (("commands", "card_servant"), ("faces", "face_servant"), ("narrowFigure", "narrow_servant")):
                group = payload.get("extraAssets", {}).get(group_name, {})
                for section in ("ascension", "costume"):
                    for key, url in (group.get(section) or {}).items():
                        if url:
                            require_image(path.parent / f"{prefix}_{key}.png")
        elif path.name in {"craft-essence.json", "craft-essence-cn.json"}:
            required = {"bondEquipOwner", "valentineEquipOwner", "bondBonuses", "qpBonuses", "eventBonuses", "events"}
            if payload.get("schemaVersion") != 1 or not required.issubset(payload):
                raise ValueError(f"craft essence requires raw migration: {entry.path}")
            if "skills" in payload or "profile" in payload:
                raise ValueError(f"craft essence must contain compact data only: {entry.path}")
            for key in ("bondBonuses", "qpBonuses", "eventBonuses", "events"):
                if not isinstance(payload[key], list):
                    raise ValueError(f"invalid craft essence {key}: {entry.path}")
            for key in ("bondEquipOwner", "valentineEquipOwner"):
                owner = payload[key]
                if owner is not None and (type(owner) is not int or owner <= 0):
                    raise ValueError(f"invalid craft essence {key}: {entry.path}")
            if path.name == "craft-essence.json" and payload.get("face"):
                require_image(path.parent / "card_ce.png")
        elif path.name == "mystic-code.json":
            for group, prefix in (("item", "item"), ("masterFace", "master-face"), ("masterFigure", "master-figure")):
                for gender in ("male", "female"):
                    if payload.get("extraAssets", {}).get(group, {}).get(gender):
                        require_image(path.parent / f"{prefix}-{gender}.png")
    return len(entries)


if __name__ == "__main__":
    print(f'Validated {validate_assets(Path(os.environ["MASH_DATA_ROOT"]).resolve())} asset files')
