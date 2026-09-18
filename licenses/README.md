# Retained dependency notices

These files preserve upstream text. Do not reformat their `.txt` contents: the
manifests record SHA-256 hashes of the original bytes.

`sharp-libvips-1.3.3/` supplies the principal missing native-library notices from
the inspected `@img/sharp-libvips-linux-x64@1.3.3` package. The published npm
`gitHead` and upstream tag both identify commit
`6e5971d333377743163edc3ad9e5d0b897abcbc9`. Its release dependency table matches all
28 components in the installed `versions.json`.

- `manifest.json` maps each exact upstream source archive to its SHA-256 hash and
  the notice files copied from it. The collection contains 87 unmodified notice,
  license, copyright and author files from all 28 archives.
- `UPSTREAM-THIRD-PARTY-NOTICES.txt`, `versions.properties.txt` and
  `build-posix.sh.txt` are pinned to that packaging commit. The packaging scripts'
  Apache license is retained separately; it does not replace native component
  licenses.
- `supplemental-manifest.json` records the full GNU GPLv3/LGPLv3 texts and the
  four external patches named in the build recipe. The libultrahdr pull-request
  patch is retained with its content hash because its URL is not a commit URL.
- The complete downloaded source archives are cached locally under
  `artifacts-data/release-source-material/sharp-libvips-1.3.3/` (approximately
  162 MB). That ignored cache is **not** included in a Git clone or Docker image.
  Run `python licenses/collect_sharp_notices.py` to reproduce the collection.
- `packaging-source-manifest.json` records the complete pinned packaging source
  archive, including platform build files. Run
  `python licenses/build_source_review_packet.py` to create the deterministic
  `artifacts-data/release-source-material/sharp-libvips-1.3.3-source-review.tar.gz`,
  its archive and per-file SHA-256 indexes, and a JSON inventory. This offline
  command verifies the cached source hashes before packaging. The packet contains
  [specific unresolved source/build gaps](sharp-libvips-1.3.3/SOURCE_REVIEW_GAPS.md)
  and has not been uploaded. It is historical review material if the final
  runtime excludes Sharp.

`npm/manifest.json` records additional exact-revision/version license files for
esbuild, Next.js and unrs-resolver. The follow-up
[package reconciliation](npm/RECONCILIATION.md) resolves six further checks with
retained full terms and published attribution; `client-only@0.0.1` and
`stable-hash@0.0.5` have precisely documented upstream notice omissions.
`collect_npm_notice_evidence.py` verifies public tarball integrity and reproduces
their published attribution evidence. Preserve the original package notices too.

`chrome-headless-shell-153.0.8010.52/` retains the exact official Linux archive's
complete browser notice and version-pinned source references. Its
[distribution evidence](chrome-headless-shell-153.0.8010.52/README.md) distinguishes
the browser's shipped terms from the CfT dashboard scripts' Apache license and
records the remaining product-terms and covered-source questions.

The repository's Docker `COPY` includes this `licenses/` directory, making the
retained notices available at `/app/licenses/` after rebuilding. Verify these
paths and hashes in the final image; a previous image does not gain these files.

This collection materially improves notice retention but is not a complete
corresponding-source release. The native libvips source/relinking gaps apply only
when that optional binary is distributed; the current runtime has removed it.
For the actual image, resolve the browser product-terms and covered-source
questions, Debian source-delivery arrangements and the installed `client-only`
notice omission. The production image excludes `stable-hash` in every layer;
its documented omission still applies to the development checkout. Publish
required material through a durable recipient-accessible
route. A local ignored cache is not evidence that this delivery is complete.
See [the distribution review](../THIRD_PARTY_NOTICES.md).
