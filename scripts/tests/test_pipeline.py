from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from assets_release.json_utils import to_json_bytes, write_json
from assets_release.r2 import R2Store, safe_path, verify_file
from pipeline_release import prepare, publish
from record_data_update import git, record_update
from validate_assets import APPEND_ICONS, validate_assets


def entry(content: bytes) -> dict:
    return {"size": len(content), "sha256": hashlib.sha256(content).hexdigest()}


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
        write_json(self.root / "assets" / "version.json", {"version": 2})
        write_json(self.root / "assets" / "skills" / "1" / "data.json", {"id": 2})

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

    def test_refuses_reused_version_and_unconfirmed_base(self):
        self.release_base()
        with self.assertRaisesRegex(ValueError, "must be newer"):
            prepare(self.root, self.store, "patch")
        self.next_version()
        with self.assertRaisesRegex(ValueError, "compatibility"):
            prepare(self.root, self.store, "base")

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
        self.assertNotIn("unrelated.txt", git(self.root, "diff", "--cached", "--name-only"))

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


class R2Tests(unittest.TestCase):
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
