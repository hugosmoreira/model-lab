# Verification of the recent security audit

Reviewed 2026-09-22 against main `0c3a5f42ce6c208f7d34e8e87ea83924e4fd545e`,
then prepared the repairs below for `0.2.0-rc.2`. The supplied local report
remains private and unchanged. This sanitized record preserves all eleven
finding IDs. It is verification of supplied claims, not a new exhaustive scan.

The applicable policy is [SECURITY.md](../SECURITY.md): trusted single-host
operation, an authenticating proxy for every private remote route, and selected,
keyless, forced-mock data for a public read-only demo. An Origin check is CSRF
protection, not authentication. A dangerous operation alone does not establish
an unauthorized caller or a supported boundary crossing.

## Findings in the original order

| ID | Verdict on reviewed main | Evidence, limits and disposition |
| --- | --- | --- |
| H1 — default listeners allow remote writes | Not actionable on repaired main; high confidence. Still affects the immutable rc.1 defaults. | Both scripts in `apps/web/package.json` already bind `127.0.0.1` after PR #15. Actual Next dev/start socket tests confirm loopback, while explicit remote opt-in remains possible. Include that repair in rc.2; restart existing servers. Private remote access still requires the authenticated proxy. |
| H2 — workload and spending can exceed UI defaults | Needs review, medium confidence; review rank 3. | `api/runs/route.ts` and `run-service.ts:startRun` lack a sample maximum and global run admission limit. The UI's $2 is a default per-run budget, not an account cap: `BudgetLedger` reserves every paid attempt against the selected run ceiling; mock/Ollama intentionally have zero provider price. The supplied unauthorized-spend chain depends on H1 or another unestablished access bypass. Shared API/CLI workload bounds and concurrent-run admission remain useful hardening, without silently removing legitimate operator budget overrides. |
| H3 — credential file readable by additional principals | Needs review, medium confidence; review rank 5. | Only ACL metadata and ignore/tracking status were inspected. The file is untracked and ignored; its ACL includes owner, administrators, system, sandbox infrastructure and unresolved identities. Whether any principal is untrusted is unresolved. No credential contents, provider validity, unauthorized access or leak was verified. Resolve ownership before changing host policy; rotate if exposure is established or the operator chooses precautionary replacement. Authorized audit access alone does not prove compromise. |
| H4 — published readers can export benchmark data | Not actionable as a separate authorization bypass under the supported policy; high confidence. | Read APIs intentionally export stored results behind the private access boundary; a public demo requires a separately reviewed dataset. The audit does not bypass that proxy. The Dockerfile's broad host-port example was nevertheless corrected to `127.0.0.1:3000:3000` in rc.2. Read-only is not confidentiality protection. |
| M1 — generated HTML can steer the LLM judge | Needs review, medium confidence; review rank 1. | `runners/build-arena/src/judge.ts` places untrusted HTML inside predictable prompt delimiters and extracts a JSON object from a larger reply. The source-to-prompt path exists, but no actual judge obeying an injected instruction was demonstrated. Order swapping addresses position bias, not prompt injection. Keep adversarial judge evaluation and stricter reply parsing open; random delimiters or encoding alone cannot prove instruction integrity. |
| M2 — repeated provider probes consume quota | Needs review, medium confidence; review rank 2. | `api/providers/health/route.ts` lets `refresh=1` bypass the cache and does not coalesce simultaneous misses. Cross-site request sending is a concern even when responses cannot be read; provider quota exhaustion or lockout was not demonstrated. Forced mock mode makes no provider requests. Follow up with a bounded refresh policy and synthetic concurrency tests. `OLLAMA_BASE_URL` is operator configuration, not an attacker-controlled API field. |
| M3 — annotations replace displayed visual scores | Not actionable as a separate unauthorized write on repaired main; high confidence. | The common write guard protects `annotations/route.ts`; `loaders.ts` deliberately produces a human-labeled view while retaining measured samples. The claimed hostile writer relies on H1. Single-operator annotations do not promise multi-user identity. Existing presentation tests preserve source labels, recorded scores, sample count and exports. Richer side-by-side score presentation remains a product improvement. |
| L1 — missing operator browser headers | Confirmed, high confidence; remediation rank 1. | No anti-framing control protected the UI. A framing site could induce legitimate same-origin actions, which the Origin guard does not distinguish. rc.2 adds global CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` and `no-referrer`. HSTS stays at the TLS proxy. |
| L2 — reading the demo queue writes votes | Confirmed, high confidence; remediation rank 2. | `pairs.ts:buildPairQueue` called `ensureDemoVotes` for the demo ID, including after a failed vote read and in read-only mode. rc.2 removes the helper and all implicit vote writes. All three backends already support explicit demo vote seeding. Empty or manually assembled legacy queues now remain empty. |
| L3 — incomplete diagnostic secret scrubbing | Needs review for actual credential exposure, medium confidence; review rank 4. Local redaction gap reproduced and hardened. | Synthetic Google keys, Supabase secret keys and JWTs survived the original scrubber. Truncating first could also expose partial existing key shapes. rc.2 extends the shared scrubber, redacts full bounded diagnostics before truncation, and uses it for store health and persistence logs. No live provider echo was demonstrated; redaction remains best effort, not a promise that arbitrary private data is safe to publish. |
| L4 — unbounded run names and annotation count | Not actionable as a separate cross-privilege write under current policy; high confidence. | Names have no maximum and annotation count is uncapped, although notes are capped at 4,000 characters. The audit relies on H1 or the same trusted writer. Track name/body/storage limits with H2 hardening; no lower-privilege supported writer was established. |

These are claim-specific verdicts. “Not actionable” does not mean an exposed
private installation is safe. “Needs review” is an evidence gap, not clearance.
The confirmed queue and review queue are independently ranked.

## Repair and verification evidence

The fix boundary is global Next response headers, the shared comparison-queue
reader, and the shared diagnostic scrubber plus every affected truncation site.
No authentication redesign, credential rotation, ACL modification, provider
request or paid benchmark was performed.

- The header regression loads the actual Next configuration through Next's
  loader in an isolated fixture. It failed before the patch and passes with
  protection on the global route. Configuration loading never reads the
  operator's dotenv files. The test strips TypeScript locally to avoid an
  automatic dependency install in the empty fixture.
- The vote regression failed before the patch with 20 write attempts. It now
  proves zero writes across repeated reads, writable/read-only settings and
  failed vote reads in memory and SQLite. Explicitly seeded demos retain their
  four recorded votes and pair-5 queue position. Supabase's seeding path was
  inspected; no live Supabase instance was exercised.
- Synthetic tests cover bare/quoted/repeated credential shapes, full JWT
  segments, ordinary diagnostics, provider HTTP and stream errors, health
  truncation and store-health output. Existing provider adaptation, cancellation,
  stream limits and frontend evidence tests remain applicable.
- The listener socket, origin guard and environment isolation regressions were
  rerun. Existing measured scores and human overrides remain distinct in the
  tested exports. The patch does not claim every GET is free of maintenance
  side effects: interrupted-run reconciliation is a separate behavior.
- Independent read-only investigation and candidate review are part of the
  repair process. The reviewer reproduced a whitespace-serialized JWT bypass
  in the initial candidate. Header-aware compact JWT recognition and regression
  cases now cover that representation; ordinary dotted diagnostics remain intact.
  Full source CI and the protected release workflow must pass
  for the exact tagged commit before a draft is prepared or published. Runtime
  header/config checks do not establish resistance to every browser exploit.

See [the living release plan](RELEASE_PLAN.md) for completion receipts. Container
publication remains blocked by the native advisory and redistribution gates;
this review neither suppresses those findings nor certifies an image.

## Next work

1. Finish exact-commit source checks and publish the patched rc.2 source packet.
2. Add shared workload admission and bounded/coalesced health refreshes, with
   synthetic abuse tests and explicit operator-facing limits (H2, M2, L4).
3. Evaluate adversarial judge artifacts and strict response parsing (M1),
   retaining uncertainty rather than presenting a delimiter change as a cure.
4. Resolve the local credential ownership question (H3) without publishing host
   identifiers or changing the managed sandbox's policy.
5. Continue the scoped LLVM/libxml2 prototype and binary redistribution review;
   rerun the entire image gate before any container promotion.
