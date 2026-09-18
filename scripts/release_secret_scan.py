"""Offline, redacted Gitleaks check of candidate files and all local Git refs.

Never mounts the working directory, ignored dotenv files, private run data,
Git configuration, or hooks into the scanner. No source is uploaded. Run with
Python 3.10+ and Docker; this only downloads the verified scanner image.
"""

import argparse
from hashlib import sha256
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

from docker_release_check import ROOT, command, output, source_snapshot

# Official ghcr.io/gitleaks/gitleaks index, resolved 2026-09-18.
SCANNER = "ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"

# Independently fetched and byte-compared with the public pinned upstream blob
# on 2026-09-18. This classifies only the recorded revision-pin finding; the
# scanner still runs its full default rules and retains its original exit code.
PUBLIC_REFERENCE = {
    "id": "chromium-153.0.8010.52-public-ukey2-revision",
    "rule": "generic-api-key",
    "path": "licenses/chrome-headless-shell-153.0.8010.52/SOURCE-DEPS.txt",
    "startLine": 508,
    "endLine": 508,
    "blobSha256": "c7fce0bedafabba14461759e2ee004dbc4ec9ec84d95e1ee328c17732c4f9ab1",
    "blobBytes": 196718,
    "sourceUrl": "https://chromium.googlesource.com/chromium/src/+/78e5e45d4bb41035e17ea4da2cc257f496416ac9/DEPS?format=TEXT",
    "reason": "Exact unmodified public Chromium DEPS blob; this line records an upstream source revision, not a credential.",
}


def scanner_user_args():
    # With all capabilities dropped, even container UID 0 cannot bypass a
    # Linux report directory owned by another user with mode 0755.
    if os.name == "posix":
        return ["--user", f"{os.getuid()}:{os.getgid()}"]
    return []  # Docker Desktop bind ownership differs; preserve Windows behavior.


def classify_public_reference(label, finding, source, history):
    """Return review evidence only for the exact finding and whole public blob.

    Tree bytes come from the isolated candidate snapshot. History bytes come
    from the scanned bare clone at the finding's commit, never the worktree.
    No finding-supplied path is opened or interpolated into a command.
    """
    known = PUBLIC_REFERENCE
    expected_path = "/source/" + known["path"] if label == "tree" else known["path"]
    if label not in ("tree", "history") or any((
        finding.get("RuleID") != known["rule"],
        finding.get("File") != expected_path,
        finding.get("StartLine") != known["startLine"],
        finding.get("EndLine") != known["endLine"],
    )):
        return None
    commit = finding.get("Commit")
    try:
        if label == "tree":
            if commit not in (None, ""):
                return None
            path = source / known["path"]
            if path.is_symlink() or not path.resolve().is_relative_to(source.resolve()):
                raise RuntimeError("Public-reference candidate path is not an isolated snapshot file")
            with path.open("rb") as stream:
                blob = stream.read(known["blobBytes"] + 1)
            provenance = {"kind": "isolated-candidate-snapshot"}
        else:
            if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit):
                return None
            result = subprocess.run(
                ["git", "--no-replace-objects", "--git-dir", str(history), "show",
                 "--no-ext-diff", "--no-textconv", commit + ":" + known["path"]],
                cwd=history.parent, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                check=False, timeout=30,
                env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
            )
            if result.returncode:
                raise RuntimeError("Could not read scanned history blob for public-reference verification")
            blob = result.stdout
            provenance = {"kind": "scanned-history-blob", "commit": commit}
    except (OSError, subprocess.SubprocessError):
        raise RuntimeError("Could not verify public-reference bytes; release scan remains failed") from None
    if len(blob) != known["blobBytes"] or sha256(blob).hexdigest() != known["blobSha256"]:
        return None
    return {**known, "classification": "reviewed-public-reference", "blobSource": provenance}


def review_scan(label, findings, exit_code, source, history):
    """Keep scanner findings intact and separately report unresolved findings."""
    if exit_code not in (0, 1):
        raise RuntimeError(f"{label} secret scan could not complete (exit {exit_code}); no scanner output printed")
    if not isinstance(findings, list) or any(not isinstance(item, dict) for item in findings):
        raise RuntimeError(f"{label} scan did not produce a valid findings array")
    if exit_code == 1 and not findings:
        raise RuntimeError(f"{label} scan failed without readable findings; cannot treat it as passed")
    if exit_code == 0 and findings:
        raise RuntimeError(f"{label} scan reported findings with a contradictory successful exit code")
    safe = [
        {key: finding.get(key) for key in ("RuleID", "File", "StartLine", "EndLine", "Commit", "Fingerprint")}
        for finding in findings
    ]
    reviewed = []
    for index, finding in enumerate(safe):
        classification = classify_public_reference(label, finding, source, history)
        if classification is not None:
            reviewed.append({"findingIndex": index, **classification})
    return {
        "findings": safe, "count": len(safe), "exitCode": exit_code,
        "reviewedPublicReferences": reviewed,
        "unresolvedCount": len(safe) - len(reviewed),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts-data" / "release-secrets.json")
    args = parser.parse_args()
    command("docker", "pull", SCANNER, timeout=300, capture=False)
    report = {
        "scannerImage": SCANNER,
        "revision": output("git", "rev-parse", "HEAD"),
        "workingTreeDirty": bool(output("git", "status", "--porcelain")),
        "historyCommits": int(output("git", "rev-list", "--all", "--count")),
        "scope": "Current tracked/unignored candidate files and all local refs; ignored private files excluded; no reflogs or unreachable objects",
        "status": "failed", "scans": {},
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix="model-lab-secret-check-") as directory:
            root = Path(directory).resolve()
            source = root / "source"
            source.mkdir()
            report["sourceFiles"] = source_snapshot(source)
            bundle = root / "history.bundle"
            command("git", "bundle", "create", bundle, "--all")
            history = root / "history.git"
            command("git", "clone", "--bare", bundle, history)
            reports = root / "reports"
            reports.mkdir()
            policy = root / "default.toml"
            policy.write_text("[extend]\nuseDefault = true\n", encoding="utf-8")
            common = [
                "docker", "run", "--rm", "--network", "none", "--read-only",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                *scanner_user_args(),
                "--mount", f"type=bind,source={reports},target=/reports",
                "--mount", f"type=bind,source={policy},target=/default.toml,readonly",
                "--env", "GIT_CONFIG_COUNT=1", "--env", "GIT_CONFIG_KEY_0=safe.directory",
                "--env", "GIT_CONFIG_VALUE_0=/history.git",
            ]
            report["scannerVersion"] = output("docker", "run", "--rm", "--network", "none", SCANNER, "version")
            for label, directory, target, scan_args in (
                ("tree", source, "/source", ["dir", "/source"]),
                ("history", history, "/history.git", ["git", "--log-opts=--all", "/history.git"]),
            ):
                # Captured scanner output is intentionally never echoed: only
                # reviewed, non-secret metadata survives into the final report.
                result = command(
                    *common, "--mount", f"type=bind,source={directory},target={target},readonly",
                    SCANNER, *scan_args, "--config", "/default.toml", "--redact=100",
                    "--no-banner", "--no-color", "--ignore-gitleaks-allow",
                    "--report-format", "json", "--report-path", f"/reports/{label}.json",
                    "--timeout", "180", check=False, timeout=240,
                )
                if result.returncode not in (0, 1):
                    raise RuntimeError(f"{label} secret scan could not complete (exit {result.returncode}); no scanner output printed")
                path = reports / f"{label}.json"
                if not path.is_file():
                    raise RuntimeError(f"{label} scan produced no report; cannot treat it as passed")
                findings = json.loads(path.read_text(encoding="utf-8"))
                # Preserve redacted raw results even if subsequent evidence
                # verification encounters a tool or filesystem error.
                if isinstance(findings, list) and all(isinstance(item, dict) for item in findings):
                    report["scans"][label] = {
                        "findings": [
                            {key: item.get(key) for key in ("RuleID", "File", "StartLine", "EndLine", "Commit", "Fingerprint")}
                            for item in findings
                        ],
                        "count": len(findings), "exitCode": result.returncode,
                        "reviewedPublicReferences": [], "unresolvedCount": len(findings),
                    }
                report["scans"][label] = review_scan(label, findings, result.returncode, source, history)
            report["unresolvedCount"] = sum(scan["unresolvedCount"] for scan in report["scans"].values())
            report["reviewedPublicReferenceCount"] = sum(len(scan["reviewedPublicReferences"]) for scan in report["scans"].values())
            report["status"] = "passed" if report["unresolvedCount"] == 0 else "findings"
    finally:
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"Redacted secret scan report: {args.report.resolve()}")
    if report["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
