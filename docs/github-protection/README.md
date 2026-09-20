# GitHub protection settings

These configurations are **active and read back from GitHub** for the public
`hugosmoreira/model-lab` repository as of 2026-09-20 UTC. Main ruleset `23717530`
and version-tag ruleset `23717531` have no bypass actors. Release environment
`22316904136` requires the maintainer reviewer, disables administrator bypass,
and permits only the `main` branch through policy `60461512`. GitHub private
vulnerability reporting, secret scanning and push protection are enabled and
their settings were verified. The reviewed source prerelease was published
after these settings were verified; the existing tag and assets are unchanged.

The following records the earlier private preparation. On 2026-09-18 the private repository's ruleset
and branch-protection endpoints returned HTTP 403 with an upgrade-or-public
requirement. Creating the release environment's required-reviewer rule returned
HTTP 422 because the current plan does not support that rule here. GitHub
partially created an empty environment despite the error; that newly created,
unprotected environment was removed and its absence verified.

[Ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)
and [environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
depend on visibility and plan. In particular, Pro alone does not provide
required environment reviewers for a private personal repository.

The maintainer authorized a source-only release path. While the project stays
private, the preparatory process checks the exact PR head, requires successful
application and secret checks, merges that head, verifies the resulting tree,
creates a new version tag without replacing one, and prepares a **draft** from
that verified source. If the environment workflow is unavailable, the same
version/clean-tree/archive/checksum steps may be executed by the maintainer and
the private draft created through the GitHub CLI. Record the verification run
and this manual preparation in its notes. This is not an enforced branch rule
or an environment approval. Public publication remains a separate decision.

For future setup or changes, inspect existing settings and read back these rules:

- `main-ruleset.json` requires a pull request, up-to-date application and secret
  checks from the verified GitHub Actions integration (`15368`), resolved review
  threads, and no force pushes or deletion. There are no bypass actors. The
  initial single-maintainer policy requires zero external approvals because
  GitHub does not allow authors to approve their own PR. Add an independent
  reviewer requirement when a second maintainer is available. The image advisory
  job remains visible and separately blocks the container release workflow.
- `version-tags-ruleset.json` prevents moving or deleting `v*` tags, with no
  bypass actors. It permits new version tags; release workflows independently
  require the tagged revision to be on main.
- `release-environment.json` requires review by `hugosmoreira` (user ID
  `38438788`) and selects custom deployment branch rules. After creating it,
  add a branch policy with `{"name":"main","type":"branch"}`; selected mode
  alone is incomplete. Self-review is allowed for this single-maintainer project.
  `can_admins_bypass: false` disables administrator bypass; its returned value
  was verified along with the reviewer and branch policy.

Inspect existing settings before applying these payloads; update a matching
configuration instead of creating duplicates. After activation, fetch the actual
rules and environment policies and compare them to these files. Do not treat an
unsuccessful API response or a locally valid JSON file as enabled protection.

No rule here clears the native image advisory or redistribution blockers.
