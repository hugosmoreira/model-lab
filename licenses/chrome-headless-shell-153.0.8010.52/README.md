# Exact headless-shell distribution evidence

The Linux x64 archive named in `manifest.json` is the official Chrome for Testing
`chrome-headless-shell` asset for **153.0.8010.52**. Its SHA-256 matches the
project's pinned `runners/build-arena/browser-runtime.json`. The complete original
`LICENSE.headless_shell` (2,257,005 bytes) is retained here, with its hash. The
installer preserves this file beside the executable, at
`/ms-playwright/153.0.8010.52/linux-x64/chrome-headless-shell-linux64/LICENSE.headless_shell`
in the proposed image. Final image inspection must confirm that path and hash.

## License scope

The artifact's license begins with the Chromium Authors' BSD-style terms,
including permission for binary redistribution subject to its notice and
non-endorsement conditions. The exact version's Chromium root license is
byte-for-byte present in that collected file. The remainder contains third-party
terms; the root BSD grant does not replace them. Preserve the entire file and
avoid claiming Google endorsement or applying Model Lab's MIT label to it.

The [CfT dashboard repository's Apache-2.0 license](https://github.com/GoogleChromeLabs/chrome-for-testing)
licenses its own scripts. It is not the browser license. An
[official maintainer clarification](https://github.com/GoogleChromeLabs/chrome-for-testing/issues/21#issuecomment-1594319082)
directs CfT binaries to [Google Chrome terms](https://www.google.com/chrome/terms/).
That June 2023 comment predates the separately published headless-shell asset
and does not expressly address it. Accordingly, this evidence establishes the
notice actually shipped with this asset, but does **not** infer a blanket
redistribution grant for all CfT products. Before publishing an image containing
this asset, establish the applicable product-terms route for headless-shell or
select a browser distribution with explicit suitable redistribution terms.
No browser binary is added to the source repository by this notice collection.

## Version-matched source route

The [official version manifest](https://googlechromelabs.github.io/chrome-for-testing/153.0.8010.52.json)
identifies the asset URLs. The matching
[Chromium source tag](https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.52)
resolves to commit **78e5e45d4bb41035e17ea4da2cc257f496416ac9**.
The unmodified `LICENSE`, `DEPS` and `headless/BUILD.gn` are retained here.
`DEPS` pins external repositories; `headless/BUILD.gn` generates the component
license file for target `//headless:headless_shell`. For a source checkout, use
the [official Chromium Linux build instructions](https://chromium.googlesource.com/chromium/src/+/78e5e45d4bb41035e17ea4da2cc257f496416ac9/docs/linux/build_instructions.md)
at that commit and sync its exact dependencies; a source-root tarball alone
does not contain every repository listed in `DEPS`.

Removing the separate Playwright FFmpeg executable does not remove the browser's
FFmpeg component. Its source is pinned by `DEPS` to
[53fa34a23be9054d25ac2500dbdae9a0e570bb5c](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/53fa34a23be9054d25ac2500dbdae9a0e570bb5c/).
The collected notice includes FFmpeg, WebKit and other LGPL-family material,
and MPL-2.0 Symphonia components. Some notices describe optional configurations;
their text alone does not prove those options were enabled. Binary publication
still needs the applicable covered-source delivery and relinking arrangements
for the actual build. This collection has not built the browser, captured its
official build arguments or intermediate objects, or established that complete
delivery. These specific gaps must not be described as closed by retaining the
license file alone.
