# Package notice reconciliation

Checked against exact public npm tarballs on 2026-09-18. Their SHA-512 integrity,
complete member names, published metadata and retained README/package bytes are
recorded in [published-package-evidence.json](published-package-evidence.json).
Full upstream license hashes are in
[reconciled-full-license-manifest.json](reconciled-full-license-manifest.json).
This resolves the earlier filename-only inventory checks as follows.

| Package | Evidence and disposition |
| --- | --- |
| `@humanfs/types@0.15.0` | Published `package.json` declares Apache-2.0 and Nicholas C. Zakas; the source header names the same author. Both are retained in `published/humanfs-types-0.15.0/`. The exact published revision has no type-package or repository-root LICENSE. The unmodified Apache-2.0 text from `packages/core/LICENSE` at that same revision is retained as `humanfs-Apache-2.0.txt`, with provenance in `humanfs-manifest.json`. No new copyright year or grant was invented. |
| `@types/json5@0.0.29` | Published definition bytes exactly match `json5/index.d.ts` at DefinitelyTyped commit `a5f4d50cccf025b6a8088093e76da2b20c1220f3`. That revision's full repository MIT license is retained as `types-json5-0.0.29-LICENSE.txt`; it attributes definition contributors. The original Jason Swearingen definition header and published README are retained alongside it. |
| `keyv@4.5.4` | All four published files match the release commit `e4d608eccdfc094b80f6e9545c5307ee0810af72` byte-for-byte. Its root MIT license, including Jared Wray attribution, is retained as `keyv-4.5.4-LICENSE.txt`. Earlier guesses at a `v4.5.4` tag returned 404; the verified release commit resolves that check. |
| `language-subtag-registry@0.3.23` | Exact README identifies Matthew Caruana Galizia and contributors and explicitly links CC0 1.0. Retained the README and the full official CC0 text as `language-subtag-registry-0.3.23-CC0.txt`. |
| `language-tags@1.0.9` | Exact README's 2013 Matthew Caruana Galizia copyright remains unchanged. Retained the full author-linked MIT text from `https://mattcg.mit-license.org/license.txt` as `language-tags-1.0.9-linked-LICENSE.txt`. The linked site currently renders a 2026 copyright date; it is supplemental text, not a replacement for the published 2013 attribution. |
| `natural-compare@1.4.0` | Exact README's 2012–2015 Lauri Rooden attribution is retained. The full author-linked MIT text from `https://lauri.rooden.ee/mit-license.txt` is retained as `natural-compare-1.4.0-linked-LICENSE.txt`. |
| `stable-hash@0.0.5` | Published package metadata declares MIT and Shu Ding; the README says it is MIT and created by Shu Ding. These are retained. The five-file published archive has no full license, and the [exact published repository tree](https://github.com/shuding/stable-hash/tree/1b314f2cc3e9449bc8d49e417670175cf9afd42a) contains no LICENSE/COPYING/NOTICE file or full license in its README. Full author-issued permission text is therefore unavailable from those versioned sources. A maintainer-supplied notice or a dependency version with complete notices would close this specific gap; another project's MIT grant is not substituted. |
| `client-only@0.0.1` | The [exact published package](https://registry.npmjs.org/client-only/0.0.1) declares MIT but provides no author, copyright, repository or git revision. Its entire three-file archive is `package.json`, a headerless `error.js`, and empty `index.js`; there is no README or license. The published metadata and complete file list are retained. It points to the React homepage but does not identify a source revision or copyright holder, so this check cannot establish a version-specific full grant. Obtain that notice from the publisher or use a dependency with complete provenance before describing this attribution gap as resolved. |

The final two rows are precise upstream publication omissions, not an assertion
that the packages have no license. Their existing MIT declarations remain
recorded. The other six rows have full declared license text and published
attribution retained; this does not relicense any dependency.
