from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from assets_release.json_utils import to_json_bytes, write_json
from assets_release.asset_state import scan_asset_entries
from assets_release.base_builder import BaseBuilder
from assets_release.r2 import R2Store, safe_path, verify_file
from pipeline_release import prepare, publish
from record_data_update import git, record_update, render_summary, resource_counts
from release import fetch_r2_object
from sync_release_manifest import sync_manifest
from validate_assets import APPEND_ICONS, validate_assets


def entry(content: bytes) -> dict:
    return {"size": len(content), "sha256": hashlib.sha256(content).hexdigest()}


def read_release_manifest(root: Path, version: int) -> dict:
    return json.loads((root / "dist" / "assets-release" / "manifests" / f"manifest-v{version}.json").read_text())


class FakeR2:
    endpoint = "https://example.r2.cloudflarestorage.com"
    bucket = "test"
    prefix = "mash/assets"

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.writes: list[str] = []
        self.fail_key: str | None = None
        self.before_switch = None

    def read_json(self, key, missing_ok=False):
        if key not in self.objects:
            if missing_ok:
                return None, None
            raise RuntimeError("missing object")
        content = self.objects[key]
        return json.loads(content), '"' + hashlib.md5(content).hexdigest() + '"'

    def verify(self, key, expected):
        if key not in self.objects or entry(self.objects[key]) != {k: expected[k] for k in ("size", "sha256")}:
            raise ValueError("remote size/SHA-256 mismatch")

    def put_immutable(self, key, source, expected):
        if key == self.fail_key:
            raise RuntimeError("simulated interrupted upload")
        if key not in self.objects:
            self.objects[key] = source.read_bytes()
            self.writes.append(key)
        self.verify(key, expected)

    def put(self, key, source, etag=None):
        if self.before_switch:
            self.before_switch()
        _, actual = self.read_json(key, missing_ok=True)
        if etag != actual:
            raise RuntimeError("PreconditionFailed")
        self.objects[key] = source.read_bytes()
        self.writes.append(key)


def fixture(root: Path) -> None:
    for group in ("servants", "ces", "mystic-codes", "skills"):
        write_json(root / "assets" / group / "1" / "data.json", {"id": 1})
    for group in ("servants/1", "ces/1", "mystic-codes/1", "icons"):
        target = root / "assets" / group / "image.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (2, 2)).save(target)
    for name in APPEND_ICONS:
        Image.new("RGB", (2, 2)).save(root / "assets" / "icons" / name)
    write_json(root / "assets" / "version.json", {"version": 1})
    write_json(root / "assets" / "manifest.json", {"keep": "private manifest"})
    write_json(root / "state" / "atlas-data-version.json", {"JP": {"hash": "before"}})
    write_json(root / "resources" / "servants.json", {"id": 1})
    write_json(root / "verification" / "result" / "result.json", {"ok": True})
    (root / ".gitignore").write_text("dist/\n")
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    git(root, "config", "user.email", "test@example.com")
    git(root, "config", "user.name", "Test")
    git(root, "config", "commit.gpgsign", "false")
    git(root, "add", ".")
    git(root, "commit", "-qm", "fixture")


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mash-pipeline-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixture(self.root)
        self.store = FakeR2()

    def release_base(self):
        prepare(self.root, self.store, "base")
        publish(self.root, self.store)
        self.store.writes.clear()

    def next_version(self):
        write_json(self.root / "assets" / "skills" / "1" / "data.json", {"id": 2})

    def test_raw_caches_are_excluded_from_all_packages_states_and_publication(self):
        raw_paths = [
            "servants/1/servant-raw.json", "servants/1/servant-cn-raw.json",
            "ces/1/craft-essence-raw.json", "ces/1/craft-essence-cn-raw.json",
        ]
        for name in raw_paths:
            # Invalid JSON also proves release validation never reads private raw.
            (self.root / "assets" / name).write_text("PRIVATE_RAW_MARKER")
        self.assertTrue(set(raw_paths).isdisjoint(scan_asset_entries(self.root)))
        validate_assets(self.root)
        self.release_base()

        def check_artifacts():
            BaseBuilder(self.root).build_offline_bundle()
            for path in (self.root / "dist").rglob("*.zip"):
                with zipfile.ZipFile(path) as archive:
                    self.assertTrue(set(raw_paths).isdisjoint(archive.namelist()), path)
                    for name in archive.namelist():
                        self.assertNotIn(b"PRIVATE_RAW_MARKER", archive.read(name), (path, name))
                        if name.endswith(".json"):
                            self.assertNotIn(b"-raw.json", archive.read(name), (path, name))
            for path in (self.root / "dist" / "assets-release").rglob("*.json"):
                self.assertNotIn(b"-raw.json", path.read_bytes(), path)

        check_artifacts()
        for name in raw_paths:
            (self.root / "assets" / name).write_text("PRIVATE_RAW_MARKER_CHANGED")
        self.next_version()
        prepare(self.root, self.store, "patch")
        check_artifacts()
        with zipfile.ZipFile(self.root / "dist" / "assets-release" / "patches" / "v1-to-v2.zip") as archive:
            self.assertEqual(json.loads(archive.read("deletes.json")), {"files": []})
        publish(self.root, self.store)
        self.assertNotIn(b"-raw.json", self.store.objects["states/asset-state-v2.json"])

    def test_validator_requires_compact_ce_fields_and_rejects_legacy_basic(self):
        path = self.root / "assets" / "ces" / "1" / "craft-essence.json"
        write_json(path, {"id": 1, "collectionNo": 1})
        with self.assertRaisesRegex(ValueError, "requires raw migration"):
            validate_assets(self.root)
        compact = {"id": 1, "collectionNo": 1, "schemaVersion": 1,
                   "bondEquipOwner": None, "valentineEquipOwner": None,
                   "bondBonuses": [], "eventBonuses": [], "events": []}
        write_json(path, compact)
        validate_assets(self.root)
        write_json(path, {**compact, "profile": {"private": "lore"}})
        with self.assertRaisesRegex(ValueError, "compact data only"):
            validate_assets(self.root)

    def test_base_and_patch_preserve_history_and_publish_latest_last(self):
        original = (self.root / "assets" / "manifest.json").read_bytes()
        self.release_base()
        self.next_version()
        context = prepare(self.root, self.store, "patch")
        self.assertEqual(context["previousVersion"], 1)
        self.assertEqual((self.root / "assets" / "manifest.json").read_bytes(), original)
        self.assertEqual(self.store.writes, [])
        publish(self.root, self.store)
        latest, _ = self.store.read_json("latest.json")
        manifest, _ = self.store.read_json(latest["manifest"])
        self.assertEqual(latest["latest"], 2)
        self.assertEqual(manifest["base"]["version"], 1)
        self.assertEqual(manifest["patches"][-1]["from"], 1)
        self.assertEqual(self.store.writes[-1], "latest.json")
        self.assertEqual(self.store.writes[-2], "manifests/manifest-v2.json")

    def test_first_base_has_no_patch(self):
        context = prepare(self.root, self.store, "base")
        manifest = read_release_manifest(self.root, 1)
        self.assertIsNone(context["patch"])
        self.assertEqual(manifest["patches"], [])
        self.assertFalse((self.root / "dist" / "assets-release" / "patches").exists())

    def test_rebuilt_base_also_publishes_patch_and_retains_older_routes(self):
        self.release_base()
        self.next_version()
        prepare(self.root, self.store, "patch")
        publish(self.root, self.store)
        old_patch = self.store.objects["patches/v1-to-v2.zip"]
        self.store.writes.clear()

        write_json(self.root / "assets" / "skills" / "1" / "data.json", {"id": 3})
        # Keep a skill JSON for the required pack, but remove another managed file.
        deleted = "ces/1/data.json"
        (self.root / "assets" / deleted).unlink()
        write_json(self.root / "state" / "release-deletions.json", {"version": 3, "files": [deleted]})
        context = prepare(self.root, self.store, "base", base_compatible=True)
        manifest = read_release_manifest(self.root, 3)
        self.assertEqual(manifest["latestBase"], 3)
        self.assertEqual(manifest["base"]["version"], 3)
        self.assertEqual([(p["from"], p["to"]) for p in manifest["patches"]], [(1, 2), (2, 3)])
        self.assertEqual(context["patch"]["file"], "patches/v2-to-v3.zip")
        self.assertEqual(len(list((self.root / "dist" / "assets-release" / "base" / "v3").glob("*.zip"))), 7)
        with zipfile.ZipFile(self.root / "dist" / "assets-release" / "patches" / "v2-to-v3.zip") as archive:
            self.assertEqual(json.loads(archive.read("skills/1/data.json")), {"id": 3})
            self.assertEqual(json.loads(archive.read("deletes.json")), {"files": [deleted]})
        # No upload happens during preparation.
        self.assertEqual(self.store.writes, [])
        publish(self.root, self.store)
        self.assertEqual(self.store.objects["patches/v1-to-v2.zip"], old_patch)
        self.assertIn("patches/v2-to-v3.zip", self.store.writes)
        self.assertIn("base/v3/assets-json-v3.zip", self.store.writes)
        self.assertEqual(self.store.writes[-1], "latest.json")

        # The following patch continues using the rebuilt base and complete history.
        prepare(self.root, self.store, "patch")
        manifest = read_release_manifest(self.root, 4)
        self.assertEqual(manifest["base"]["version"], 3)
        self.assertEqual([(p["from"], p["to"]) for p in manifest["patches"]], [(1, 2), (2, 3), (3, 4)])

    def test_rebuilt_base_patch_failure_leaves_latest_unchanged(self):
        self.release_base()
        self.next_version()
        prepare(self.root, self.store, "base", base_compatible=True)
        before = self.store.objects["latest.json"]
        self.store.fail_key = "patches/v1-to-v2.zip"
        with self.assertRaisesRegex(RuntimeError, "interrupted"):
            publish(self.root, self.store)
        self.assertEqual(self.store.objects["latest.json"], before)
        self.assertNotIn("manifests/manifest-v2.json", self.store.objects)

    def test_interrupted_upload_leaves_latest_unchanged(self):
        self.release_base()
        self.next_version()
        prepare(self.root, self.store, "patch")
        before = self.store.objects["latest.json"]
        self.store.fail_key = "states/asset-state-v2.json"
        with self.assertRaisesRegex(RuntimeError, "interrupted"):
            publish(self.root, self.store)
        self.assertEqual(self.store.objects["latest.json"], before)
        self.store.fail_key = None
        publish(self.root, self.store)  # Reusing the same artifacts can safely retry.
        self.assertEqual(self.store.read_json("latest.json")[0]["latest"], 2)

    def test_existing_different_object_cannot_be_overwritten(self):
        self.release_base()
        self.next_version()
        prepare(self.root, self.store, "patch")
        self.store.objects["patches/v1-to-v2.zip"] = b"another release"
        with self.assertRaisesRegex(ValueError, "mismatch"):
            publish(self.root, self.store)
        self.assertEqual(self.store.objects["patches/v1-to-v2.zip"], b"another release")
        self.assertEqual(self.store.read_json("latest.json")[0]["latest"], 1)

    def test_historical_object_corruption_blocks_latest(self):
        self.release_base()
        self.next_version()
        prepare(self.root, self.store, "patch")
        self.store.objects["base/v1/assets-json-v1.zip"] = b"corrupt"
        with self.assertRaisesRegex(ValueError, "mismatch"):
            publish(self.root, self.store)
        self.assertEqual(self.store.read_json("latest.json")[0]["latest"], 1)

    def test_concurrent_writer_is_rejected_at_latest_switch(self):
        self.release_base()
        self.next_version()
        prepare(self.root, self.store, "patch")
        other = to_json_bytes({"latest": 3})
        self.store.before_switch = lambda: self.store.objects.update({"latest.json": other})
        with self.assertRaisesRegex(RuntimeError, "PreconditionFailed"):
            publish(self.root, self.store)
        self.assertEqual(self.store.objects["latest.json"], other)

    def test_auto_increments_from_remote_without_manual_version_bump(self):
        self.release_base()
        before = (self.root / "assets" / "version.json").read_bytes()
        self.assertEqual(prepare(self.root, self.store, "patch")["version"], 2)
        self.assertEqual((self.root / "assets" / "version.json").read_bytes(), before)
        # Previewing again does not consume a persisted version.
        self.assertEqual(prepare(self.root, self.store, "patch")["version"], 2)
        publish(self.root, self.store)
        # A stale private v1 still builds v3 against published v2.
        self.assertEqual(prepare(self.root, self.store, "patch")["version"], 3)
        self.assertEqual((self.root / "assets" / "version.json").read_bytes(), before)

    def test_private_version_is_also_a_lower_bound(self):
        self.release_base()
        write_json(self.root / "assets" / "version.json", {"version": 5})
        self.assertEqual(prepare(self.root, self.store, "patch")["version"], 6)

    def test_unconfirmed_base_still_fails(self):
        self.release_base()
        self.next_version()
        with self.assertRaisesRegex(ValueError, "compatibility"):
            prepare(self.root, self.store, "base")

    def test_failed_build_restores_local_version_config(self):
        self.release_base()
        before = (self.root / "assets" / "version.json").read_bytes()
        with patch("pipeline_release.PatchBuilder.build", side_effect=RuntimeError("build failed")):
            with self.assertRaisesRegex(RuntimeError, "build failed"):
                prepare(self.root, self.store, "patch")
        self.assertEqual((self.root / "assets" / "version.json").read_bytes(), before)
        self.assertEqual(self.store.read_json("latest.json")[0]["latest"], 1)

    def test_v14_builds_v15_and_writes_manifest_and_version_after_publication(self):
        config = {"version": 14, "atlasExportDate": "2026-09-24"}
        write_json(self.root / "assets" / "version.json", config)
        git(self.root, "add", "--", "assets/version.json")
        git(self.root, "commit", "-qm", "version 14")
        original = (self.root / "assets" / "version.json").read_bytes()
        prepare(self.root, self.store, "base")
        publish(self.root, self.store)
        context = prepare(self.root, self.store, "base", base_compatible=True)
        self.assertEqual(context["version"], 15)
        manifest = read_release_manifest(self.root, 15)
        self.assertEqual(manifest["base"]["version"], 15)
        self.assertEqual(manifest["patches"][-1]["file"], "patches/v14-to-v15.zip")
        for pack in manifest["base"]["packs"]:
            with zipfile.ZipFile(self.root / "dist" / "assets-release" / pack["file"]) as archive:
                self.assertEqual(json.loads(archive.read("pack-manifest.json"))["version"], 15)
        self.assertEqual((self.root / "assets" / "version.json").read_bytes(), original)
        with self.assertRaisesRegex(ValueError, "unpublished manifest"):
            sync_manifest(self.root, self.store, 15, context["dataCommit"])
        self.assertEqual((self.root / "assets" / "version.json").read_bytes(), original)
        publish(self.root, self.store)
        self.assertTrue(sync_manifest(self.root, self.store, 15, context["dataCommit"]))
        self.assertEqual(json.loads((self.root / "assets" / "version.json").read_text()), {**config, "version": 15})
        self.assertEqual(git(self.root, "diff", "--cached", "--name-only").splitlines(), ["assets/manifest.json", "assets/version.json"])
        git(self.root, "commit", "-qm", "sync release 15")
        self.assertFalse(sync_manifest(self.root, self.store, 15, context["dataCommit"]))

    def test_deletions_require_exact_versioned_list(self):
        self.release_base()
        self.next_version()
        deleted = "skills/1/data.json"
        (self.root / "assets" / deleted).unlink()
        write_json(self.root / "assets" / "skills" / "2" / "data.json", {"id": 2})
        with self.assertRaisesRegex(ValueError, "exact list"):
            prepare(self.root, self.store, "patch")
        write_json(self.root / "state" / "release-deletions.json", {"version": 2, "files": [deleted]})
        self.assertEqual(prepare(self.root, self.store, "patch")["deleted"], 1)

    def test_no_changes_creates_no_update_record(self):
        result = record_update(self.root, "1-1", "code", "run")
        self.assertFalse(result["changed"])
        self.assertFalse((self.root / "state" / "updates").exists())

    def test_update_record_includes_exact_changes_and_cursor_before_after(self):
        write_json(self.root / "state" / "atlas-data-version.json", {"JP": {"hash": "after"}})
        write_json(self.root / "assets" / "skills" / "2" / "data.json", {"id": 2})
        (self.root / "assets" / "ces" / "1" / "data.json").unlink()
        (self.root / "unrelated.txt").write_text("not staged")
        result = record_update(self.root, "123-2", "code-sha", "run-url")
        report = json.loads((self.root / result["record"]).read_text())
        self.assertEqual(report["atlasStateBefore"]["JP"]["hash"], "before")
        self.assertEqual(report["atlasStateAfter"]["JP"]["hash"], "after")
        self.assertEqual(report["counts"], {"A": 1, "D": 1, "M": 1})
        self.assertEqual(report["countsByResource"]["技能 JSON"], {"A": 1, "M": 0, "D": 0})
        self.assertEqual(report["countsByResource"]["概念礼装 JSON"], {"A": 0, "M": 0, "D": 1})
        self.assertEqual(report["countsByResource"]["Atlas 更新游标"], {"A": 0, "M": 1, "D": 0})
        self.assertEqual(result["countsByResource"], report["countsByResource"])
        self.assertNotIn("unrelated.txt", git(self.root, "diff", "--cached", "--name-only"))

    def test_resource_breakdown_separates_raw_variants_and_images(self):
        paths = [
            ("A", "assets/servants/2/servant.json", "从者数据 JSON"),
            ("M", "assets/servants/1/servant-cn.json", "从者数据 JSON"),
            ("A", "assets/servants/2/servant-raw.json", "从者原始 JSON"),
            ("M", "assets/servants/1/servant-cn-raw.json", "从者原始 JSON"),
            ("A", "assets/servants/2/card_servant_1.png", "从者图片"),
            ("M", "assets/servants/1/servant_variants_cn.json", "战斗形态 JSON"),
            ("M", "assets/servants_variants.json", "战斗形态 JSON"),
            ("M", "assets/ces/1/craft-essence.json", "概念礼装 JSON"),
            ("A", "assets/ces/1/craft-essence-raw.json", "概念礼装原始 JSON"),
            ("M", "assets/ces/1/craft-essence-cn-raw.json", "概念礼装原始 JSON"),
            ("D", "assets/ces/1/card_ce.png", "概念礼装图片"),
            ("A", "assets/skills/2/skill_cn.json", "技能 JSON"),
            ("A", "assets/icons/skill_1.png", "技能图标"),
            ("M", "assets/mystic-codes/1/mystic-code-cn.json", "魔术礼装 JSON"),
            ("A", "assets/mystic-codes/1/item-male.png", "魔术礼装图片"),
            ("M", "assets/craft_essences.json", "资源汇总"),
            ("M", "resources/servants.json", "客户端资源"),
            ("M", "state/atlas-data-version.json", "Atlas 更新游标"),
            ("M", "state/atlas-ce-data-version.json", "Atlas 更新游标"),
            ("M", "verification/result/runtime-skills.json", "分析报告"),
            ("M", "assets/version.json", "其他状态与配置"),
        ]
        changes = [{"status": status, "path": path} for status, path, _ in paths]
        counts = resource_counts(changes)
        for status, path, label in paths:
            self.assertGreaterEqual(counts[label][status], 1, path)
        self.assertEqual(counts["从者数据 JSON"], {"A": 1, "M": 1, "D": 0})
        self.assertEqual(counts["从者原始 JSON"], {"A": 1, "M": 1, "D": 0})
        self.assertEqual(counts["战斗形态 JSON"]["M"], 2)
        self.assertEqual(sum(sum(values.values()) for values in counts.values()), len(paths))
        result = {"changed": True, "countsByResource": counts}
        summary = render_summary(result, "commit", "success")
        self.assertIn("| 从者数据 JSON | 1 | 1 | 0 |", summary)
        self.assertIn("| 概念礼装图片 | 0 | 0 | 1 |", summary)
        self.assertNotIn("servant-cn.json", summary)
        self.assertIn("推送失败", render_summary(result, "commit", "failure"))

    def test_no_change_summary_still_lists_each_resource_type(self):
        result = record_update(self.root, "1-1", "code", "run")
        summary = render_summary(result, "commit", "skipped")
        self.assertIn("更新结果：无变化", summary)
        self.assertIn("| 从者数据 JSON | 0 | 0 | 0 |", summary)

    def test_first_ce_cursor_is_recorded_without_requiring_a_previous_file(self):
        state = {"JP": {"hash": "ce-version", "timestamp": 1}}
        write_json(self.root / "state" / "atlas-ce-data-version.json", state)
        result = record_update(self.root, "5-1", "code", "run")
        report = json.loads((self.root / result["record"]).read_text())
        self.assertIsNone(report["atlasCeStateBefore"])
        self.assertEqual(report["atlasCeStateAfter"], state)
        self.assertEqual(report["countsByResource"]["Atlas 更新游标"]["A"], 1)

    def test_manifest_sync_only_stages_verified_published_manifest_and_can_repeat(self):
        self.release_base()
        manifest = read_release_manifest(self.root, 1)
        source_commit = manifest["source"]["dataCommit"]
        # Simulate data committed to private after the release's original snapshot.
        resource_path = self.root / "resources" / "servants.json"
        write_json(resource_path, {"newerData": True})
        git(self.root, "add", "--", "resources/servants.json")
        git(self.root, "commit", "-qm", "new data while publishing")
        version_before = (self.root / "assets" / "version.json").read_bytes()
        state_before = (self.root / "state" / "atlas-data-version.json").read_bytes()
        self.assertTrue(sync_manifest(self.root, self.store, 1, source_commit))
        self.assertEqual(json.loads((self.root / "assets" / "manifest.json").read_text()), manifest)
        self.assertEqual(git(self.root, "diff", "--cached", "--name-only").splitlines(), ["assets/manifest.json"])
        self.assertEqual(json.loads(resource_path.read_text()), {"newerData": True})
        self.assertEqual((self.root / "assets" / "version.json").read_bytes(), version_before)
        self.assertEqual((self.root / "state" / "atlas-data-version.json").read_bytes(), state_before)
        git(self.root, "commit", "-qm", "sync manifest")
        self.assertFalse(sync_manifest(self.root, self.store, 1, source_commit))

    def test_preview_and_failed_publish_cannot_write_back_manifest(self):
        self.release_base()
        original = (self.root / "assets" / "manifest.json").read_bytes()
        self.next_version()
        context = prepare(self.root, self.store, "patch")
        with self.assertRaisesRegex(ValueError, "unpublished manifest"):
            sync_manifest(self.root, self.store, 2, context["dataCommit"])
        self.store.fail_key = "patches/v1-to-v2.zip"
        with self.assertRaises(RuntimeError):
            publish(self.root, self.store)
        with self.assertRaises(ValueError):
            sync_manifest(self.root, self.store, 2, context["dataCommit"])
        self.assertEqual((self.root / "assets" / "manifest.json").read_bytes(), original)
        self.assertEqual(git(self.root, "diff", "--cached", "--name-only"), "")

    def test_manifest_sync_works_with_metadata_only_sparse_checkout(self):
        self.release_base()
        manifest = read_release_manifest(self.root, 1)
        git(self.root, "sparse-checkout", "set", "--no-cone", "/assets/manifest.json", "/assets/version.json")
        self.assertFalse((self.root / "resources" / "servants.json").exists())
        self.assertTrue(sync_manifest(self.root, self.store, 1, manifest["source"]["dataCommit"]))
        self.assertEqual(git(self.root, "diff", "--cached", "--name-only").splitlines(), ["assets/manifest.json"])

    def test_manifest_sync_refuses_wrong_source_or_incomplete_integrity_metadata(self):
        self.release_base()
        original = (self.root / "assets" / "manifest.json").read_bytes()
        manifest = read_release_manifest(self.root, 1)
        with self.assertRaisesRegex(ValueError, "different data commit"):
            sync_manifest(self.root, self.store, 1, "wrong-commit")
        manifest["base"]["packs"][0].pop("sha256")
        self.store.objects["manifests/manifest-v1.json"] = to_json_bytes(manifest)
        with self.assertRaisesRegex(ValueError, "incomplete integrity"):
            sync_manifest(self.root, self.store, 1, manifest["source"]["dataCommit"])
        self.assertEqual((self.root / "assets" / "manifest.json").read_bytes(), original)

    def test_manifest_sync_refuses_remote_latest_moving_during_read(self):
        self.release_base()
        original = (self.root / "assets" / "manifest.json").read_bytes()
        source_commit = read_release_manifest(self.root, 1)["source"]["dataCommit"]
        read = self.store.read_json
        latest_reads = 0

        def move_latest(key, **kwargs):
            nonlocal latest_reads
            if key == "latest.json":
                latest_reads += 1
                if latest_reads == 2:
                    self.store.objects[key] = to_json_bytes({"latest": 2})
            return read(key, **kwargs)

        with patch.object(self.store, "read_json", side_effect=move_latest):
            with self.assertRaisesRegex(ValueError, "changed while reading"):
                sync_manifest(self.root, self.store, 1, source_commit)
        self.assertEqual((self.root / "assets" / "manifest.json").read_bytes(), original)

    def test_manifest_sync_preserves_staged_work_and_newer_private_manifest(self):
        self.release_base()
        source_commit = read_release_manifest(self.root, 1)["source"]["dataCommit"]
        write_json(self.root / "resources" / "servants.json", {"changed": True})
        git(self.root, "add", "--", "resources/servants.json")
        with self.assertRaisesRegex(ValueError, "empty index"):
            sync_manifest(self.root, self.store, 1, source_commit)
        git(self.root, "commit", "-qm", "data")
        write_json(self.root / "assets" / "manifest.json", {"latest": 2})
        git(self.root, "add", "--", "assets/manifest.json")
        git(self.root, "commit", "-qm", "newer manifest")
        with self.assertRaisesRegex(ValueError, "newer than this release"):
            sync_manifest(self.root, self.store, 1, source_commit)

    def test_manifest_sync_refuses_to_downgrade_newer_private_version(self):
        self.release_base()
        source_commit = read_release_manifest(self.root, 1)["source"]["dataCommit"]
        write_json(self.root / "assets" / "version.json", {"version": 2})
        git(self.root, "add", "--", "assets/version.json")
        git(self.root, "commit", "-qm", "newer version")
        with self.assertRaisesRegex(ValueError, "newer than this release"):
            sync_manifest(self.root, self.store, 1, source_commit)

    def test_corrupt_image_and_missing_reference_fail_validation(self):
        target = self.root / "assets" / "icons" / "image.png"
        target.write_bytes(b"broken")
        with self.assertRaises(OSError):
            validate_assets(self.root)
        Image.new("RGB", (2, 2)).save(target)
        write_json(self.root / "assets" / "skills" / "1" / "data.json", {"icon": "https://example.com/missing.png"})
        with self.assertRaisesRegex(ValueError, "missing referenced image"):
            validate_assets(self.root)

    def test_patch_requires_previous_state(self):
        self.release_base()
        latest, _ = self.store.read_json("latest.json")
        latest.pop("state")
        self.store.objects["latest.json"] = to_json_bytes(latest)
        self.next_version()
        with self.assertRaisesRegex(ValueError, "no asset state"):
            prepare(self.root, self.store, "patch")
        with self.assertRaisesRegex(ValueError, "no asset state"):
            prepare(self.root, self.store, "base", base_compatible=True)


class R2Tests(unittest.TestCase):
    @patch.dict("os.environ", {"R2_BUCKET": "test", "R2_ENDPOINT": "https://r2.example", "AWS_PROFILE": "",
                               "AWS_ACCESS_KEY_ID": "test-access", "AWS_SECRET_ACCESS_KEY": "test-secret"}, clear=True)
    def test_empty_profile_is_removed_from_cli_environment_but_credentials_are_preserved(self):
        store = R2Store()
        with patch("assets_release.r2.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "{}", "")) as run:
            store.call("head-object", "latest.json")
        self.assertNotIn("--profile", run.call_args.args[0])
        environment = run.call_args.kwargs["env"]
        self.assertNotIn("AWS_PROFILE", environment)
        self.assertEqual(environment["AWS_ACCESS_KEY_ID"], "test-access")
        self.assertEqual(environment["AWS_SECRET_ACCESS_KEY"], "test-secret")
        self.assertEqual(os.environ["AWS_PROFILE"], "")

    def test_explicit_and_default_named_profiles_still_work(self):
        for settings, expected in (({}, "mash"), ({"AWS_PROFILE": "custom"}, "custom")):
            with self.subTest(profile=expected), patch.dict("os.environ", {
                "R2_BUCKET": "test", "R2_ENDPOINT": "https://r2.example", **settings,
            }, clear=True):
                with patch("assets_release.r2.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "{}", "")) as run:
                    R2Store().call("head-object", "latest.json")
                command = run.call_args.args[0]
                self.assertEqual(command[command.index("--profile") + 1], expected)
                self.assertEqual(run.call_args.kwargs["env"].get("AWS_PROFILE"), settings.get("AWS_PROFILE"))

    @patch.dict("os.environ", {"R2_BUCKET": "test", "R2_ENDPOINT": "https://r2.example", "AWS_PROFILE": ""}, clear=True)
    def test_legacy_patch_reader_also_removes_empty_profile(self):
        with patch("release.subprocess.run", return_value=subprocess.CompletedProcess([], 0, b"{}", b"")) as run:
            self.assertEqual(fetch_r2_object("latest.json"), b"{}")
        self.assertNotIn("--profile", run.call_args.args[0])
        self.assertNotIn("AWS_PROFILE", run.call_args.kwargs["env"])

    def test_shell_deployer_cleans_empty_profile_and_preserves_named_profiles(self):
        script = Path(__file__).resolve().parents[1] / "deploy-assets-release.sh"
        with tempfile.TemporaryDirectory(prefix="mash-aws-env-test-") as temp:
            root = Path(temp)
            release = root / "dist" / "assets-release"
            release.mkdir(parents=True)
            (release / "latest.json").write_text("{}")
            fake_aws = root / "aws"
            fake_aws.write_text(f'#!{sys.executable}\n' + '''import json, os, sys
with open(os.environ["AWS_TEST_LOG"], "a") as output:
    output.write(json.dumps({"profile": os.environ.get("AWS_PROFILE"), "args": sys.argv[1:]}) + "\\n")
''')
            fake_aws.chmod(0o755)
            for profile, expected in (("", None), ("custom", "custom"), (None, "mash")):
                with self.subTest(profile=profile):
                    log = root / "calls.jsonl"
                    log.unlink(missing_ok=True)
                    environment = {**os.environ, "PATH": f"{root}{os.pathsep}{os.environ.get('PATH', os.defpath)}",
                                   "MASH_DATA_ROOT": str(root), "R2_ENDPOINT": "https://r2.example", "R2_BUCKET": "test",
                                   "AWS_TEST_LOG": str(log)}
                    environment.pop("AWS_PROFILE", None)
                    if profile is not None:
                        environment["AWS_PROFILE"] = profile
                    subprocess.run(["bash", str(script)], env=environment, check=True, capture_output=True)
                    calls = [json.loads(line) for line in log.read_text().splitlines()]
                    self.assertEqual(len(calls), 2)
                    for call in calls:
                        if expected is None:
                            self.assertIsNone(call["profile"])
                            self.assertNotIn("--profile", call["args"])
                        else:
                            self.assertEqual(call["args"][call["args"].index("--profile") + 1], expected)

    @unittest.skipUnless(shutil.which("aws"), "AWS CLI is not installed")
    def test_real_aws_cli_accepts_empty_profile_via_store_without_network(self):
        # --generate-cli-skeleton output validates locally without sending a request.
        with patch.dict("os.environ", {
            "PATH": os.environ.get("PATH", os.defpath), "R2_BUCKET": "test", "R2_ENDPOINT": "https://r2.example",
            "AWS_PROFILE": "", "AWS_CONFIG_FILE": os.devnull, "AWS_SHARED_CREDENTIALS_FILE": os.devnull,
            "AWS_EC2_METADATA_DISABLED": "true", "AWS_DEFAULT_REGION": "auto",
        }, clear=True):
            self.assertIsInstance(R2Store().call("head-object", "latest.json", "--generate-cli-skeleton", "output"), dict)

    def test_rejects_path_traversal(self):
        for value in ("/absolute", "../x", "states/../../x", "a\\b", "a//b", "a/./b"):
            with self.assertRaises(ValueError):
                safe_path(value)

    @patch.dict("os.environ", {"R2_BUCKET": "test", "R2_ENDPOINT": "https://r2.example", "AWS_PROFILE": ""})
    def test_conditional_put_arguments(self):
        store = R2Store()
        with patch.object(store, "call", return_value={}) as call:
            store.put("latest.json", Path("latest.json"), etag='"old-etag"')
            args = call.call_args.args
            self.assertEqual(args[-2:], ("--if-match", '"old-etag"'))
            store.put("states/asset-state-v1.json", Path("state.json"))
            self.assertEqual(call.call_args.args[-2:], ("--if-none-match", "*"))


if __name__ == "__main__":
    unittest.main()
