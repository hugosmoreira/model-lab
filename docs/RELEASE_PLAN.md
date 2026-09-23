# Model Lab release plan

Status: the repository is public and
[v0.2.0-rc.2](https://github.com/hugosmoreira/model-lab/releases/tag/v0.2.0-rc.2)
is published as a source prerelease. Application, build and secret checks pass
on its unchanged tagged commit; downloaded assets match their checksums.
Main/tag rules, release review and private vulnerability reporting are active
and verified. Native-library advisory and binary-distribution review remain
open; no container or hosted service has been published.

The source prerelease includes the listener repair and
[verification of the recent eleven-finding audit](SECURITY_AUDIT_VERIFICATION-2026-09-22.md).
The protected workflow and downloaded-packet verification are complete. The
rc.1 tag and assets remain unchanged; use rc.2 for the current security repairs.

Prepared 2026-09-17 from the [project audit](AUDIT-2026-09-17.md).
This is the execution plan for the [roadmap](ROADMAP.md). Update this document
as work is verified; keep the audit as a record of the original findings.

## Release target

Ship a polished GitHub project that someone can clone or run as a versioned
Docker image, complete a benchmark, inspect the evidence, and export trustworthy
results. Start with local/private use and SQLite. Offer a keyless, read-only
hosted demo after the release candidate passes.

Prepared version: `0.2.0-rc.2` in all five packages, runner metadata and CITATION.
Annotated tag `v0.2.0-rc.2` points to
`e8b4bf510ddd328e74c3b24db63ef9d56f748b2b`. Target `v0.2.0` only after
the release-candidate checks and feedback.
Keep pre-1.0 expectations
explicit while storage and replay contracts change.

GitHub hosts source, issues, CI, releases and container images. The application
itself needs a long-lived Node process, Chromium and persistent disk.
GitHub Pages is static hosting, so it can host project documentation, not this
full application. [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

The first release supports one server with one persistent data volume.
Public writable benchmarking, accounts, billing, multi-tenancy, horizontal
scaling, Leaderboard, Judge Lab, more packs and an npm-distributed CLI stay
outside this release. Supabase remains experimental until its integration
and persistence behavior are exercised against an isolated test project.
Do not add an authentication system just to publish a self-hosted tool.

## Verified starting point

### Annotation and mutation-body bounds (2026-09-22)

- Reproduced the L4 resource gaps: direct memory/SQLite writes accepted oversized
  notes and more than 1,000 annotations; mutation routes buffered JSON before
  checking its schema. No separate unauthorized caller or access bypass was
  established under the trusted-operator policy.
- All three mutation routes share a 64 KiB streamed-byte ceiling and ten-second
  total read deadline after read-only/origin guards. Missing/dishonest lengths,
  compressed bodies, aborts and stalled reads have explicit rejection paths.
  Maximum ordinary, multibyte and escaped 4,000-unit notes remain accepted.
- Shared new-write annotation validation enforces 1–4,000 UTF-16 note units and
  32 KiB of total persisted text; normalized fields prevent unknown-property
  retention in memory. A run admits 1,000 annotations, with atomic SQLite guards
  and a PostgreSQL counter migration. Existing over-limit and orphan history is
  preserved. New parent rows also count legacy orphan history for reused IDs.
- Annotation forms keep unsaved text and display server limit errors. Actual
  route regressions preserve ordinary annotations, measured scores, guard order
  and final-vote immutability. Local store conformance passes (46 assertions for
  each of memory, fresh SQLite and reopened SQLite, plus vote-race/history tests).
  Six new store tests, twelve body/guard tests and eleven frontend/route tests
  pass, along with store/web typechecks, lint and format. Independent read-only
  candidate review found no concrete bypass/regression and passed six additional
  stream probes. PostgreSQL migration/concurrency and full clean CI remain the
  integration gates; Docker's Linux daemon is unavailable on this host.
- `0003_annotation_limits.sql` is required before upgraded Supabase writers.
  The isolated PostgreSQL test checks SQL behavior only; hosted Supabase remains
  experimental. This does not impose a whole-volume disk quota, delete history,
  change published rc.2 assets or clear container advisory/distribution gates.

### Judge verdict and evidence hardening (2026-09-22)

- Completed the bounded M1 follow-up in current source. Confirmed the old
  parser accepted surrounding prose and converted an invalid score of 99 into
  10. It also tolerated duplicate/extra fields and blank pair reasoning.
- New verdicts require a whole JSON object with exact unique fields, finite
  scores in 0–10 and nonempty explanations capped at 4,000 characters. A schema
  failure gets the existing one retry, then a skipped grade or pair. The shared
  boundary covers both rubric grading and both orders of each comparison.
- Serialize the challenge and generated sources as quoted JSON evidence,
  including exact truncation counts. Adversarial delimiter, role-spoof and
  forged-verdict fixtures remain intact as data. Screenshot text is explicitly
  untrusted too. No encoding or prompt instruction is claimed to prove live
  resistance to manipulation; M1's semantic claim remains unproven.
- Source-only vision fallback rebuilds its prompt, including on a schema retry.
  Skip pairs whose two accepted orders used different evidence modes. Preserve
  stable swaps, ties, reversal exclusion, failed-render caps and budget admission.
- Twelve synthetic judge tests pass, including the real runner, intercepted
  Anthropic SSE transport, final snapshots and bundle export. Only accepted
  grades persist; measured browser scores remain unchanged. The broader local
  judge/budget/unit/evidence suite passes 59 tests, frontend evidence passes nine,
  and runner/web typechecks plus workspace lint pass. No paid calls, actual
  provider credentials or operator evidence are used.
- Independent read-only candidate review found no concrete bypass or regression;
  its 1,641 additional parser probes cover escaped aliases, structure inside
  strings, byte limits and nested invalid values.
- [PR #20](https://github.com/hugosmoreira/model-lab/pull/20) carries this patch.
  [Clean CI 35820586670](https://github.com/hugosmoreira/model-lab/actions/runs/35820586670)
  passed all source checks and the redacted tree/history secret scan with zero
  unresolved findings. Implementation commit
  `7dea3550530e9d3fb1a9124aa1fe47c691912b39` and CI merge
  `2507272ab4311eca875f093740e85d36a5abfd1b` share tree
  `723bc82b51ff002dd158db1e269ea6d8c83fbd82`.
- The same run passed the complete clean-image functional rehearsal on
  `sha256:76fbd7c6fc3195ed7ece43136797dad93f86f04509b63814eea79a12c1300279`.
  Only the raw native advisory gate failed: 54 HIGH, one CRITICAL, 91 MEDIUM,
  108 LOW and 11 UNKNOWN occurrences; zero Node findings. Local receipts are
  retained under ignored `artifacts-data/judge-integrity/`. Final documentation
  changes require the source/secret gates again before protected merge; the
  recorded image rehearsal covers the implementation above. No image was
  published, and existing rc.2 tags/assets remain immutable.

### Shared workload and provider-health hardening (2026-09-22)

- Implemented the next H2/M2/L4 follow-up in source after rc.2. The original
  report's unauthorized-spend and provider-lockout claims remain unproven;
  these changes close the reproduced missing resource bounds.
- Shared API/CLI/raw-runner policy: 1–8 distinct endpoints, 1–10 samples,
  at most 80 generated samples including verified tasks, 1–4 workers,
  0–3 transport retries and a 200-character name limit. CLI parsing rejects
  numeric suffixes and non-finite budgets; explicit positive finite budget
  overrides remain supported.
- A dedicated SQLite permit file admits at most two executing runs per resolved
  artifact directory across processes and metadata backends. Acquisition and
  stale dead-owner reclamation are transactional. Permits precede service
  metadata writes and survive cancellation/worker failures until execution
  settles. Existing metadata recovery leases keep their separate lifetime.
- Web health requests share an in-flight batch, keep the 60-second ordinary
  cache and enforce a 10-second manual-refresh/failure cooldown. The UI shows
  when refresh becomes available. Mode changes cannot join or overwrite another
  mode's cache or reset the real-mode cooldown.
- Focused synthetic workload, budget, actual API/CLI and health regressions pass,
  including six competing child processes, concurrent stale-owner reclamation,
  80-sample verified runs and a $2,001 explicit budget with zero provider spend.
  Independent candidate review found a transient SQLite cleanup failure that
  could strand capacity. A locked-database regression reproduced it; retryable
  cleanup now preserves the run outcome and automatically frees the slot.
  Local runner/web typechecks, workspace lint and focused tests pass.
  No provider credentials, operator data or paid calls are used by these tests.
- [PR #19](https://github.com/hugosmoreira/model-lab/pull/19) records the patch.
  [Clean CI 35818475610](https://github.com/hugosmoreira/model-lab/actions/runs/35818475610)
  passed the full source typecheck/lint/format/test/audit/mock-CLI/build gate
  and tree/history secret scan with zero unresolved findings. Its synthetic
  merge `08d3e1deef619814a88d8404cfae2c1acef856df` and implementation commit
  `ec070b6ce7896e825ec6ffe3ef49d6aad843d76a` share Git tree
  `c3d9e9722d1e95152073d268ffa6f1b698ea26f7`.
- The same CI run passed the entire clean-image functional rehearsal on
  `sha256:d96ab21447425b6663619d6d01019840d09f0258aec2718f2fd80f3ed8e02fa1`:
  offline CLI, graphics, headers, mutation guards, restart, interrupted-run
  recovery, offline backup/restore and layer exclusions. Its only failed step
  is the unsuppressed native advisory gate: 54 HIGH, one CRITICAL, 91 MEDIUM,
  108 LOW and 11 UNKNOWN occurrences; zero Node findings. Receipts are retained
  under ignored `artifacts-data/workload-hardening/`. No image was published.
- This patch does not change rc.2's tag/assets. Admission covers one artifact
  directory on one host, not distinct roots sharing only a metadata database,
  old running binaries, distributed servers or account-wide daily spend.

### Source rc.2 publication completed (2026-09-22)

- [PR #17](https://github.com/hugosmoreira/model-lab/pull/17) merged the reviewed
  repairs. Its source tree, CI synthetic merge and tagged main commit all have
  tree `9afd4cff5e7c10372af9dc005454a628a450b272`.
- Annotated tag object `684f222bb1197b6d7a2657248406dae4851ad404` resolves to the
  commit above. No previous tag or asset was replaced.
- [Protected workflow 35739618140](https://github.com/hugosmoreira/model-lab/actions/runs/35739618140)
  passed exact-commit application/build and tree/history secret checks, used
  the configured maintainer review gate, and prepared a source-only draft.
  Its image job was intentionally skipped under the existing source-release
  policy; the separate full PR image rehearsal is recorded below.
- Downloaded and verified the draft, then published release `393811329` as a
  prerelease at `2026-09-22T14:24:59Z`. Anonymous public downloads passed the
  same verification: server digests, `SHA256SUMS`, `SOURCE_REVISION`, aligned
  versions and every file's Git blob. The private audit and dotenv files are absent.
- Source ZIP: 403 files, 3,112,018 bytes, SHA-256
  `60b1f239459178c3a979a3f41331c7af24f272b7850c387d88128c43d235675d`.
  Local receipts are under ignored `artifacts-data/rc2-release/`.
- Rechecked active main/tag rules, main-only release environment with reviewer
  and administrator bypass disabled, and private vulnerability reporting.
- [Full PR CI 35739113423](https://github.com/hugosmoreira/model-lab/actions/runs/35739113423)
  verified live page/API/download headers, graphics, mutation guards, restart,
  interrupted-run recovery, offline restore and image-layer exclusions on
  image `sha256:0142dc8a368c01537f982d017552b45c92125f8d10d4e38bd5b88442212f87c9`.
  Its only failed step is the unsuppressed native advisory scan: 54 HIGH and
  one CRITICAL occurrence; zero Node findings. No image was published.

### Security verification and rc.2 preparation (2026-09-22)

- Checked all eleven supplied audit claims against current source and resolved
  policy. Two current findings were confirmed (L1 framing and L2 vote reads),
  five retained evidence gaps, and four did not establish a remaining separate
  vulnerability on repaired main. The immutable rc.1 defaults still require
  the previously documented loopback workaround or an upgrade.
- Added global framing protection; removed fixture vote writes from the shared
  queue reader; improved shared diagnostic redaction before truncation, including
  JWT serialization variants found by independent candidate review. Corrected
  the Dockerfile's example to publish only on host loopback.
- Pre-fix header and vote regressions failed as expected. The repaired focused
  suites pass, including actual Next socket checks, memory/SQLite queue states,
  provider HTTP/SSE/health errors, and store-health credential handling. Whole
  repository lint and web/runner typechecks pass locally. Added live page/API/
  download header assertions to the clean-image CI rehearsal.
- Aligned all five packages, runner metadata and citation to `0.2.0-rc.2`.
  Exact candidate source CI, protected workflow, immutable tag and downloaded
  packet verification remain release steps. No new tag or public release is
  claimed by this preparation checkpoint.
- The original local audit is preserved untracked and is excluded from the
  public source packet. Only the sanitized verification report is committed.
  No operator credentials were read, rotated or transmitted; no paid benchmark
  or live Supabase validation was performed.

The following table preserves the original September 17 starting snapshot.

| Area | Observed state | Release implication |
| --- | --- | --- |
| Source | Audited commit `ac8479891660ec9bdc89690c7283d82dafb0fcc6` | Audit findings describe this baseline |
| Local verification | Typecheck, lint, formatting, tests and production build passed during the audit | Passing baseline tests does not close the uncovered defects |
| Remote CI | Latest run passed on the audited commit | Add targeted regressions before relying on the existing gate |
| GitHub repository | `hugosmoreira/model-lab` is private; default branch `main` | Public visibility is a final publication operation |
| GitHub releases | Latest release query returned none; no local tags | Prepare the first release candidate |
| Community | Issues enabled; Discussions disabled | Keep Issues; enable Discussions only if the maintainer will use it |
| Branch protection | `main` reports `protected: false` | Configure required checks at publication |
| Rulesets | API returned 403: upgrade the plan or make the repository public | Do not treat rulesets as configured; recheck when public |
| Private vulnerability reporting | API returned 404 for the private repository | Unverified, not proof of a working reporting channel |

Remote state was read through GitHub CLI during planning.
[Latest verified CI run](https://github.com/hugosmoreira/model-lab/actions/runs/35057086980).
No repository visibility or settings were changed.

## How to follow this plan

Work in the order below using small branches/PRs with the `codex/` prefix.
Each item lists its behavior and acceptance evidence. Mark it complete only
after the change and its regression checks pass. Record the PR or commit,
checks run, remaining limitations and any compatibility decision.

Run focused tests during development; run the complete existing CI suite on
each candidate merge. Keep fixtures synthetic and provider calls mocked in CI.
An approved real-provider run is a separate release-evidence step.

The release lead is the repository maintainer. Implementation can proceed
without deciding on a hosting vendor. Provider spend, public visibility,
published assets and any hosted deployment must have their concrete release
contents and target reviewed before execution.

## Milestone 1 — execution and request safety

### R1. Protect writes and exclude secrets from images

Status: implemented and regression-tested. Addresses audit S2 and S3. Six guard
tests cover local/proxy JSON, Next.js loopback normalization, hostile Host values,
foreign/opaque/missing origins, simple media types and invalid configuration.
The Docker rehearsal verified all three real HTTP routes without rejected-write
side effects, and synthetic credential/state sentinels were absent from every
image layer. The final candidate image is tracked under R10.

- Add one shared guard before side effects on runs, votes and annotations.
  Validate browser origin and JSON media type; reject foreign and opaque
  origins. Define the intended non-browser path explicitly. The CLI currently
  calls the run service directly and must keep working.
- Preserve read-only mode. Configure trusted proxy/origin handling explicitly;
  do not trust arbitrary forwarded headers.
- Exclude nested dotenv files and local state from Docker contexts, with a
  deliberate exception only for public example configuration.

Acceptance: same-origin JSON works; foreign/null-origin and text/plain writes
cause no run, vote or annotation; all writes remain 403 in read-only mode.
A build from synthetic root and nested credential files contains no sentinel
in any image layer. Test this before publishing an image.

### R2. Enforce generated-artifact boundaries

Status: implemented and regression-tested. Addresses S1 and S4. UI previews are
captured PNGs. Runner policy is an HTTP response header with an opaque sandbox;
HTTP/WebSocket context controls are installed before page creation. Independent
review reproduced a WebRTC bypass; native UDP restrictions and a deny-only TCP
proxy now block both STUN and TURN traps. Ten boundary and sixteen browser-check
regressions pass, including positive controls, a minimum-version gate and working
canvas rendering. Playwright is pinned at 1.63.0, with separately SHA-pinned patched
Chrome Headless Shell 153.0.8010.52; installing the default older Playwright browser
is insufficient. Enforcement depends on Chromium; this is not an OS sandbox guarantee.

- Replace regex-selected policy placement with a trusted document boundary.
  Preserve opaque-origin iframe isolation; review viewer, comparison and
  runner paths together.
- Apply request controls to the entire browser context, including new pages;
  cover popup first requests, navigation, WebSockets and service workers.
  Deny access to host-local services from generated content.
- Default the public demo to captured images. Enable live generated scripts
  only where the enforced policy and residual limitations are documented.
  If a browser-only policy cannot enforce an advertised restriction, keep that
  preview unavailable until a suitable isolation boundary is in place.
- Record the isolation design and the guarantees it actually provides.
  Browser-context restrictions are not an OS-level sandbox certification.

Acceptance: controlled local trap endpoints receive no forbidden traffic from
comment/attribute policy bypasses, popup, navigation and socket fixtures.
Fixtures cannot read parent origin state. No real external attack targets are
used. A normal working artifact still passes its intended capability checks.

### R3. Bound untrusted streams and diagnostics

Status: implemented and regression-tested. Addresses S5 and S6. Stream receipt,
consumer output, HTTP error bodies, idle/total duration and diagnostics are
bounded. Provider and browser tests cover oversized/stalled inputs and cancellation.
Diagnostic retention does not imply bounded transient IPC or renderer memory.

- Bound diagnostic count and bytes, retaining counters plus a truncated last
  error instead of every full string.
- Bound SSE frames, cumulative output and HTTP error bodies during receipt.
  Enforce idle and total deadlines for generation and judging; cancel readers
  on overflow and reject oversized output before raw writes.
- Make cancellation and browser cleanup reliable, with failure evidence
  persisted even when execution is terminated.

Acceptance: oversized, unterminated and stalled streams stop within specified
limits; rapid error output stays bounded; cancellation releases resources.
Failures remain visible and do not prevent later independent runs.

Milestone gate: R1–R3 regressions pass and the security claims in the UI and
documentation match the tested boundaries.

## Milestone 2 — spending and evidence integrity

### R4. Admit paid work before spending

Status: implemented and regression-tested. Addresses S7. Shared synchronous
reservations cover generation, judging, transport/adaptation retries and fallbacks.
The independent review reproduced premature-EOF usage settlement; adapters and
consumers now require complete terminal accounting or retain uncertainty. Eighteen
budget and eleven provider tests pass. Admission estimates are not invoice promises.

Reserve a conservative per-call cost before generation and judge requests,
including current prompt size, configured output cap, concurrent calls and
every retry. Settle reservations after usage arrives. Handle unknown pricing
explicitly, and distinguish estimated spend from provider billing.

Acceptance: first-call, last-call, concurrent and retry cases cannot admit
work beyond the configured bound. Judge tests include increasing prompt sizes.
Replace the present test that passes after overspending with assertions on
admission and total accounted cost. Do not promise an exact invoice ceiling
where upstream usage or pricing cannot provide one.

### R5. Preserve each run's evidence

Status: implemented and regression-tested. Addresses correctness findings 1 and 2.
Full-identity hashes and write-once evidence avoid prefix collisions; analyzers
and browser leases isolate concurrent checks. Replay tests exercise legacy reads,
immutable creation data and exact references. Existing historical evidence is unchanged.

Use full identities or collision-resistant identifiers, immutable artifact
writes and exact file references during export. Give each analysis operation
private frame state or serialize its complete lifecycle; isolate overlapping
run cleanup. Support existing stored paths through an explicit compatibility
reader, without silently renaming or overwriting historical evidence.

Acceptance: colliding old prefixes cannot collide in new storage; concurrent
distinct frames produce independent measurements; one run finishing cannot
close another run's browser; a bundle contains only its own files.
A copied legacy data directory remains readable after the change.

### R6. Make human evaluations consistent and atomic

Status: implemented for memory and SQLite, with conformance and concurrency tests.
Addresses correctness findings 5 and 7. All backends validate annotation membership;
SQLite final writes remain atomic across two worker connections. Unfinished pairs
use neutral visible and accessible labels. Supabase migration and implementation
changes are present but live validation remains outside the supported release scope.

Validate run, endpoint and sample membership across store implementations.
Make final-vote writes atomic, preserve correction history, and keep unfinished
pair identities neutral in history as well as the voting panel.

Acceptance: invalid references fail consistently; simultaneous final votes
cannot overwrite one another; labels and accessible text do not reveal a pair
before completion. Run conformance on memory and SQLite, with Supabase claims
limited to what has been tested.

Milestone gate: R4–R6 pass with concurrency and compatibility evidence.
Do not generate a new published comparison before this gate.

## Milestone 3 — trustworthy product and replay

### R7. Show real, demo, missing and failed states accurately

Status: implemented and verified in the production browser walkthrough. Addresses
correctness findings 3 and 6. Frontend regression tests pass; real production
requests for unknown results/share URLs return 404. Persistent dashboards use
recorded data, and score sources/sample counts remain per row across exports.

Make fixture mode explicit. Unknown runs return 404; store failures show an
error, never a substituted benchmark. Keep human, browser, judge and objective
sources distinct per point/row across charts, CSV, cards, alt text and social
drafts. Missing values remain absent rather than becoming zero.

Acceptance: nonexistent result/share URLs are 404; a failed store is visibly
different from a missing run; one human rating cannot relabel unrated browser
scores; every published value has its source and sample count.

### R8. Export a versioned replay contract

Status: implemented and regression-tested. Addresses correctness finding 4.
Twelve replay/evidence tests cover creation-time configuration, native tasks,
fingerprints, raw evidence, legacy provenance and exact paths. Independent review
found repeated downloads retaining duplicate exports; route-scoped temporary
exports now clean up on success/failure without growing run logs. Twenty repeated
ZIP operations and concurrent/failing consumers are covered. Persistent CLI exports
remain deliberate. Later human history requires the metadata database backup.

Export secret-free configuration, native objective tasks, actual mode/scorers,
raw output, exact artifacts, hashes and available source revision. Preserve the
run's creation-time configuration rather than reconstructing it from later
defaults. Clearly mark imported legacy bundles with missing provenance.

Acceptance: build-arena and objective bundles reconstruct their recorded
configuration/fingerprint, with relative paths and no secrets. Existing
example evidence remains unchanged. Replaying a configuration does not imply
that nondeterministic models will generate identical output.

### R9. Finish visible workflows and correct promises

Status: verified. Production walkthrough completed New Run, live/results,
captured-only artifacts, ratings, CSV/JSON/PNG export, storage-error recovery and
unknown-run 404s. Keyboard focus, 390/412/1024px layouts and all three export sizes
were checked with synthetic data; temporary servers are stopped. Setup/environment,
Ollama-only execution and forced-mock health behavior have focused tests. Security,
architecture, deployment and startup promises have been corrected. The maintainer
provided `info@webstudiolabs.com` for private conduct reports; it is recorded in
the community files. No test message was sent.

- Walk through setup, New Run, live progress, cancellation/failure, inspection,
  ratings, results and export using a fresh local install.
- Remove or disable nonfunctional controls; label unfinished pages; provide
  useful loading, empty and error states, keyboard focus and accessible labels.
  Check desktop and narrow-screen layouts.
- Align web and CLI environment loading, Ollama-only behavior and forced mock
  mode. Forced mocks must also prevent provider health probes from reaching
  external services.
- Correct README, SECURITY, environment and deployment docs for tested
  isolation, spending, replay and demo behavior. Explain both SQLite and
  artifact paths; remove unsupported Supabase bucket instructions.
- Preserve historical screenshots/results with their original methodology
  label. Update release screenshots only from verified current behavior.
- Replace the unusable GitHub direct-message reporting suggestion with a
  maintainer-verified private contact; do not invent an address.

Acceptance: a new contributor can follow the documented path without private
knowledge; the walkthrough completes with no dead advertised actions;
keyboard/accessibility checks pass; forced-mock network traps remain silent;
all product and documentation claims have corresponding behavior or an
explicit limitation.

Milestone gate: R7–R9 pass and the complete mocked user journey is reproducible.

## Milestone 4 — release candidate and operations

### R10. Produce a tested distributable

Status: functional distributable verified; binary publication blocked on native
advisories and distribution review. The Linux image includes all independent review
fixes and passes an actual offline CLI run, HTTP mock benchmark, origin guards,
completed-run restart, forced-crash recovery, offline backup/restore and read-only
mutation checks. Every image layer excludes twelve synthetic secret/state sentinels
and the unused Sharp native decoder bundle. The full JavaScript dependency audit
after the Playwright upgrade reports zero findings.

The broader image scan found 101 high and 9 critical package-advisory occurrences
in the original image. Debian 13 updates, runtime installer removal, patched Chrome
and removal of unused native decoders/Xvfb reduce that surface. These package
matches require individual review; they are not independent validated attack paths.
[Native advisory review](CONTAINER_ADVISORY_REVIEW.md) records the distinctions.
A generated JPEG's metadata can reach Expat. The image now builds the unmodified,
SHA-verified upstream 2.8.4 release as a same-ABI Debian package; upstream tests,
normal/adversarial XML controls, all 72 ABI exports, actual browser loading and
retained source/license/build provenance were verified independently. All-layer
checks exclude older Expat binaries and the removed Sharp bundle.

The current development image is
`sha256:c6c3b6ef2ef58879b92447e5db0bdf90d32a26dd8d456eb23d8b5b0abf8d21e2`.
Its full runtime gate passes. The 2026-09-18 advisory database reports 54 HIGH and
one CRITICAL native-package occurrences (20 unique advisory IDs), with zero matches
across 51 identified Node packages. Its installed pnpm graph is now 37 packages,
down from 335, after removing development tools before runtime packaging.
The Debian feed still matches the local Expat
build despite its independently verified fixes; those records remain visible.
Unresolved libxml2/native findings and binary distribution questions keep the strict
publication gate blocked. No blanket suppression or vulnerability waiver was added.

Retained notices and source provenance are recorded in
[third-party notices](../THIRD_PARTY_NOTICES.md). Binary distribution questions,
including the exact Chrome Headless Shell grant and the installed `client-only`
notice gap, remain explicit. The other gap (`stable-hash`) is now outside the
image and remains documented for the development checkout.
The historical libvips source packet is not a runtime release gate
once absence of that bundle from every layer is verified.

- Build in clean Linux CI from the exact candidate commit with the lockfile.
  Initially certify Linux amd64 images; claim other architectures only after
  native browser checks pass there.
- Run with an unprivileged runtime user and a writable data volume. Test
  Chromium compatibility and measure resource requirements before publishing
  sizing guidance.
- Exercise startup, health, a mock benchmark, export, container restart and
  persistence. Test an interrupted run so it cannot remain misleadingly
  running forever.
- Document and rehearse backup/restore of both SQLite and artifacts. Record
  an image digest and a rollback procedure; do not downgrade incompatible
  data blindly.
- Add default read-only Actions permissions, immutable action pins, focused
  regression jobs and a Docker smoke job. Keep publishing credentials out of
  pull-request workflows.
- Review dependency advisories, license obligations and redacted secret-scan
  results over the candidate tree and history before making history public.
  Review packaged files and layers as well as the source tree.

Acceptance: a fresh user can pull the candidate image, start it using the
documented command, complete the mock journey and retain results after restart.
Backup/restore succeeds. No unresolved exploitable high/critical dependency
finding is shipped; other exceptions require a documented reachability and
mitigation decision. New security findings are triaged before promotion.

### R11. Prepare the GitHub publication

Status: [PR #3](https://github.com/hugosmoreira/model-lab/pull/3) merged on
2026-09-18. The annotated source tag points to the verified merge commit; its
[published source prerelease](https://github.com/hugosmoreira/model-lab/releases/tag/v0.2.0-rc.1)
contains the source ZIP, `SOURCE_REVISION` and `SHA256SUMS`. The complete
application/build and redacted secret jobs pass in
[tagged-commit CI](https://github.com/hugosmoreira/model-lab/actions/runs/35353105305).
Downloaded draft assets match both the local checksums and GitHub's recorded
digests. The image advisory gate remains deliberately strict.
Container publication remains open and depends on R10. Source publication now
has a separate manual path: `source-release.yml` reuses the application and
secret gates for an existing reviewed tag on main, then prepares a draft source
archive with checksums and commit identity. It has no container publishing
permissions and does not change visibility or publish the draft. Ordinary PR CI
and the container release continue to run the full image gate. The original draft
was prepared manually because GitHub rejected the required private-environment
protections. The protected workflow was not dispatched. No separate action was
taken on the earlier preparation PRs. On 2026-09-20 UTC, after maintainer
authorization, the repository became public, the prepared protections were
activated and read back, and the reviewed draft was published. The tag and
source archive were unchanged.

Create a release packet containing the exact commit, proposed tag, changelog,
migration notes, supported platform/storage matrix, known limitations, image
digest, test evidence and verified quickstart. Align package versions and
CITATION metadata with the actual release.

Publish container images through a dedicated release workflow to GHCR, with
commit/version references, checksums for downloadable assets, and provenance
attestations where supported. Verify the published digest by pulling and
testing it before promotion. [GitHub container publishing guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)

When the candidate is ready to become public, configure required status checks,
restrict destructive branch/tag updates, and choose review requirements that
the maintainer can actually satisfy. Recheck plan-dependent availability at
that point. [GitHub ruleset documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

Enable private vulnerability reporting once available and verify its entry
point without sending a fake report. Confirm the separate Code of Conduct
contact works. [GitHub reporting configuration](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)

Acceptance: required CI has passed on the release commit; the release packet
is complete; repository visibility/settings and package visibility are checked;
release links and installation commands work from a fresh environment.

### R12. Add a public demo and current benchmark evidence

Status: open. Optional hosted demo; required evidence before new model claims.

Choose a container host only after the repository/image candidate is ready.
Use HTTPS, persistent storage, read-only mode, forced mocks and no provider or
service-role keys. Serve deliberately published data; do not copy a private
operator's entire data directory. Record health monitoring, storage limits,
backup, restart and rollback procedures.

A writable private installation needs authentication in front of the entire
app, including APIs and live events. A public service where users start runs
needs a separate design for identity, quotas, job isolation and costs.

Generate an n=3 example only after evidence fixes, with deliberately selected
models and a user-approved spend. Store its bundle and describe uncertainty;
keep the old n=1 example historically intact. If a paid run is deferred, publish
the software with accurately labeled existing/synthetic examples and make no
new model-comparison claim.

Acceptance for a demo: GET pages work; every mutation is denied; previews obey
the published policy; no provider request or spend occurs; restart/restore
works; no private results are exposed.

## Release decision and progress record

### Listener repair and container follow-up (2026-09-21, America/Los_Angeles)

- A newly supplied local audit identified default source listeners on all
  interfaces. Reproduced this with the real installed Next CLI and an isolated
  socket probe: both original commands bound `::`. Source `dev` and `start`
  now bind `127.0.0.1`; explicit hostname overrides and Docker's separate
  listener remain supported. The CSRF guard remains unchanged and is not
  authentication. Restart already-running source servers to apply the binding.
- Added OS-socket regressions for both commands and their operator overrides.
  Independent candidate review found the fixture could discover an ancestor
  Next config; an empty fixture config and a hostile-parent regression repair
  that isolation flaw. No operator dotenv or paid provider was used by the
  validation. The supplied untracked audit is preserved and not published.
- Refreshed the existing image's advisory database and offline scan: the strict
  gate still reports 54 HIGH / one CRITICAL native matches, with zero Node
  findings. These are package matches, not 55 validated exploit paths.
- Added a real shader/pixel/screenshot/fresh-artifact control to the image gate.
  It passes on the current image and protects graphics behavior during the
  next native-dependency prototype.
- Confirmed that replacing libxml2 with 2.15.4 directly breaks the installed
  ABI and that simple backports upgrades retain the dependency. The
  [native review](CONTAINER_ADVISORY_REVIEW.md) now specifies an LLVM19 rebuild
  without its optional XML manifest feature as the next bounded experiment,
  with ABI, consumer, rendering and complete image verification required.
- Browser redistribution/source delivery and `client-only` notice provenance
  remain open. No binary was published and the existing source tag was not moved.
  The source listener repair is a post-`rc.1` change until a new candidate is cut;
  users of `rc.1` can explicitly pass `--hostname 127.0.0.1` to both web commands.
- Remaining local audit claims about workload caps, credential-file access and
  judge robustness need their own validation. This change closes the listener
  exposure only; it does not classify every audit claim as fixed or exploitable.

### Public source prerelease completed (2026-09-20 UTC)

- Published release ID `391519300`, `v0.2.0-rc.1`, at
  `2026-09-20T03:29:52Z` (September 19 in America/Los_Angeles), after the
  maintainer authorized the next publication step. The repository is public;
  this is a prerelease, not the latest stable release.
- Rechecked passing source jobs on the tagged commit and current main before
  publication. The tag still resolves to `d60431a1f2fa8efb68be97f911e50758f092f510`;
  all three asset digests match the previously downloaded and verified packet.
  An unauthenticated download of every published asset also passed its recorded
  size and SHA-256 checks; the public reporting entry is visible.
- Activated and read back main ruleset `23717530`: PRs, up-to-date application
  and secret checks, resolved review threads, no deletion or force pushes,
  and no bypass actors. Zero external approvals remains the documented
  single-maintainer policy.
- Activated and read back version-tag ruleset `23717531`: no update/deletion
  of `v*` tags and no bypass actors.
- Configured release environment `22316904136` with required maintainer
  reviewer, self-review allowed, administrator bypass disabled, and only the
  `main` branch deployment policy (`60461512`). No environment approval or
  workflow dispatch is claimed for the original manually prepared packet.
- Enabled and verified GitHub private vulnerability reporting. The maintainer's
  private contact remains `info@webstudiolabs.com`; no test message was sent.
- Enabled GitHub secret scanning and push protection and verified both settings.
  These supplement the existing redacted source/history CI scan; enabling them
  is not a claim that their initial repository scan has completed.
- The first ruleset write met GitHub's temporary visibility-change lock; a
  subsequent read and retry succeeded. All protections were verified before
  publishing the draft. Image publication remains blocked by R10.

### Private source draft completed (2026-09-18)

This historical checkpoint precedes the public publication recorded above.

- Merged only the approved PR #3 head after its application/build and secret
  jobs passed. Verified the merged Git tree equals the checked PR tree.
- Created annotated tag `v0.2.0-rc.1` without replacing an existing tag. It
  resolves to `d60431a1f2fa8efb68be97f911e50758f092f510` on main. The same two
  source jobs passed again for that exact main commit in run `35353105305`.
- Prepared private draft release ID `391519300`, marked prerelease and not
  published. Ran the source workflow's version, clean-tree, archive, checksum
  and immutable-link steps through the documented maintainer procedure.
- The 399-file source ZIP is 3,092,212 bytes, SHA-256
  `754c007a3ed659172f862ffb4f0f375886fa522225b0a3b7688991a7007fc84b`.
  Downloaded all three assets from GitHub, verified their checksums/server
  digests, and checked that the ZIP records the exact commit. No installed
  dependencies or private runtime data are included.
- The repository remains private. Protection configurations are prepared but
  unavailable on the current private-repository plan; they have not been
  claimed as active. Public visibility and publishing the draft require the
  maintainer's final review. On this plan, visibility must change before those
  protections can be activated; apply and verify them before publishing the draft.
- Tagged-commit CI also completed the full image/layer/CLI/recovery/restore
  rehearsal on clean image
  `sha256:d0bfc3dce9924a185c7b393947466e6398746d77e66c108bf5bac5320438faa5`.
  Its 37 installed pnpm packages and 13 saved layers pass the packaging checks.
  The only failed CI step is the native advisory scan: 54 HIGH / 1 CRITICAL
  matches, with zero Node findings. These remain unsuppressed and block images.

### Source release authorization and protection preflight (2026-09-18)

The maintainer approved proceeding with the source-only path: merge the
verified candidate, create `v0.2.0-rc.1` on main and prepare a private draft for
review. Repository visibility and public release publication remain unchanged
until the actual draft is reviewed. The application/build and secret gates pass
for PR #3; the image's functional checks pass and native advisory gate remains
blocked. Verify any new PR head before merging.

GitHub rejected private-repository branch/ruleset configuration (HTTP 403) and
required release reviewers (HTTP 422) on the current plan. Its partially created
empty environment was removed. Prepared, reviewable
[protection configurations](github-protection/README.md) record the exact
intended rules and their activation requirements. They are not active safeguards.
Use the documented maintainer-driven private draft preparation when the protected
workflow is unavailable; record its exact tag, source tree, checksums and passing
verification. Protection activation remains a public-publication gate.

### Packaging and source-release follow-up (2026-09-18)

- Verified a frozen offline production reinstall after the build, keeping
  `tsx` for the CLI and TypeScript for Next's startup configuration loader.
  Installed pnpm packages fell from 335 to 37; the full runtime/CLI/recovery
  rehearsal and all 14 image layers passed. The raw native gate remains blocked.
- Rejected the isolated Node 22 Bookworm alternative. Its smaller GBM graph
  removed LLVM/libxml2 but reported 66 HIGH / 6 CRITICAL matches versus the
  retained Debian 13 profile's 54 HIGH / 1 CRITICAL. Both raw reports are kept;
  the comparison is documented in the native advisory review.
- Prepared a source-only draft-release workflow and explicit source release
  notes. Static workflow validation passes; the protected workflow has not been
  dispatched because its environment prerequisite is unavailable. The private
  draft was prepared through the recorded maintainer procedure. This is a source publication route, not a native
  advisory waiver. Removing `stable-hash` closes its image notice requirement;
  it does not resolve that notice in a full development checkout.

A polished first release means milestones 1–4 are satisfied for the advertised
scope, not that every future feature exists. Keep the hosted demo optional.
Do not mark a security finding closed solely because documentation now mentions
it; demonstrate its remediation or a verified mitigation that removes the path.

| Work | Status | Completion evidence |
| --- | --- | --- |
| Audit and release plan | Complete | Audit, verified repository snapshot and this plan |
| R1–R3: application safety | Verified; native image review tracked under R10 | Guard, browser-boundary, stream and diagnostic regressions; every-layer secret/state exclusions |
| R4–R6: spending and evidence | Verified for supported local stores | Budget/provider regressions, evidence compatibility, memory/SQLite conformance and concurrent final votes |
| R7–R9: product and replay | Verified | Full production flow, keyboard navigation, 390/412/1024 px layouts, three PNG export sizes, real error/404 states, replay and frontend tests |
| R10: distributable | Functional checks pass; native advisory/distribution gates blocked | Production dependency image `c6c3b6e`; 37 installed pnpm packages, all-layer exclusions and full CLI/HTTP/restart/crash/restore checks; raw scan retains 54 HIGH / 1 CRITICAL native matches |
| R11: GitHub release | Public source rc.2 complete; container publication remains under R10 | Protected workflow 35739618140, exact tagged-commit source checks, verified anonymous downloads, active/read-back protections and private reporting |
| R12: demo / new benchmark claims | Optional / open | Add selected target and relevant runtime/evidence checks |

Next: prototype the scoped LLVM rebuild, retain the live judge-integrity
evaluation gap (M1), and resolve operator credential ownership (H3). Track
aggregate disk retention separately from the implemented per-request/per-run
bounds (L4). Resolve the remaining R10 native advisory
and binary redistribution blockers before any image promotion. Rerun the
complete image gate on the final candidate and preserve its immutable digest.
The source-only release does not imply container certification.
Full workspace tests, typecheck, lint, formatting and the production build have
passed on the repaired application. The final offline
tree/history secret scan passes with zero unresolved findings; one exact public
Chromium revision pin is retained as a reviewed match with its full blob hash.
Public source visibility and prerelease publication are complete. Container/package
publication and hosted deployment remain separate maintainer decisions after their
gates pass. No paid benchmark has been run; existing n=1 evidence stays historical
and new tests use synthetic outputs.

For R10, build the scoped LLVM 19 variant without libxml2 support in an isolated
candidate, preserve its required ABI/backends, inspect all consumers and exercise
actual WebGL plus the full image gate. Retain fresh unsuppressed advisory reports
and complete binary/source/license obligations before promoting an image.
For L4, the new bounds above cover mutation bodies and annotation appends;
aggregate disk use and retention remain separate operator policy, with no
automatic evidence deletion. Hosted Supabase verification is still open.

For M1, adversarial fixtures, strict parsing and synthetic pipeline persistence
are implemented above. A live evaluation still needs matched benign controls,
pinned model/prompt versions, repeated trials, both pair orders and an explicit
spend ceiling. Keep measured browser/objective results distinct from subjective
judge output. A prompt-format change or fake provider response alone cannot prove
that a live judge resists injection.
