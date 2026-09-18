"""Build and test one Linux image with synthetic data; never publish anything.

Python 3.10+ and Docker are the only host dependencies. Run from any directory:
  python scripts/docker_release_check.py --image model-lab:release-check
Use --skip-build to smoke-test an already pulled immutable image. Image-layer
credential exclusion is exercised only by the normal synthetic-context build.
"""

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from check_image_layers import inspect_forbidden_layer_paths, inspect_image_archive

ROOT = Path(__file__).resolve().parents[1]


def command(*args, capture=True, timeout=180, check=True, cwd=ROOT):
    print("+ " + " ".join(str(arg) for arg in args), flush=True)
    return subprocess.run(
        [str(arg) for arg in args], cwd=cwd, check=check, timeout=timeout,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        text=True, encoding="utf-8", errors="replace",
    )


def output(*args, **kwargs):
    return command(*args, **kwargs).stdout.strip()


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def source_snapshot(destination):
    """Include local implementation edits, never ignored local data or secrets."""
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT, check=True, stdout=subprocess.PIPE,
    )
    count = 0
    for raw in set(result.stdout.split(b"\0")):
        if not raw:
            continue
        relative = Path(os.fsdecode(raw))
        source = ROOT / relative
        # A deleted tracked file belongs to the candidate's deletion, not its image.
        if not source.exists():
            continue
        expect(source.resolve().is_relative_to(ROOT), "Source path escaped the project")
        expect(not source.is_symlink(), f"Review source symlink before packaging: {relative}")
        if relative.name == ".env" or relative.name.startswith(".env."):
            expect(relative.as_posix() in (".env.example", "apps/web/.env.example"), f"Refusing real dotenv source: {relative}")
        expect("artifacts-data" not in relative.parts, "Refusing private artifact source")
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        count += 1
    return count


def build_image(image, work, report):
    context = work / "context"
    context.mkdir()
    report["sourceFiles"] = source_snapshot(context)
    marker = "MODEL_LAB_SYNTHETIC_CREDENTIAL_" + uuid.uuid4().hex
    sentinels = (
        ".env", ".env.local", "apps/web/.env.local", "apps/web/.env.production.local",
        "packages/store/fixture/.env", "packages/store/fixture/.env.example",
        "artifacts-data/private-output.txt", "apps/web/artifacts-data/private-output.txt",
        "packages/store/fixture/private.db", "packages/store/fixture/private.db-wal",
        "packages/store/fixture/private.db-shm", "apps/web/fixture/private.sqlite3",
    )
    for relative in sentinels:
        path = context / relative
        expect(not path.exists(), f"Synthetic sentinel would overwrite source: {relative}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"MODEL_LAB_PACKAGING_SENTINEL={marker}\n", encoding="utf-8")
    command(
        "docker", "build", "--platform", "linux/amd64", "--progress", "plain",
        "--build-arg", f"MODEL_LAB_SOURCE_REVISION={report['revision']}",
        "--build-arg", f"MODEL_LAB_SOURCE_DIRTY={int(report['workingTreeDirty'])}",
        "--tag", image, context, capture=False, timeout=1800,
    )
    archive = work / "image.tar"
    command("docker", "image", "save", "--output", archive, image, timeout=600)
    report["sentinelLayerCheck"] = inspect_image_archive(archive, marker)
    report["runtimeDependencyLayerExclusion"] = inspect_forbidden_layer_paths(
        archive, (
            r"^app/node_modules/\.pnpm/(?:sharp@|@img\+sharp-)",
            r"^app/node_modules/\.pnpm/(?:eslint(?:@|-)|@eslint\+|@typescript-eslint\+|typescript-eslint@|prettier@|stable-hash@|tailwindcss@|@tailwindcss\+)",
            r"^(?:usr/)?lib/[^/]+/libexpat\.so\.(?!1\.12\.4$)[0-9]+\.[0-9]+\.[0-9]+$",
        ),
    )
    report["sentinelLayerCheck"]["syntheticPaths"] = list(sentinels)
    archive.unlink()


def request(base, path, payload=None, headers=None):
    if headers is None and payload is not None:
        headers = {"Content-Type": "application/json", "Origin": base}
    req = urllib.request.Request(
        base + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers or {},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        data = response.read()
        return json.loads(data) if "application/json" in response.headers.get("Content-Type", "") else data


def rejected_request(base, path, payload, status, headers=None):
    try:
        request(base, path, payload, headers)
        raise AssertionError(f"Request unexpectedly succeeded: {path}")
    except urllib.error.HTTPError as error:
        expect(error.code == status, f"{path} returned {error.code}, expected {status}")


def mutation_checks(base, run_id, config):
    annotation_path = f"/api/runs/{run_id}/annotations"
    vote_path = f"/api/runs/{run_id}/votes"
    annotation = {"endpointId": config["endpointIds"][0], "sampleIndex": 1, "note": "Synthetic container check", "scoreOverride": 8}
    queue = request(base, vote_path)
    expect(len(queue["pairs"]) > 0, "Synthetic two-model run has no comparison pairs")
    vote = {"pairIndex": queue["pairs"][0]["pairIndex"], "vote": "tie", "confidence": "med"}
    before = {"runs": request(base, "/api/runs"), "annotations": request(base, annotation_path), "votes": queue}
    for path, valid in (("/api/runs", config), (annotation_path, annotation), (vote_path, vote)):
        for origin in ("https://untrusted.invalid", "null", None):
            headers = {"Content-Type": "application/json"}
            if origin is not None:
                headers["Origin"] = origin
            rejected_request(base, path, valid, 403, headers)
        rejected_request(base, path, valid, 415, {"Content-Type": "text/plain", "Origin": base})
        rejected_request(base, path, valid, 403, {"Content-Type": "application/json", "Origin": base, "Sec-Fetch-Site": "cross-site"})
        rejected_request(base, path, {}, 400)
    after = {"runs": request(base, "/api/runs"), "annotations": request(base, annotation_path), "votes": request(base, vote_path)}
    expect(before == after, "Rejected mutation changed persisted run, annotation or vote state")
    request(base, annotation_path, annotation)
    expect(len(request(base, annotation_path)["annotations"]) == len(before["annotations"]["annotations"]) + 1, "Valid same-origin annotation was not saved")
    request(base, vote_path, vote)
    saved = request(base, vote_path)
    expect(any(pair["pairIndex"] == vote["pairIndex"] and pair["final"] for pair in saved["pairs"]), "Valid same-origin final vote was not saved")
    rejected_request(base, vote_path, vote, 409)


def wait_health(base, read_only=False):
    deadline = time.monotonic() + 90
    last_error = None
    while time.monotonic() < deadline:
        try:
            health = request(base, "/api/health/store")
            expect(health["ok"] and health["backend"] == "sqlite", "SQLite health failed")
            expect(health["readOnly"] == read_only, "Unexpected read-only mode")
            return health
        except (OSError, ValueError, AssertionError) as error:
            last_error = error
            time.sleep(1)
    raise RuntimeError(f"Container did not become healthy: {last_error}")


def start_container(image, name, volume, network, read_only=False):
    # Port mapping changes the public origin from Next's internal listen URL.
    # Choose a loopback port first so the configured trusted origin is explicit.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        host_port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{host_port}"
    command(
        "docker", "run", "--detach", "--name", name, "--init",
        "--network", network, "--publish", f"127.0.0.1:{host_port}:3000",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--shm-size", "256m", "--memory", "2g", "--pids-limit", "512",
        "--volume", f"{volume}:/data", "--env", "MODEL_LAB_MOCK_PROVIDERS=1",
        "--env", "MODEL_LAB_JUDGE=0", "--env", f"MODEL_LAB_READ_ONLY={int(read_only)}",
        "--env", f"MODEL_LAB_APP_ORIGIN={base}",
        image,
    )
    binding = output("docker", "port", name, "3000/tcp").splitlines()[0]
    expect(binding.startswith("127.0.0.1:"), "Smoke server must bind only host loopback")
    expect(base == "http://" + binding, "Published port differs from configured application origin")
    wait_health(base, read_only)
    return base


def get_run(base, run_id):
    return next((run for run in request(base, "/api/runs")["runs"] if run["id"] == run_id), None)


def wait_run(base, run_id):
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        run = get_run(base, run_id)
        if run and run["status"] in ("completed", "partial", "failed", "cancelled"):
            return run
        time.sleep(1)
    raise RuntimeError(f"Synthetic run {run_id} did not stop within four minutes")


def read_bundle(base, run_id):
    data = request(base, f"/api/runs/{run_id}/bundle")
    with zipfile.ZipFile(io.BytesIO(data)) as bundle:
        names = bundle.namelist()
        expect("manifest.json" in names, "Bundle has no manifest")
        expect(any(name.startswith("artifacts/") and name.endswith(".html") for name in names), "Bundle has no HTML evidence")
        expect(any(name.startswith("screenshots/") and name.endswith(".png") for name in names), "Chromium produced no screenshot")
        manifest = json.loads(bundle.read("manifest.json"))
        expect(manifest["runId"] == run_id, "Bundle identity changed")
        # Export metadata may include a unique export timestamp; evidence itself
        # must remain byte-identical after restart and restore.
        evidence = {
            name: hashlib.sha256(bundle.read(name)).hexdigest() for name in names
            if name.startswith(("artifacts/", "screenshots/", "raw/")) and not name.endswith("/")
        }
        return {"files": len(names), "fingerprint": manifest["fingerprint"], "evidence": evidence}


def smoke_image(image, work, report, check_interrupted):
    token = "model-lab-check-" + uuid.uuid4().hex[:12]
    network = token + "-net"
    volume = token + "-data"
    restored = token + "-restored"
    primary = token + "-app"
    recovery = token + "-recovery"
    backup_container = token + "-backup"
    restore_container = token + "-restore"
    containers = (primary, recovery, backup_container, restore_container)
    created_volumes = []
    network_created = False
    try:
        # A dedicated bridge supports loopback-published ports on Docker Desktop;
        # internal networks deliberately omit published ports on newer engines.
        # No provider keys are supplied and every generated sample is a mock.
        command("docker", "network", "create", network)
        network_created = True
        for name in (volume, restored):
            command("docker", "volume", "create", name)
            created_volumes.append(name)
        base = start_container(image, primary, volume, network)
        report["runtime"] = json.loads(output(
            "docker", "exec", primary, "node", "-e",
            "const fs=require('node:fs'); if(process.getuid()===0)throw Error('root runtime');"
            "fs.writeFileSync('/data/runtime-write-check','synthetic');"
            "console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),node:process.version}));",
        ))
        cli_output = output(
            "docker", "run", "--rm", "--network", "none", "--read-only",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
            "--tmpfs", "/tmp:rw,nosuid,size=64m", "--env", "MODEL_LAB_MOCK_PROVIDERS=1",
            "--env", "MODEL_LAB_STORE=memory", "--entrypoint", "model-lab", image, "packs",
        )
        expect("raycaster-oneshot" in cli_output, "Direct container CLI did not list the bundled benchmark")
        output(
            "docker", "run", "--rm", "--network", "none", "--read-only",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--init",
            "--shm-size", "256m", "--memory", "2g", "--pids-limit", "512",
            "--tmpfs", "/tmp:rw,nosuid,size=256m", "--env", "MODEL_LAB_MOCK_PROVIDERS=1",
            "--env", "MODEL_LAB_JUDGE=0", "--env", "MODEL_LAB_STORE=memory",
            "--entrypoint", "model-lab", image, "run", "--pack", "raycaster-oneshot",
            "--models", "anthropic/claude-sonnet-4-6", "--samples", "1", "--budget", "1",
            "--mock", "--store", "memory", "--quiet", "--fail-under", "0.5", timeout=180,
        )
        output("docker", "exec", primary, "node", "-e",
               "const fs=require('node:fs');for(const p of ['/opt/corepack','/usr/local/lib/node_modules/npm',"
               "'/usr/local/lib/node_modules/corepack','/usr/local/bin/pnpm','/usr/local/bin/yarn'])"
               "if(fs.existsSync(p))throw Error('Unexpected runtime installer: '+p);")
        report["containerCli"] = "passed: direct CLI lists packs and completes a mocked benchmark offline; package-manager installers absent"
        rejected_request(base, "/_next/image?url=%2Fapi%2Fhealth%2Fstore&w=64&q=75", None, 404)
        output("docker", "exec", primary, "node", "-e",
               "const fs=require('node:fs');if(fs.readdirSync('/app/node_modules/.pnpm')"
               ".some(n=>/^(sharp@|@img\\+sharp-)/.test(n)))throw Error('Unused Sharp decoder shipped');")
        privileged_files = output("docker", "exec", primary, "find", "/usr", "-xdev", "-type", "f",
                                  "(", "-perm", "-4000", "-o", "-perm", "-2000", ")", "-print")
        expect(not privileged_files, "Runtime still contains setuid/setgid programs")
        report["removedAttackSurface"] = "passed: image optimizer HTTP404, Sharp native packages and setuid/setgid programs absent"
        report["packagedLicenseInventory"] = json.loads(output(
            "docker", "exec", "--workdir", "/app", primary, "node", "scripts/image_license_inventory.mjs",
        ))
        report["expatPackage"] = output("docker", "exec", primary, "dpkg-query", "-W", "libexpat1")
        expect(report["expatPackage"] == "libexpat1:amd64\t2.8.4-0modellab1", "Unexpected Expat package version")
        report["expatLibrary"] = output("docker", "exec", primary, "readlink", "-f", "/lib/x86_64-linux-gnu/libexpat.so.1")
        expect(report["expatLibrary"].endswith("/libexpat.so.1.12.4"), "Unexpected Expat ABI target")
        report["expatSha256"] = output("docker", "exec", primary, "sha256sum", report["expatLibrary"]).split()[0]
        report["expatNotices"] = json.loads(output(
            "docker", "exec", primary, "node", "-e",
            "const fs=require('node:fs'),crypto=require('node:crypto');const root='/usr/share/doc/libexpat1/';"
            "const files=['copyright','changelog','build-recipe.sh','source-provenance.txt'];"
            "const records=files.map(name=>{const b=fs.readFileSync(root+name);if(!b.length)throw Error('Empty Expat notice');"
            "return {path:root+name,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};});"
            "if(!fs.readFileSync(root+'source-provenance.txt','utf8').includes('656ae1cc8da3b4ea513bb4e254f33e6243938084c0ec6239da873376b09985a7'))"
            "throw Error('Expat source provenance missing');console.log(JSON.stringify(records));",
        ))
        chromium_launch = command(
            "docker", "exec", "--env", "DEBUG=pw:browser", "--workdir", "/app", primary,
            "node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "-e",
            "const {chromium}=require('./runners/build-arena/node_modules/playwright');"
            "(async()=>{const {artifactBrowserExecutable,supportedBrowserVersion}=await import('./runners/build-arena/src/checks/browser-runtime.ts');"
            "const b=await chromium.launch({headless:true,executablePath:artifactBrowserExecutable(),env:{...process.env,LD_DEBUG:'libs'}});"
            "try{if(!supportedBrowserVersion(b.version()))throw Error('Browser below patched minimum');console.log(b.version());}finally{await b.close();}})()"
            ".catch(e=>{console.error(e);process.exit(1)});",
        )
        report["chromium"] = chromium_launch.stdout.strip()
        report["expatBrowserLoader"] = sorted({
            line.split("calling init:", 1)[1].strip() for line in chromium_launch.stderr.splitlines()
            if "calling init:" in line and "libexpat.so.1" in line
        })
        expect(report["expatBrowserLoader"], "Browser did not dynamically load the verified Expat library")
        for loaded_path in report["expatBrowserLoader"]:
            resolved = output("docker", "exec", primary, "readlink", "-f", loaded_path)
            expect(resolved == report["expatLibrary"], "Browser loaded an alternate Expat library")
            loaded_sha = output("docker", "exec", primary, "sha256sum", resolved).split()[0]
            expect(loaded_sha == report["expatSha256"], "Loaded Expat library hash changed")
        config = {
            "name": "Synthetic container release check", "mode": "build-arena",
            "packSlug": "raycaster-oneshot", "endpointIds": ["anthropic/claude-sonnet-4-6", "openai/gpt-5-mini"],
            "samplesPerModel": 1, "maxBudgetUsd": 1,
        }
        run_id = request(base, "/api/runs", config)["runId"]
        terminal = wait_run(base, run_id)
        expect(terminal["status"] == "completed", f"Mock benchmark failed: {terminal['status']}")
        mutation_checks(base, run_id, config)
        report["mutationRequests"] = "passed: three routes reject foreign/null/missing Origin and text/plain without side effects; same-origin run/annotation/vote succeed"
        for path in ("/runs/run_deadbeef/results", "/share/run_deadbeef"):
            rejected_request(base, path, None, 404)
        report["missingRunPages"] = "passed: results and share return HTTP 404"
        original_bundle = read_bundle(base, run_id)
        report["mockRun"] = {"id": run_id, "status": terminal["status"], "bundle": original_bundle}
        report["sampledContainerResources"] = output(
            "docker", "stats", "--no-stream", "--format", "{{json .}}", primary,
        )
        command("docker", "restart", primary)
        wait_health(base)
        expect(get_run(base, run_id)["status"] == "completed", "Completed run lost after restart")
        expect(read_bundle(base, run_id) == original_bundle, "Evidence changed after restart")
        report["restartPersistence"] = "passed"

        if check_interrupted:
            interrupted_id = request(base, "/api/runs", {**config, "samplesPerModel": 10})["runId"]
            expect(get_run(base, interrupted_id)["status"] not in ("completed", "partial", "failed", "cancelled"), "Interruption fixture completed before it could be interrupted")
            command("docker", "kill", "--signal", "KILL", primary)
            command("docker", "start", primary)
            wait_health(base)
            recovered = wait_run(base, interrupted_id)
            expect(recovered["status"] != "completed", "Interrupted run was incorrectly declared completed")
            report["interruptedRun"] = {"id": interrupted_id, "status": recovered["status"]}
        else:
            report["interruptedRun"] = "not exercised (explicit --skip-interrupted-check)"

        # Stop every writer before copying the complete volume, including SQLite
        # journal/WAL files, artifacts, raw output, snapshots, and bundle content.
        command("docker", "stop", "--time", "30", primary)
        command(
            "docker", "run", "--name", backup_container, "--network", "none",
            "--volume", f"{volume}:/data:ro", "--entrypoint", "tar", image,
            "-czf", "/tmp/model-lab-backup.tar.gz", "-C", "/data", ".",
        )
        backup = work / "data-backup.tar.gz"
        command("docker", "cp", f"{backup_container}:/tmp/model-lab-backup.tar.gz", backup)
        report["backupSha256"] = hashlib.sha256(backup.read_bytes()).hexdigest()
        command(
            "docker", "create", "--name", restore_container, "--network", "none",
            "--volume", f"{restored}:/data", "--entrypoint", "tar", image,
            "-xzf", "/tmp/model-lab-backup.tar.gz", "-C", "/data",
        )
        command("docker", "cp", backup, f"{restore_container}:/tmp/model-lab-backup.tar.gz")
        command("docker", "start", "--attach", restore_container)
        expect(output("docker", "inspect", "--format", "{{.State.ExitCode}}", restore_container) == "0", "Backup extraction failed")
        restored_base = start_container(image, recovery, restored, network, read_only=True)
        expect(get_run(restored_base, run_id)["status"] == "completed", "Restored run is missing")
        expect(read_bundle(restored_base, run_id) == original_bundle, "Restored evidence differs")
        for suffix in ("", f"/{run_id}/annotations", f"/{run_id}/votes"):
            rejected_request(restored_base, "/api/runs" + suffix, {}, 403)
        report["offlineBackupRestore"] = "passed"
        report["readOnlyWrites"] = "passed"
    finally:
        for container in containers:
            if container in (primary, recovery):
                result = command("docker", "logs", "--tail", "120", container, check=False)
                if result.returncode == 0:
                    (work / f"{container}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
            command("docker", "rm", "--force", container, check=False)
        for name in created_volumes:
            command("docker", "volume", "rm", name, check=False)
        if network_created:
            command("docker", "network", "rm", network, check=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="model-lab:release-check")
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts-data" / "release-check.json")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--skip-interrupted-check", action="store_true", help="Development only: leaves the interrupted-run release gate open")
    args = parser.parse_args()
    expect(re.fullmatch(r"[a-z0-9][a-z0-9._/:@-]*", args.image) is not None, "Invalid image reference")
    revision = output("git", "rev-parse", "HEAD")
    report = {
        "startedAt": datetime.now(timezone.utc).isoformat(), "revision": revision,
        "workingTreeDirty": bool(output("git", "status", "--porcelain")),
        "image": args.image, "platform": "linux/amd64", "status": "failed",
        "limitations": ["Synthetic provider output only", "Single-node SQLite", "Resource sample is not a capacity benchmark"],
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="model-lab-release-check-") as directory:
        work = Path(directory).resolve()
        try:
            output("docker", "info", "--format", "{{.ServerVersion}}")
            if not args.skip_build:
                build_image(args.image, work, report)
            else:
                report["sentinelLayerCheck"] = "not exercised (existing image)"
            inspect = json.loads(output("docker", "image", "inspect", args.image))[0]
            report["imageId"] = inspect["Id"]
            expect(inspect["Architecture"] == "amd64" and inspect["Os"] == "linux", "Only Linux amd64 is certified")
            expect(inspect["Config"]["User"] not in ("", "0", "root"), "Image runtime must be unprivileged")
            smoke_image(args.image, work, report, not args.skip_interrupted_check)
            report["status"] = "passed" if not args.skip_interrupted_check else "partial"
        except Exception as error:
            report["error"] = str(error)
            if isinstance(error, subprocess.CalledProcessError):
                report["errorOutput"] = (error.stdout or "") + (error.stderr or "")
            raise
        finally:
            report["finishedAt"] = datetime.now(timezone.utc).isoformat()
            args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            log_dir = args.report.parent / (args.report.stem + "-logs")
            for log in work.glob("*.log"):
                log_dir.mkdir(exist_ok=True)
                shutil.copyfile(log, log_dir / log.name)
            print(f"Release check report: {args.report.resolve()}", flush=True)


if __name__ == "__main__":
    main()
