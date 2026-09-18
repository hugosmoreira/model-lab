# Third-party notices and distribution inventory

Model Lab's own source is covered by [LICENSE](LICENSE), copyright 2026 Hugo
Moreira. Dependencies and bundled programs retain their own licenses. The OCI
image's `MIT` label describes Model Lab; it does not relicense the image's contents.

This document records the active filesystem of the Linux/amd64 candidate inspected
on 2026-09-18, image
`sha256:d5e17b681522e2ce14ef322958e416458c132f24fef25800ffece3190e2af67b`.
It uses Node 22.23.2, Playwright 1.63.0 and the official CfT headless-shell
153.0.8010.52 asset. The final release report must bind these records to the
publication digest. This image's supplemental notices and all four Expat license,
source and build-provenance files were verified. All-layer inspection confirms
the unused Sharp bundle and older Expat libraries are absent. The image records
a development snapshot, not an exact-commit release certification.

## Where the retained notices are

The candidate contains 335 installed pnpm packages, including development
dependencies. All 335 report license metadata; 17 have no notice file matching
the inventory's package-root filename rule. This rule does not inspect source
headers or README text and is not, by itself, a finding that a license is absent.

| Distributed material | Location inside the image |
| --- | --- |
| JavaScript packages and platform bindings | `/app/node_modules/.pnpm/<package-resolution>/node_modules/<package>/`; retain their `LICENSE*`, `COPYING*`, `NOTICE*`, copyright files and embedded source notices |
| Node and its bundled components | `/usr/local/LICENSE` |
| Chromium headless shell and its component notices | `/ms-playwright/153.0.8010.52/linux-x64/chrome-headless-shell-linux64/LICENSE.headless_shell` (2,257,005 bytes; SHA-256 `b92247f7a44c14627ef5cbbe0aa6dcca4e4422b7c05e6f2c660054061a5e3da7`) |
| Debian libraries, utilities and fonts | `/usr/share/doc/<package>/copyright`; 172 such files were recorded, with referenced texts also under `/usr/share/common-licenses/` |
| Supplemental notices verified in this image | `/app/licenses/` and `/app/THIRD_PARTY_NOTICES.md`; 151 indexed files; [collection provenance](licenses/README.md) |

The image's JSON inventory records exact package versions, paths and notice
SHA-256 hashes. Generate it from the candidate, with networking disabled:

```sh
docker run --rm --network none --read-only --workdir /app \
  --entrypoint node IMAGE_DIGEST scripts/image_license_inventory.mjs > image-licenses.json
```

The inventory does not enumerate every nested Rust/C/C++ component. Global npm,
Corepack and `/pnpm` are absent from this candidate's active filesystem. Its
retained workspace development dependencies remain distributed components.
Sharp and its `@img/sharp-*` bindings, Xvfb and the separate Playwright FFmpeg
program have been removed from the runtime. The saved-layer inventory confirms
Sharp and older Expat binaries are absent from all 14 image layers. The browser
still has its own FFmpeg component.

## Components requiring particular attention

| Component in this candidate | Recorded license and source reference | Distribution action |
| --- | --- | --- |
| CfT `chrome-headless-shell@153.0.8010.52` | Shipped Chromium BSD-style license plus collected component terms; [exact artifact/source evidence](licenses/chrome-headless-shell-153.0.8010.52/README.md) | Retain the complete notice. Establish the applicable headless-shell product terms and covered-source delivery route before binary publication. |
| `libexpat1@2.8.4-0modellab1` | MIT; unmodified [upstream 2.8.4](https://github.com/libexpat/libexpat/releases/tag/R_2_8_4), SHA-256 `656ae1cc8da3b4ea513bb4e254f33e6243938084c0ec6239da873376b09985a7` | The local same-ABI package replaces Debian's older parser. `/usr/share/doc/libexpat1/` retains `copyright`, `changelog`, `build-recipe.sh` and `source-provenance.txt`; final-image checks verify their hashes. |
| `axe-core@4.13.0` | MPL-2.0; [versioned source](https://github.com/dequelabs/axe-core/tree/v4.13.0). Package includes `LICENSE` and `LICENSE-3RD-PARTY.txt`. | Retain both notices and provide a working source route for the covered version. |
| `lightningcss@1.32.0` and `lightningcss-linux-x64-gnu@1.32.0` | MPL-2.0; [versioned source](https://github.com/parcel-bundler/lightningcss/tree/v1.32.0). Both include `LICENSE`. | Retain notices and account for the native binding's covered source and bundled components. |
| `caniuse-lite@1.0.30001806` | CC-BY-4.0; package author Ben Briggs; [Browserslist source](https://github.com/browserslist/caniuse-lite) and [Can I Use data](https://caniuse.com/) | Retain attribution and license notice. Record any changes to distributed data. Model Lab has not intentionally modified this installed package. |
| Debian base and Chromium dependencies | Mixed licenses. Inspected Debian notices include GPL-family terms in Bash/coreutils and MPL-2.0 in NSS. | Preserve the complete notices; record installed package/source versions and the applicable source delivery arrangements for the exact base image. |

MPL source availability and notice requirements are described in
[MPL 2.0 sections 3.1–3.4](https://www.mozilla.org/en-US/MPL/2.0/).
Attribution and change notices for the data package follow
[CC BY 4.0 section 3](https://creativecommons.org/licenses/by/4.0/legalcode.en).
These references supplement the actual component licenses; this index is not a
replacement for their full text or a completed source-distribution package.

Other recorded package licenses are MIT, Apache-2.0, ISC, BSD-2-Clause,
BSD-3-Clause, 0BSD, CC0-1.0, BlueOak-1.0.0 (`minimatch@10.2.6`) and Python-2.0
(`argparse@2.0.1`). Keep their existing notices when copying or trimming the image.

## Open checks before publishing the container

1. **Complete browser distribution evidence.** The exact official headless-shell
   license and Chromium commit/DEPS are retained. The CfT dashboard's Apache
   license does not license its downloads; the maintainer's general CfT terms
   clarification predates the separate headless-shell asset. Resolve that
   product-terms scope and the covered-source/relinking arrangements for the
   actual browser build. The [browser evidence](licenses/chrome-headless-shell-153.0.8010.52/README.md)
   identifies the exact source commit and embedded FFmpeg revision, avoiding a
   generic source-version guess.
2. **Finish package notice reconciliation.** Exact upstream license texts for
   esbuild, the Next.js family and unrs-resolver are retained in
   [licenses/npm](licenses/npm/manifest.json). Esrecurse and imurmurhash already
   supplied full license terms in READMEs; those sections are now retained
   separately. Humanfs's Apache text is supplied from the same repository
   revision. The [eight-package follow-up](licenses/npm/RECONCILIATION.md)
   retained full declared terms and attribution for six packages, including
   byte-matched historical Keyv and DefinitelyTyped releases. Two precise
   upstream omissions remain: `client-only@0.0.1` has an MIT declaration but no
   author, full license or source revision; `stable-hash@0.0.5` names Shu Ding
   and MIT but its published archive and exact repository revision omit the
   full permission text. Published evidence is retained; no grant was invented.
3. **Publish verifiable distribution evidence.** Attach the final image inventory,
   notice collection and version-matched source delivery information to the
   release. Verify recipients can retrieve the required material. Recheck if
   dependencies, base image, browser build, packaging or bundled tools change.

## Retained historical and optional-checkout evidence

The earlier candidate included Sharp's libvips bundle and Playwright's separate
FFmpeg program. They are absent from the current active runtime filesystem.
The 28 collected libvips archives, 87 original notices, four patches and complete
pinned packaging source remain useful for checkout installs or a future image
that restores Sharp. They are not evidence that the removed binary is still
shipped. Build the ignored review packet with
`python licenses/build_source_review_packet.py`; it includes per-file and archive
SHA-256 indexes and [specific unresolved build/source gaps](licenses/sharp-libvips-1.3.3/SOURCE_REVIEW_GAPS.md).
No source archive was uploaded or included in the image. These libvips-specific
gaps are not gates for an image proven to exclude the bundle from all layers.

Source publication and binary publication are separate release decisions. A
source-only GitHub release can present this code and the retained notices for
review without attaching a prebuilt container. The open checks above remain
gates for the proposed GHCR image; a source tag must not imply they passed. No
dependency was relicensed, and this review does not mark the binary distribution
ready for publication.
