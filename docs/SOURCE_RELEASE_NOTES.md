This is a **source release** of Model Lab for local/private, single-host use.
Version **0.2.0-rc.2** includes the default loopback listener repair that is absent
from rc.1. It also blocks framing of the operator UI, removes fixture-vote
writes from comparison reads, and improves diagnostic credential redaction.
See the [audit verification](https://github.com/hugosmoreira/model-lab/blob/main/docs/SECURITY_AUDIT_VERIFICATION-2026-09-22.md)
for claim-by-claim results and the remaining workload, probe, judge-integrity and
operator credential questions. This is not a claim that every audit item is closed.

Install the pinned dependencies and browser using the repository's
[README](https://github.com/hugosmoreira/model-lab/blob/main/README.md), then start with forced mock providers. Paid provider
calls require the operator's own configuration. The included examples do not
establish new model rankings.

The candidate repairs generated-artifact isolation, request-origin checks,
provider limits and budget admission; preserves run evidence for replay; and
adds SQLite recovery, evaluation consistency and an export workflow. See the
[changelog](https://github.com/hugosmoreira/model-lab/blob/main/CHANGELOG.md) for the complete changes and migration notes.

The source archive contains the verified Git tree. It includes no installed
Node dependencies, browser executable, container image or operator data.
`SOURCE_REVISION` identifies its commit; `SHA256SUMS` verifies the archive and
revision file. Dependencies installed by the operator retain their own terms.

Application tests, browser regressions, typechecking, lint, formatting, build,
the JavaScript dependency audit and the redacted source/history secret scan
must pass for this exact commit before the workflow prepares the draft.

**Container publication is not certified by this source release.** The image
advisory gate and binary redistribution review remain separate requirements.
Supabase is experimental. The app has no built-in authentication; remote
private installations require an authenticating reverse proxy on every route. Generated
code is hostile input, and the documented browser controls do not constitute
an OS-level sandbox. Read [SECURITY.md](https://github.com/hugosmoreira/model-lab/blob/main/SECURITY.md) and
[deployment guidance](https://github.com/hugosmoreira/model-lab/blob/main/docs/DEPLOY.md) before operating it.

Security and conduct reports can be sent privately to info@webstudiolabs.com.
