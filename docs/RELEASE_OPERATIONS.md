# Release images, backup and restore

This is the operational procedure for the single-server, Linux amd64, SQLite
release profile. [The release plan](RELEASE_PLAN.md) records which gates have
actually passed. These procedures do not publish a release by themselves.

## Source release before container publication

**Public source prerelease (2026-09-20 UTC):** `v0.2.0-rc.1` is published.
Branch/tag protections, the required release reviewer, main-only environment
policy, disabled administrator bypass and private vulnerability reporting were
activated and read back before publication. The
[configuration and historical private-draft procedure](github-protection/README.md)
record the settings and the earlier private-plan limitation. The protected
workflow is now configured for future candidates; it has not been dispatched.

The source release can proceed independently once the reviewed source commit's
application and secret checks pass. Native image findings remain visible in PR
CI and continue to block the container publication workflow.

Before the first release, configure the `github-release` environment's reviewer
and main-branch restrictions. Review and merge the candidate, align all package
versions/CITATION, and create its reviewed version tag on main. Dispatch
**Prepare reviewed source release** (`source-release.yml`) from main with that
existing tag. The workflow requires main ancestry, checks out the exact commit,
reruns application/browser/build/dependency/secret checks, and uses `git archive`
to package only committed source. It attaches `SOURCE_REVISION` and `SHA256SUMS`
to a **draft** GitHub release. Notes link to the immutable source revision and
explicitly separate source support from container certification. The workflow
does not create a tag, publish the draft, upload an image or change visibility.

Review the actual draft's source archive, checksums, links, known limitations
and intended repository visibility before publication. GitHub's generated
source archives and the attached archive contain source, not installed browser
or Node binaries. The operator downloads dependencies during the documented
source setup. The workflow is statically validated and has not been dispatched.
The maintainer instead merged PR #3, created `v0.2.0-rc.1`, and prepared a private
draft using its packaging commands after exact-commit source CI passed. All three
uploaded assets were downloaded and checksum-verified; see the current release
plan for identifiers. Do not recreate or move the existing tag, and do not run
the create-draft workflow again for that same release, which is now publicly
published. Container publication still follows all gates below and the existing
`release.yml` workflow.

## Reproduce the container gate

Install Docker and Python 3.10 or newer, then run from a clean candidate checkout:

```bash
python3 scripts/check_image_layers.py
python3 scripts/release_secret_scan.py
python3 scripts/docker_release_check.py --image model-lab:release-check
python3 scripts/image_vulnerability_scan.py --image model-lab:release-check
```

The build check copies tracked and unignored candidate files into a temporary
context. It refuses private dotenv files and `artifacts-data`, then adds synthetic
root/nested credential files, SQLite sidecars and local artifact sentinels. It
builds one image and inspects every saved layer, including layers obscured by
later deletions. The scanner handles uncompressed and gzip layers; unsupported
compression fails the check instead of silently skipping content.

The container check uses fresh temporary volumes and a dedicated Docker bridge,
publishes its HTTP port only on host loopback, and forces mocked providers. It
checks unprivileged execution, Chromium startup, a two-model benchmark, mutation
request validation, annotations, final votes, missing pages, ZIP evidence,
restart persistence, interrupted-run recovery, and offline backup/restore. The
restored server runs read-only. Temporary containers, networks and synthetic data
volumes are removed; the local test image remains for inspection.

Evidence is written under ignored `artifacts-data`: `release-check.json`,
synthetic container logs, and `release-secrets.json`. Reports record the source
commit and whether the working tree was dirty. A passing local dirty-tree test is
development evidence; rerun on the exact release commit. The one resource sample
in the report is not a minimum-memory recommendation or load test.

The secret check uses the digest-pinned official Gitleaks image with networking
disabled. It scans an isolated source snapshot and a bare repository created from
all local Git refs. Ignored working secrets, private run data, local Git config and
hooks are never mounted. Only redacted rule/path/line/commit metadata is retained.
It does not cover remote refs that were not fetched, unreachable Git objects,
unrecognized secret formats, or external release attachments. Triage findings;
do not add a broad suppression just to obtain a passing result.

The retained upstream Chromium DEPS file contains a public source revision that
matches Gitleaks' generic-key rule. The scanner classifies that one exact finding
only after matching its rule, path, line and whole-file SHA-256 to the reviewed
public blob. History classification reads the scanned commit's blob, not today's
working file. Raw finding metadata and scanner exit codes remain in the report;
zero unresolved findings is the gate. Changed bytes, unrelated matches, absent
reports and scanner errors still fail. Linux scans run as the host UID/GID so
restricted scanner containers can write their isolated reports without restored
capabilities. The accompanying ten regression tests
exercise these distinctions.

The image vulnerability check downloads a public advisory database with no
application data mounted. It then scans the saved image with networking disabled,
telemetry disabled, no Docker socket, and an isolated output directory. It retains
the complete package/advisory report and fails the gate for high or critical
matches. Review reachability, available fixes and mitigation before promotion;
package matches are not proof of exploitation. Record the database timestamp and
rerun against the final image. Downloaded browser binaries may not be identified
by the package analyzers. The separate browser manifest pins its archive and
minimum version; that version still needs review against new upstream security
releases. See [Trivy image scanning](https://trivy.dev/docs/latest/target/container_image/).
The [native advisory review](CONTAINER_ADVISORY_REVIEW.md) records individual
source and reachability evidence. Unresolved matches continue to block image
promotion; a passing functional check does not waive the advisory gate.

For an already pulled image, use:

```bash
python3 scripts/docker_release_check.py --skip-build --image ghcr.io/OWNER/REPOSITORY@sha256:DIGEST
```

This repeats runtime checks but cannot reproduce the synthetic-context layer
test. The immutable digest must already have passing build/layer evidence.
`--skip-interrupted-check` exists only for development diagnosis and produces a
`partial` report; CI and release publication do not use it.

## Runtime identity and data

The image starts the Node server directly as `node` (UID/GID 1000) and expects
`/data` to be writable. A fresh Docker named volume inherits that directory's
ownership. For an existing bind mount, provision UID/GID 1000 access before
startup. Do not run the application as root to work around a volume error.

Use `--init` so child processes are reaped. The default volume contains
`model-lab.db`, SQLite sidecars when present, run-owner leases, artifacts, raw
outputs, snapshots, screenshots and exported bundles. If you override either
`MODEL_LAB_SQLITE_PATH` or `MODEL_LAB_DATA_DIR`, the backup must include both
locations and the database's adjacent owner directory. Keep one server writer
per data volume. CLI jobs must be stopped too before an offline backup.

The image includes the locked workspace dependencies and the Chrome for Testing
headless shell pinned by version and archive hash in `browser-runtime.json`.
Playwright controls that browser; its bundled browser is not installed. The
runtime refuses browsers below the recorded minimum security version.
It uses the digest-pinned Node 22 Debian 13 base with available Debian security
updates applied at build time. Package-manager installers are removed after the
browser installation. The unused Xvfb server, its automatically installed unused
dependencies and setuid/setgid file modes are removed through the package manager
and mode changes. Required GBM, Mesa and LLVM libraries remain. Next's unused image optimizer is disabled, and the image build verifies
that setting before removing Sharp and its native decoder packages. Evidence
images are served directly. Use the direct `model-lab` command inside the container,
for example `docker exec model-lab model-lab packs`; use `pnpm cli` in a source
checkout. The container check exercises this CLI without networking.
Until Debian 13 supplies a fixed parser, an isolated build stage compiles the
unmodified, SHA-256-pinned upstream Expat 2.8.4 release into a same-ABI `libexpat1`
Debian package. It runs the upstream test suite and a bounded regression fixture.
The package replaces the old parser in the same image layer, and retains its MIT
license, source URL/hash and build recipe under `/usr/share/doc/libexpat1`.
The image check verifies package metadata, library target/hash and the actual
browser loader path. This narrowly fixes Expat; it does not resolve other native
advisories or turn the image scan into a passing gate.
After building, the image reinstalls the frozen production dependency graph
offline from the build's package store, before copying any application files to
the runtime stage. This preserves workspace links while excluding linting,
formatting and CSS build tools from every runtime layer. `tsx` and TypeScript
are explicit runtime dependencies for the source CLI and Next's configuration
loader. CI audits the full build graph as well as scanning the final image.
Retain the notices of the packages actually installed in that image.
The application image is not a hardened
multi-tenant execution service or an OS-level isolation certification.

## Offline backup

Choose the immutable image digest used by the server and record it with the
backup. These Bash examples use the explicit names `model-lab` and
`model-lab-data`; substitute your actual names deliberately. The backup helper
uses the same unprivileged image and has no network access.

```bash
IMAGE='ghcr.io/OWNER/REPOSITORY@sha256:DIGEST'
docker stop --time 30 model-lab
docker create --name model-lab-backup --network none \
  --volume model-lab-data:/data:ro --entrypoint tar "$IMAGE" \
  -czf /tmp/model-lab-backup.tar.gz -C /data .
docker start --attach model-lab-backup
docker inspect --format '{{.State.ExitCode}}' model-lab-backup
docker cp model-lab-backup:/tmp/model-lab-backup.tar.gz ./model-lab-backup.tar.gz
sha256sum model-lab-backup.tar.gz
docker rm model-lab-backup
docker start model-lab
```

Require the helper's exit code to be `0` before accepting the backup. Preserve the
checksum, image digest, date and any non-secret runtime settings together. Keep
the backup private: raw model output, source and annotations may be sensitive.
Encrypt and store it according to the deployment owner's retention policy.
Copying only the `.db` file while writers are active is not this procedure.

## Restore and rollback rehearsal

Restore into a **new empty named volume**, leaving the original available for
recovery. Validate the checksum before copying the archive. Only restore trusted
backups produced by this installation; this is not an untrusted archive importer.

```bash
docker volume create model-lab-restored
docker create --name model-lab-restore --network none \
  --volume model-lab-restored:/data --entrypoint tar "$IMAGE" \
  -xzf /tmp/model-lab-backup.tar.gz -C /data
docker cp ./model-lab-backup.tar.gz model-lab-restore:/tmp/model-lab-backup.tar.gz
docker start --attach model-lab-restore
docker inspect --format '{{.State.ExitCode}}' model-lab-restore
docker rm model-lab-restore
docker run --detach --name model-lab-restored --init \
  --publish 127.0.0.1:3001:3000 --volume model-lab-restored:/data \
  --env MODEL_LAB_MOCK_PROVIDERS=1 --env MODEL_LAB_READ_ONLY=1 "$IMAGE"
```

Require extraction exit code `0`. Check `/api/health/store`, open a known run,
download its bundle, and compare artifact/screenshot hashes with the backup's
recorded evidence. Confirm all write endpoints return `403`. The automated
container gate rehearses these checks with synthetic data.

Before an upgrade, preserve the old image digest and a complete stopped-writer
backup. If rollback is needed, stop the new server and restore that backup into a
new volume, then start the previous digest against the restored volume. Never
point an older image at data changed by a newer schema unless that downgrade has
been explicitly tested. Keep the failed upgrade volume for diagnosis.

## Prepare and publish a reviewed candidate

The `Publish reviewed container release` workflow is manual and accepts an
existing semantic version or `-rc.N` tag. Run it from `main`. It verifies that the
tag's commit belongs to `main`, reruns the complete CI workflow on that exact
commit, and requires all five workspace versions to match the tag. No ordinary
push or pull request can trigger container publication.

Before first use, configure the `github-release` GitHub environment with required
reviewers and main-only access. Configure required CI checks and tag protections,
and verify repository/package visibility and private vulnerability reporting.
The YAML names an environment but cannot establish those account settings.

Prepare the release packet before creating the final version tag:

- Exact commit, version, changelog and aligned `CITATION.cff` metadata.
- Supported platform/storage matrix and current known limitations.
- Schema/path compatibility notes and a rehearsed backup/rollback procedure.
- Passing unit, integration, browser, clean-image and secret-scan evidence.
- Dependency advisory and license review, including all packaged dependencies.
- Verified quickstart, intended repository/package visibility and reporting contact.

Only the gated publishing job receives package, attestation and OIDC write
permissions. It builds and tests one image, checks its image ID has not changed,
then pushes the commit reference. It pulls that immutable published digest and
reruns the runtime checks before adding the requested version tag. It does not
create a mutable `latest` tag or automatically change GitHub visibility.

For public repositories, the workflow adds a provenance attestation. Attestation
availability for private repositories depends on the GitHub plan; private runs
skip that step and must not advertise an attestation that was not generated.
The workflow saves image digests, test evidence and SHA-256 checksums as an
Actions artifact. Attach the reviewed packet to the corresponding GitHub release
and verify installation from a fresh machine before announcing it.

Official references: [GitHub container publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images),
[GitHub artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds),
and [Gitleaks usage](https://github.com/gitleaks/gitleaks#usage).
