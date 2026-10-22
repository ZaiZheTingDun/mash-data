from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "push_release_metadata.sh"


class ReleaseWritebackTests(unittest.TestCase):
    def git(self, root, *args):
        return subprocess.run(["git", "-c", "core.hooksPath=/dev/null", *args], cwd=root,
                              check=True, capture_output=True, text=True).stdout.strip()

    def configure(self, root):
        self.git(root, "config", "user.name", "Test")
        self.git(root, "config", "user.email", "test@example.com")
        self.git(root, "config", "commit.gpgsign", "false")
        self.git(root, "config", "tag.gpgsign", "false")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mash-writeback-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "private"
        self.remote = Path(self.temp.name) / "origin.git"
        self.root.mkdir()
        self.git(self.root, "init", "-q", "-b", "main")
        self.configure(self.root)
        (self.root / "assets").mkdir()
        self.metadata(18)
        self.git(self.root, "commit", "-qm", "initial metadata")
        self.git(self.root, "init", "--bare", "-q", "-b", "main", str(self.remote))
        self.git(self.remote, "config", "uploadpack.allowFilter", "true")
        self.git(self.root, "remote", "add", "origin", str(self.remote))
        self.git(self.root, "push", "-q", "origin", "main")

    def metadata(self, version):
        for name, payload in (("manifest.json", {"latest": version}), ("version.json", {"version": version})):
            (self.root / "assets" / name).write_text(json.dumps(payload))
        self.git(self.root, "add", "--", "assets/manifest.json", "assets/version.json")

    def run_script(self, root=None):
        return subprocess.run(["bash", str(SCRIPT)], cwd=root or self.root, capture_output=True, text=True,
                              env={**os.environ, "RELEASE_VERSION": "19", "PRIVATE_DATA_BRANCH": "main"})

    def test_sync_commit_and_tag_are_pushed_and_retry_adds_no_commit(self):
        self.metadata(19)
        (self.root / "unrelated.txt").write_text("unstaged")
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        commit = self.git(self.root, "rev-parse", "HEAD")
        self.assertEqual(self.git(self.remote, "rev-parse", "refs/heads/main"), commit)
        self.assertEqual(self.git(self.remote, "rev-parse", "refs/tags/v19"), commit)
        self.assertEqual(self.git(self.root, "log", "-1", "--format=%s"), "chore(data): sync published release v19")
        self.assertEqual(self.git(self.root, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").splitlines(),
                         ["assets/manifest.json", "assets/version.json"])
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git(self.root, "rev-parse", "HEAD"), commit)

    def test_shallow_retry_tags_original_sync_commit_after_branch_advances(self):
        self.metadata(19)
        self.git(self.root, "commit", "-qm", "chore(data): sync published release v19")
        sync_commit = self.git(self.root, "rev-parse", "HEAD")
        (self.root / "data.txt").write_text("new data")
        self.git(self.root, "add", "data.txt")
        self.git(self.root, "commit", "-qm", "later data update")
        self.git(self.root, "push", "-q", "origin", "main")
        retry = Path(self.temp.name) / "retry"
        self.git(self.root, "clone", "-q", "--depth=1", "--no-tags", self.remote.as_uri(), str(retry))
        self.configure(retry)
        head = self.git(retry, "rev-parse", "HEAD")
        result = self.run_script(retry)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git(self.remote, "rev-parse", "refs/tags/v19"), sync_commit)
        self.assertEqual(self.git(retry, "rev-parse", "HEAD"), head)

    def test_conflicting_remote_tag_rejects_branch_and_tag_together(self):
        original = self.git(self.remote, "rev-parse", "main")
        self.git(self.remote, "tag", "v19", original)
        self.metadata(19)
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git(self.remote, "rev-parse", "main"), original)
        self.assertEqual(self.git(self.remote, "rev-parse", "v19"), original)

    def test_concurrent_branch_push_rejects_tag_too(self):
        other = Path(self.temp.name) / "other"
        self.git(self.root, "clone", "-q", str(self.remote), str(other))
        self.configure(other)
        self.git(other, "commit", "--allow-empty", "-qm", "concurrent change")
        self.git(other, "push", "-q", "origin", "main")
        self.metadata(19)
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git(self.remote, "rev-parse", "main"), self.git(other, "rev-parse", "HEAD"))
        self.assertEqual(self.git(self.remote, "tag", "--list", "v19"), "")

    def test_missing_sync_commit_does_not_tag_arbitrary_head(self):
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Cannot find private sync commit", result.stderr)
        self.assertEqual(self.git(self.remote, "tag", "--list", "v19"), "")

    def test_changed_metadata_since_sync_is_rejected(self):
        self.metadata(19)
        self.git(self.root, "commit", "-qm", "chore(data): sync published release v19")
        (self.root / "assets/manifest.json").write_text('{"latest": 19, "changed": true}')
        self.git(self.root, "add", "assets/manifest.json")
        self.git(self.root, "commit", "-qm", "later manifest edit")
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not match verified release metadata", result.stderr)
        self.assertEqual(self.git(self.remote, "tag", "--list", "v19"), "")


if __name__ == "__main__":
    unittest.main()
