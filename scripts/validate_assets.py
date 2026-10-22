#!/usr/bin/env python3
"""Validate the existing data snapshot without fetching or modifying it."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image

from assets_release.asset_state import scan_asset_entries
from assets_release.base_builder import BaseBuilder


APPEND_ICONS = ("skill_00301.png", "skill_00601.png", "skill_00300.png", "skill_00303.png", "skill_00613.png")
CATALOG_NAMES = ("servants.json", "servants_variants.json", "servants_variants_cn.json", "craft_essences.json", "events.json", "event_items.json")


def validate_catalog(payload, name: str, assets: Path, require_image) -> None:
    array_catalogs = {"servants.json", "servants_variants.json", "servants_variants_cn.json", "craft_essences.json"}
    if name in array_catalogs:
        records = payload
    elif name in {"events.json", "event_items.json"}:
        key = "events" if name == "events.json" else "items"
        if not isinstance(payload, dict) or payload.get("schemaVersion") != 2 or "regions" in payload:
            raise ValueError(f"invalid merged catalog: {name}")
        records = payload.get(key)
    else:
        raise ValueError(f"unknown catalog: {name}")
    if not isinstance(records, list) or not records:
        raise ValueError(f"catalog must contain a nonempty array: {name}")
    seen = set()
    for record in records:
        if (not isinstance(record, dict) or type(record.get("id")) is not int
                or record["id"] <= 0 or record["id"] in seen):
            raise ValueError(f"invalid or duplicate catalog ID: {name}")
        seen.add(record["id"])
        if name in array_catalogs:
            continue
        if (not isinstance(record.get("name"), str) or not record["name"].strip()
                or "nameCN" not in record or (record["nameCN"] is not None and not isinstance(record["nameCN"], str))):
            raise ValueError(f"invalid catalog names: {name}")
        if name == "event_items.json":
            if ("detail" in record or record.get("type") not in {"eventItem", "eventPoint", "boostItem", "dice", "eventPassiveSkillGiven"}
                    or not isinstance(record.get("background"), str) or not record["background"] or "icon" not in record):
                raise ValueError("invalid merged event item")
            if record["icon"] is None:
                if (not isinstance(record.get("missingIcon"), str)
                        or not re.fullmatch(r"https://static\.atlasacademy\.io/JP/Items/[0-9]+\.png", record["missingIcon"])):
                    raise ValueError("missing upstream icon URL for merged event item")
            elif isinstance(record["icon"], str) and re.fullmatch(r"icons/items/[0-9]+\.png", record["icon"]):
                require_image(assets / record["icon"])
            else:
                raise ValueError("invalid merged event item icon")
        else:
            if not isinstance(record.get("type"), str) or not isinstance(record.get("warIds"), list):
                raise ValueError("invalid merged event metadata")
            if all(record.get(region) is None for region in ("JP", "CN")):
                raise ValueError("merged event has no regional dates")
            for region in ("JP", "CN"):
                if region not in record:
                    raise ValueError(f"missing {region} event dates")
                dates = record[region]
                if dates is None:
                    continue
                if (not isinstance(dates, dict) or any(type(dates.get(key)) is not int or dates[key] < 0
                        for key in ("noticeAt", "startedAt", "endedAt", "finishedAt"))):
                    raise ValueError(f"invalid {region} event dates")


def validate_assets(root: Path) -> int:
    builder = BaseBuilder(root)
    for spec in builder.pack_specs():
        if not builder._find_files(spec):
            raise ValueError(f"no files found for required pack: {spec.name}")
    assets = root / "assets"
    entries = scan_asset_entries(root)
    for name in CATALOG_NAMES:
        if f"catalogs/{name}" not in entries:
            raise ValueError(f"missing catalog: catalogs/{name}; run npm run catalogs:generate")

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
        if entry.path.startswith("catalogs/"):
            validate_catalog(payload, path.name, assets, require_image)
            continue
        if not isinstance(payload, dict):
            raise ValueError(f"asset JSON must contain an object: {entry.path}")
        if entry.path == "events/items.json":
            regions = payload.get("regions")
            if payload.get("schemaVersion") != 1 or not isinstance(regions, dict):
                raise ValueError("invalid event items catalog")
            for region in ("JP", "CN"):
                items = regions.get(region)
                if not isinstance(items, list) or not items:
                    raise ValueError(f"missing {region} event items")
                seen = set()
                for item in items:
                    if (not isinstance(item, dict) or type(item.get("id")) is not int
                            or item["id"] <= 0 or item["id"] in seen
                            or item.get("type") not in {"eventItem", "eventPoint", "boostItem", "dice", "eventPassiveSkillGiven"}
                            or not isinstance(item.get("name"), str) or not item["name"].strip()
                            or not isinstance(item.get("detail"), str)
                            or not isinstance(item.get("background"), str) or not item["background"]
                            or "icon" not in item):
                        raise ValueError(f"invalid {region} event item")
                    seen.add(item["id"])
                    if item["icon"] is None:
                        if (not isinstance(item.get("missingIcon"), str)
                                or not re.fullmatch(r"https://static\.atlasacademy\.io/JP/Items/[0-9]+\.png", item["missingIcon"])):
                            raise ValueError(f"missing upstream icon URL for {region} event item")
                    elif isinstance(item["icon"], str) and re.fullmatch(r"icons/items/[0-9]+\.png", item["icon"]):
                        require_image(assets / item["icon"])
                    else:
                        raise ValueError(f"invalid {region} event item icon")
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
            for key in ("masterExpBonuses", "mysticCodeExpBonuses", "friendPointBonuses"):
                if key in payload and not isinstance(payload[key], list):
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
