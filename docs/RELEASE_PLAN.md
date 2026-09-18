# Model Lab release plan

Status: release hardening implemented on `codex/release-hardening`; the full
application gates, production user journey and Linux restart/restore rehearsal
pass. Native-library advisory and binary-distribution review remain open. The
independent patch review found three further defects, now repaired with regression
tests. Public visibility, tags, images and hosting have not changed.

Prepared 2026-09-17 from the [project audit](AUDIT-2026-09-17.md).
This is the execution plan for the [roadmap](ROADMAP.md). Update this document
as work is verified; keep the audit as a record of the original findings.

## Release target

Ship a polished GitHub project that someone can clone or run as a versioned
Docker image, complete a benchmark, inspect the evidence, and export trustworthy
results. Start with local/private use and SQLite. Offer a keyless, read-only
hosted demo after the release candidate passes.

Prepared version: `0.2.0-rc.1` in all five packages, runner metadata and CITATION.
No tag exists yet. Target `v0.2.0` only after the release-candidate checks.
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

Status: [private draft PR #3](https://github.com/hugosmoreira/model-lab/pull/3)
created from `codex/release-hardening`. Implementation commit
`62fbed43b5f4bed1108d58855a9002b9d0a07896` passed the complete application CI job.
The first Linux secret job exposed report-directory ownership after capabilities
were dropped; the host-UID/GID correction is reproduced, regression-tested and
passed GitHub's secret-scan job on `bde2f59`. Current exact-revision check results
are attached to the draft. The image advisory gate remains deliberately strict.
Container publication remains open and depends on R10. Source publication now
has a separate manual path: `source-release.yml` reuses the application and
secret gates for an existing reviewed tag on main, then prepares a draft source
archive with checksums and commit identity. It has no container publishing
permissions and does not change visibility or publish the draft. Ordinary PR CI
and the container release continue to run the full image gate. Earlier
preparation PRs were not merged or closed.

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
  notes. Static workflow validation passes; actual dispatch awaits a reviewed,
  merged and tagged candidate. This is a source publication route, not a native
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
| R11: GitHub release | Private draft PR #3; source draft workflow prepared; unpublished | Aligned candidate versions, exact-source verification and source archive/checksum workflow; container release still requires its full gates |
| R12: demo / new benchmark claims | Optional / open | Add selected target and relevant runtime/evidence checks |

Next: review the source candidate with exact-revision application and secret CI
on private draft PR #3, then configure release protection and prepare its draft
source packet from a reviewed main tag. Keep native advisory and binary
distribution work open before any image promotion. The source-only release
must not imply container certification.
Full workspace tests, typecheck, lint, formatting and the production build have
passed on the repaired application. The final offline
tree/history secret scan passes with zero unresolved findings; one exact public
Chromium revision pin is retained as a reviewed match with its full blob hash.
Public repository/package visibility, release publication and hosted deployment
remain final maintainer decisions after that packet is reviewable. No paid benchmark
has been run; existing n=1 evidence stays historical and new tests use synthetic outputs.
