# 0.2.0-rc.1 release candidate

Status: application and functional image checks pass; native dependency and
binary-distribution gates remain open; **not published**.
The candidate branch is `codex/release-hardening`, reviewed in
[private draft PR #3](https://github.com/hugosmoreira/model-lab/pull/3).
Implementation commit `62fbed43b5f4bed1108d58855a9002b9d0a07896` is pushed.
Package versions, runner metadata and citation metadata are aligned. Exact-revision
CI and immutable-image evidence must accompany publication; a draft PR does not
clear the remaining gates.

## Scope

This candidate turns the audited local-first benchmark app into a reviewable
single-host release. It repairs request and browser boundaries, spending
admission, immutable evidence storage, replay, evaluation consistency and
misleading fixture/score presentation. It adds repeatable image, restart,
backup/restore, dependency and secret checks, plus a manual publishing workflow.

| Profile | Candidate support |
| --- | --- |
| Linux amd64 container, SQLite, one server and local evidence | Primary release profile; final image gate pending |
| Node 22.13+ checkout, Windows development | Local tests and production browser walkthrough |
| Memory store | Ephemeral fixture workspace and tests; not durable across processes |
| Supabase | Experimental metadata backend; live migration/conformance validation pending |
| Public demo | Keyless, forced mock, read-only; selected reviewed data only |
| Public writable or multi-tenant service | Outside release scope; API has no authentication/rate limiting |
| Other container architectures | Uncertified until native Chromium regressions pass |

## Changes and migration

- New artifacts, raw output and screenshots use full-identity hashes and immutable
  writes. Legacy references remain readable; historical examples are unchanged.
- Creation configuration and source provenance are captured once. Replay v1
  exports include native objective tasks, actual/configured scorers, exact evidence
  references and hashes. Older runs state their missing provenance explicitly.
- HTTP bundle downloads use isolated temporary exports; CLI exports remain
  persistent. A runner bundle preserves runner results. Later human annotations
  and votes require a metadata-database backup for complete history.
- SQLite adds evaluation reference guards and atomic final votes while retaining
  legacy rows. Supabase deployments require `0002_evaluation_integrity.sql` after
  `0001_init.sql`; this path is experimental until isolated live tests pass.
- UI previews are captured images. Generated scripts execute only in the runner.
  Non-loopback writes require an explicit `MODEL_LAB_APP_ORIGIN` and authenticated
  access supplied by the deployment operator.
- Web and CLI load environment settings consistently. Forced mock mode suppresses
  provider calls and health probes. Without that flag, Ollama is a real local
  endpoint even when no cloud key is configured.

Back up SQLite, its sidecars/owner records, and all evidence while writers are
stopped before upgrading. Restore a separate copy and check it read-only first.
Roll back code and a compatible data snapshot together; see
[release operations](RELEASE_OPERATIONS.md).

## Security repair evidence

The [audit](AUDIT-2026-09-17.md) remains the record of the original implementation.
A fresh pre-patch investigator and a fresh independent post-patch reviewer were
used for the security fixes. The reviewer found three additional paths; all three
were reproduced or established in source and repaired with targeted regressions.

| Path / invariant | Implemented repair | Trigger and legitimate control |
| --- | --- | --- |
| Artifact policy cannot be selected by generated markup | Captured-only UI; response-header CSP with opaque origin in runner | Comment/attribute policy fixtures, page origin probes, normal canvas |
| New pages and native browser transports cannot reach trap services | Context HTTP/WebSocket controls, blocked workers/popups, native WebRTC UDP policy and deny-only TCP proxy | Positive control sends STUN/TURN traffic; hardened main/popup/frame and runner send none |
| Browser writes require the application's origin | Shared JSON/origin guard on runs, votes and annotations, with explicit proxy configuration | Foreign/null/missing origins and simple media types rejected without side effects; local/proxy JSON works |
| Images exclude local secrets and state in every layer | Recursive build exclusions plus synthetic context sentinels and layer inspection | Root/nested dotenv, database/sidecar and artifact markers absent |
| Untrusted diagnostics and provider streams terminate predictably | Count/byte caps, idle/total deadlines and cancellation | Floods, oversized/unterminated frames, stalled bodies and cancellation; normal responses preserved |
| Paid work must reserve admission before dispatch | Shared reservations across generation, judging and all retries; uncertain usage retained | First/concurrent/final/retry calls, increasing judge inputs and incomplete terminal streams |
| Evidence identity and analysis must not cross-contaminate | Full identity hashes, write-once files, private analyzer state and browser leases | Old prefix collisions, concurrent distinct frames, overlapping cleanup, legacy reads |
| Evaluations refer to real members and final votes are immutable | Shared membership validation and atomic backend writes | Memory/SQLite conformance, two-connection vote race and neutral unfinished labels |
| Repeated downloads must not accumulate durable copies | Temporary export lifecycle with exact-directory cleanup and no download log writes | Twenty ZIP iterations, export/consumer failures, sibling preservation and concurrent exports |

These controls do not certify an OS sandbox, cap renderer memory, authenticate
remote users or guarantee provider invoices. Chromium-dependent regressions must
be rerun after browser/platform changes. See [SECURITY.md](../SECURITY.md).

## Verification record

- Full workspace tests, typecheck, lint, formatting and production build passed
  after the independent review repairs and patched-browser integration. The browser
  boundary suite uses Chrome Headless Shell 153.0.8010.52, not Playwright's older
  default browser. Browser installation verifies the pinned archive SHA-256 and
  execution rejects an older version.
- [Application CI on implementation commit `62fbed4`](https://github.com/hugosmoreira/model-lab/actions/runs/35304843250)
  also passed all of those gates, dependency audit and the CLI run. Its separate
  secret job exposed a Linux report-directory ownership issue; the corrected
  scanners preserve dropped capabilities and run as the host UID/GID. GitHub's
  secret-scan job passed the correction on `bde2f59`. The current PR checks are
  the exact-revision acceptance record; the native image gate remains strict.
- The production UI walkthrough completed new run, live progress, results,
  captured artifacts, rating and CSV/JSON/PNG exports with synthetic outputs.
  Keyboard focus, error/404 recovery, 390/412 px phone layouts and 1024 px layouts
  were checked. PNG exports at 1280×720, 1000×1000 and 840×1050 were inspected.
- Linux image `sha256:d5e17b681522e2ce14ef322958e416458c132f24fef25800ffece3190e2af67b`
  passed unprivileged startup, an actual offline CLI mock run, HTTP benchmark,
  origin guards, ratings/final votes, missing pages, ZIP evidence, completed-run
  restart, crash-to-partial recovery, offline backup/restore and read-only writes.
  All-layer checks proved synthetic secret/state markers, unused Sharp native
  decoder packages and older Expat libraries absent. The browser loads the verified
  upstream Expat 2.8.4 library; all 72 exports are preserved, upstream tests pass,
  and the complete license/source/build provenance is retained. This is a
  dirty-tree development image, not a published
  digest or a substitute for exact-commit CI.
- The final JavaScript dependency audit after the Playwright update reported zero
  matches. Native image findings are tracked in the
  [container advisory review](CONTAINER_ADVISORY_REVIEW.md). On the same image,
  Trivy records 54 HIGH and one CRITICAL native-package occurrences (20 unique
  advisory IDs), and zero findings across 353 identified Node packages. Raw Expat
  matches remain visible despite source-verified remediation; unresolved native
  findings still block the strict image gate. The advisory DB is dated 2026-09-18.
- The final offline redacted secret scan reports zero unresolved candidate-tree
  and local-history findings. The reviewed match in each is the public Chromium `ukey2`
  revision pin. It is classified only when the rule, path, line and complete
  upstream blob SHA-256 match; original findings and scanner exit codes remain
  in the report. Ten focused tests cover tree/history evidence, changed content,
  scanner failures and Linux mount ownership. No private dotenv files, ignored run data, local Git
  configuration or hooks were mounted in the scanner. Exact-commit CI repeats it.
- The production-dependency follow-up image `c6c3b6e` passed the complete runtime
  and layer rehearsal, reducing the installed pnpm graph from 335 to 37 packages.
  Removed tools include ESLint, Prettier, Tailwind build dependencies and
  `stable-hash`. Trivy identifies 51 Node packages with zero findings; the native
  result remains 54 HIGH / 1 CRITICAL. An isolated Bookworm comparison was
  rejected after reporting more high/critical matches. See the advisory review
  for full immutable identities and the limits of this development evidence.
- The current license inventory covers production dependencies and retained OS/Node/browser
  notices. See the repository's third-party notices and the final image report for
  distribution work; npm metadata alone is not license clearance.

Machine-readable reports and synthetic logs are under ignored `artifacts-data`.
The workflow retains equivalent evidence for the exact CI commit. Dirty-tree
rehearsals are development evidence, not proof for a later immutable image.

## Publication steps

The current private-repository plan does not support the intended branch rules
or required environment reviewers. See the
[protection preflight](github-protection/README.md). The maintainer has authorized
the source-only merge/tag/private-draft preparation, with explicit check and
source verification. Protected publication and public visibility remain pending.

1. Review the source candidate in private PR #3. Obtain passing application and
   secret checks on its exact revision. Container findings remain independently
   visible and block the container release, not the source-only workflow.
2. Configure required checks, branch/tag protections and the `github-release`
   environment. Verify private vulnerability reporting availability. The maintainer
   supplied `info@webstudiolabs.com`; no test message was sent.
3. For a source release, merge the reviewed source candidate, tag the verified
   main revision and dispatch `source-release.yml` from main. It verifies that
   exact commit again and prepares a **draft** source archive with checksums,
   commit identity and explicit limitations. It does not publish the draft or
   change repository visibility. The workflow has been statically validated;
   dispatch and draft creation have not been exercised.
4. Review the actual draft source packet before publishing it or changing
   repository visibility. Source installation still downloads dependencies
   under their respective terms; no browser or prebuilt dependency is bundled.
5. Before a later container release, resolve binary vulnerability/license
   delivery gates and record the tested image ID. The existing `release.yml`
   still requires all image checks, tests before pushing, pulls the published
   digest before version promotion and retains checksums/provenance evidence.

No paid provider benchmark, public visibility change, release, image publication
or hosted deployment has been performed. A new n=3 model comparison requires
deliberately selected models and an approved spend; synthetic tests make no new
model-ranking claim. A hosted demo is an optional later deployment.
