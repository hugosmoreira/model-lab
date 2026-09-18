"""Offline regression checks for the exact public-reference classification.

Run: python -m unittest discover -s scripts -p test_release_secret_scan.py
Only the retained public upstream fixture and synthetic temporary Git data are
read; no scanner container, network, real dotenv or private run files are used.
"""

from hashlib import sha256
from pathlib import Path
import os
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from release_secret_scan import PUBLIC_REFERENCE, ROOT, review_scan
import image_vulnerability_scan
import release_secret_scan


class ScannerUserTest(unittest.TestCase):
    def test_posix_scanners_use_host_uid_and_gid(self):
        for module in (release_secret_scan, image_vulnerability_scan):
            with self.subTest(scanner=module.__name__):
                with patch.object(module, "os", SimpleNamespace(name="posix", getuid=lambda: 1001, getgid=lambda: 1002)):
                    self.assertEqual(module.scanner_user_args(), ["--user", "1001:1002"])

    def test_windows_scanners_preserve_default_user_without_posix_apis(self):
        for module in (release_secret_scan, image_vulnerability_scan):
            with self.subTest(scanner=module.__name__):
                with patch.object(module, "os", SimpleNamespace(name="nt")):
                    self.assertEqual(module.scanner_user_args(), [])


class PublicReferenceReviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = (ROOT / PUBLIC_REFERENCE["path"]).read_bytes()
        if sha256(cls.fixture).hexdigest() != PUBLIC_REFERENCE["blobSha256"]:
            raise AssertionError("Retained public fixture no longer matches its reviewed upstream blob")

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="model-lab-public-reference-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "source"
        self.working = self.root / "synthetic-history"
        self.history = self.root / "history.git"
        self.target = self.source / PUBLIC_REFERENCE["path"]
        self.target.parent.mkdir(parents=True)
        self.target.write_bytes(self.fixture)

    def finding(self, label="tree", **overrides):
        return {
            "RuleID": PUBLIC_REFERENCE["rule"],
            "File": ("/source/" if label == "tree" else "") + PUBLIC_REFERENCE["path"],
            "StartLine": PUBLIC_REFERENCE["startLine"], "EndLine": PUBLIC_REFERENCE["endLine"],
            "Commit": "", "Fingerprint": "synthetic-public-reference",
            **overrides,
        }

    def review(self, findings, label="tree", exit_code=1):
        return review_scan(label, findings, exit_code, self.source, self.history)

    def git(self, *args, cwd=None):
        return subprocess.run(
            ["git", "-c", "core.autocrlf=false", "-c", "user.name=Synthetic Release Test",
             "-c", "user.email=release-test@example.invalid", *map(str, args)],
            cwd=cwd or self.working, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=True, timeout=20,
            env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
        ).stdout.decode().strip()

    def create_history(self):
        self.working.mkdir()
        self.git("init", "--quiet")
        target = self.working / PUBLIC_REFERENCE["path"]
        target.parent.mkdir(parents=True)
        target.write_bytes(self.fixture)
        self.git("add", "--", PUBLIC_REFERENCE["path"])
        self.git("commit", "--quiet", "-m", "Synthetic public reference fixture")
        known = self.git("rev-parse", "HEAD")
        target.write_bytes(self.fixture + b"\n# synthetic modification\n")
        self.git("add", "--", PUBLIC_REFERENCE["path"])
        self.git("commit", "--quiet", "-m", "Synthetic changed blob fixture")
        modified = self.git("rev-parse", "HEAD")
        self.git("clone", "--quiet", "--bare", self.working, self.history)
        return known, modified

    def test_exact_tree_reference_preserves_scanner_result_and_redaction(self):
        finding = self.finding(Secret="synthetic-hidden-value", Match="synthetic-hidden-match")
        result = self.review([finding])
        self.assertEqual((result["count"], result["exitCode"], result["unresolvedCount"]), (1, 1, 0))
        self.assertEqual(result["findings"][0]["RuleID"], finding["RuleID"])
        self.assertNotIn("Secret", result["findings"][0])
        self.assertNotIn("Match", result["findings"][0])
        self.assertEqual(result["reviewedPublicReferences"][0]["sourceUrl"], PUBLIC_REFERENCE["sourceUrl"])

    def test_same_line_in_modified_blob_still_blocks(self):
        self.target.write_bytes(self.fixture + b"\n# synthetic modification\n")
        result = self.review([self.finding()])
        self.assertEqual(result["unresolvedCount"], 1)
        self.assertEqual(result["reviewedPublicReferences"], [])

    def test_changed_path_rule_line_and_commit_do_not_read_any_file(self):
        variants = [
            {"File": "/source/other/SOURCE-DEPS.txt"},
            {"File": "/source/../licenses/chrome-headless-shell-153.0.8010.52/SOURCE-DEPS.txt"},
            {"RuleID": "other-rule"}, {"StartLine": 509}, {"EndLine": 509},
            {"Commit": "unexpected-tree-commit"},
        ]
        with patch.object(Path, "open", side_effect=AssertionError("Unexpected file read")):
            for variant in variants:
                with self.subTest(fields=tuple(variant)):
                    self.assertEqual(self.review([self.finding(**variant)])["unresolvedCount"], 1)

    def test_unrelated_finding_still_blocks_with_known_reference(self):
        result = self.review([self.finding(), self.finding(RuleID="other-rule")])
        self.assertEqual((result["count"], len(result["reviewedPublicReferences"]), result["unresolvedCount"]), (2, 1, 1))

    def test_history_uses_recorded_blob_and_changed_history_still_blocks(self):
        known, modified = self.create_history()
        # The candidate snapshot is intentionally different. History must not
        # use it to verify an earlier commit.
        self.target.write_bytes(b"synthetic unrelated current tree")
        result = self.review([self.finding("history", Commit=known)], "history")
        self.assertEqual(result["unresolvedCount"], 0)
        self.assertEqual(result["reviewedPublicReferences"][0]["blobSource"], {"kind": "scanned-history-blob", "commit": known})
        self.assertEqual(self.review([self.finding("history", Commit=modified)], "history")["unresolvedCount"], 1)

    def test_history_invalid_revision_is_unresolved_without_git(self):
        with patch("release_secret_scan.subprocess.run", side_effect=AssertionError("Unexpected Git lookup")):
            self.assertEqual(self.review([self.finding("history", Commit="HEAD:other")], "history")["unresolvedCount"], 1)

    def test_evidence_tool_failures_remain_failures(self):
        with patch("release_secret_scan.subprocess.run", side_effect=OSError("synthetic Git failure")):
            with self.assertRaises(RuntimeError):
                self.review([self.finding("history", Commit="0" * 40)], "history")
        self.target.unlink()
        with self.assertRaises(RuntimeError):
            self.review([self.finding()])

    def test_scanner_errors_and_unreadable_results_remain_failures(self):
        for findings, exit_code in [([], 2), ([], 1), ({}, 0), ([None], 0), ([self.finding()], 0)]:
            with self.subTest(exit_code=exit_code, kind=type(findings).__name__):
                with self.assertRaises(RuntimeError):
                    self.review(findings, exit_code=exit_code)
        self.assertEqual(self.review([], exit_code=0)["unresolvedCount"], 0)


if __name__ == "__main__":
    unittest.main()
