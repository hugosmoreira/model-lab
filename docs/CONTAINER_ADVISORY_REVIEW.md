# Container advisory review

Review date: 2026-09-18 UTC. This document records a bounded, source-backed review
of the 20 unique OS CVEs represented by 56 HIGH and one CRITICAL occurrences in
the supplied remediation scan. Repeated occurrences across Debian binary
packages are retained in the scanner report; this review explains each unique
advisory. It does not certify the container or replace the release gates.

**Publication is not cleared by this review.** The three reviewed Expat
advisories are fixed by the verified upstream 2.8.4 library in image `d5e17b6`
identified below. This is a scoped source, binary and runtime verification;
several other native-library findings still have unresolved reachability
questions. Raw scanner findings remain unsuppressed and are distinct from
these advisory-specific conclusions.

## Evidence identity and limits

The initial input was `artifacts-data/image-vulnerabilities-remediation.json`
and its `-summary.json`, reporting Debian 13.7 and image
`model-lab:remediation-check`:

```
sha256:025dad0c54a5880d2994735b6203d0384f9a8d4b89c8a9b05cd6cfe0f6af9416
```

That image still contained the older browser, Sharp and Xvfb. Independent
package/binary inspection was subsequently performed against the patched
Chrome-for-Testing 153.0.8010.52 image:

```
sha256:8e468e965d0e5b45c1029980ed10e2d92e09d36606bb07ecb61193f7e7c930c9
```

Release packaging subsequently reported this newer candidate, whose historical
Sharp layers were being corrected:

```
sha256:5ac2934cd773f37da913f287e5e1116fe04a892f954a047e0aff97abb40f8b7c
```

Image `5ac2934` subsequently supplied the old Expat 2.8.3 ELF export baseline;
its entire runtime inventory was not independently reverified here. The final
Expat verification described below targets `model-lab:release-expat-notices-check`:

```
sha256:d5e17b681522e2ce14ef322958e416458c132f24fef25800ffece3190e2af67b
```

An earlier Expat candidate, `273b1e13c8fc2c951c22df7876d27b45a3e97522e5d1f138d7f33a95c20716a3`,
contained the patched library but omitted three promised provenance files due
to Debian slim's documentation filters. It is superseded by `d5e17b6`, whose
four notice files were independently verified. A changed image requires its
own verification; neither a tag nor a statement that binaries are unchanged
automatically transfers these conclusions. The historical non-Expat
observations below retain their original image scope.

The local source checkout was based on commit
`ac8479891660ec9bdc89690c7283d82dafb0fcc6` with ongoing uncommitted release work.
That commit alone does not identify the reviewed source snapshot or image.

Inspection used temporary, read-only containers, no host mounts and
`--network none`. It read selected package metadata, executable presence,
permissions, and ELF dynamic imports/dependencies. Public Debian and upstream
advisory/source material was consulted separately. The initial triage used no
application or exploit probe. The subsequent Expat verification inspected
synthetic build/test evidence and independently ran a bounded offline browser
blank-page check. No real environment file, credential, private database or
private artifact was read. A scan of system shared-library import tables is
not proof that arbitrary runtime `dlopen`/`dlsym` behavior is absent.

## Supported boundary

[SECURITY.md](../SECURITY.md) and [DEPLOY.md](DEPLOY.md) describe a trusted,
single-host Linux amd64 installation. The private writable profile requires
external authentication for remote access. The public profile is keyless,
forced-mock and read-only. The application itself supplies no authentication.

Generated HTML is hostile input to the runner's browser, even when the
operator and application configuration are trusted. The UI displays captured
PNGs. The runner's response-header CSP allows scripts, styles and data images;
HTTP/WebSocket controls and a deny-only proxy restrict network access. These
controls do not establish protection against native browser/parser defects.
The policy accepts that generated programs can consume CPU and memory until
termination and calls for container resource limits. Whether a native parser
defect defeats termination or harms an independent run is a separate question
from whether its parser is reachable.

The 2 MiB HTML-source limit does **not** bound images or strings constructed by
JavaScript. The 30-second watchdog is a mitigation to validate, not evidence
that every native operation can be interrupted. In
`runners/build-arena/src/checks/browser-checks.ts`, `stop()` requests context
closure; cleanup subsequently awaits context closure. Static inspection alone
does not prove a native parser thread terminates promptly.

## Observations from image 8e468e9

- Runtime UID/GID were 1000. Effective, permitted and ambient capability sets
  were zero. The capability bounding set was not zero.
- `/etc/fstab` contained only the unconfigured-base-system comment.
- The checked CUPS daemon, systemd-homed, Python and Xvfb executables were
  absent. No Sharp or `@img/sharp-*` package directories remained in the active
  pnpm store. This active-filesystem observation does not establish removal
  from earlier image layers.
- `libexpat1` was `2.8.3-1~deb13u1`; `libxml2` was
  `2.12.7+dfsg+really2.9.14-2.1+deb13u3`; `libllvm19` was
  `1:19.1.7-3+b1`; `libfontconfig1` was `2.15.0-2.3`.
- `libacl1` was `2.3.2-2+b1`; util-linux/mount were
  `2.41.5-0+deb13u1`; `ncurses-bin` was `6.5+20250216-2`.
- The browser directly required `libexpat.so.1`. Its XML imports were
  `XML_ParserCreate_MM`, `XML_SetHashSalt`, `XML_SetUserData`,
  `XML_SetElementHandler`, `XML_SetCharacterDataHandler`,
  `XML_SetEntityDeclHandler`, `XML_Parse`, `XML_GetBuffer`, `XML_ParseBuffer`,
  `XML_StopParser` and `XML_ParserFree`.
- Other observed Expat consumers were Fontconfig and Mesa's Gallium, GLX and
  GBM driver libraries. No reviewed consumer imported
  `XML_SetUnknownEncodingHandler`. `libgbm` declared an Expat dependency but
  exposed no direct XML imports in the inspected table.
- LLVM19 was the only system shared library found with a direct
  `libxml2.so.2` dependency. It imported `xmlReadMemory`, tree-manipulation
  functions and `xmlDocDumpFormatMemoryEnc`. It is inaccurate to describe this
  dependency as output-only. Browser HTML/SVG parsing must not be conflated
  with this particular system-libxml2 dependency.

The candidate Dockerfile purges Xvfb and strips SUID/SGID bits under `/usr`.
The old image demonstrably retained SUID/SGID programs. The final `d5e17b6`
release smoke report now records no such programs under `/usr`; this is a
deployment mitigation, not a patch for every privileged-call advisory.

## Expat source-to-parser trace

Chrome tag `153.0.8010.52` pins Skia revision
`f8b66b7597c4cc859d3ed190e9c6872241e6721c` in its
[DEPS file](https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.52/DEPS#340).
The relevant chain is:

```
generated HTML with a data: JPEG containing MPF/XMP metadata
  -> Blink DeferredImageDecoder::ActivateLazyGainmapDecoding
  -> JPEGImageDecoder::GetGainmapInfoAndData
  -> SkJpegMetadataDecoderImpl::findGainmapImage
  -> getXmpMetadata -> SkJpegMakeXmp -> SkXmp::Make
  -> SkDOM::build -> SkXMLParser::parse -> system XML_Parse/ParseBuffer
```

Exact source anchors:

- [Chrome skia/features.gni:34](https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.52/skia/features.gni#34):
  XMP support follows `use_blink`.
- [Chrome skia/BUILD.gn:397](https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.52/skia/BUILD.gn#397):
  XMP adds the XML sources, Expat dependency and JPEG gainmap feature define.
- [Deferred decoder:333](https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.52/third_party/blink/renderer/platform/graphics/deferred_image_decoder.cc#333):
  normal lazy decoding attempts gainmap processing once all data is received.
- [JPEG decoder:994](https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.52/third_party/blink/renderer/platform/image-decoders/jpeg/jpeg_image_decoder.cc#994):
  the metadata gate leads to `findGainmapImage`.
- [Skia metadata decoder:176](https://skia.googlesource.com/skia/+/f8b66b7597c4cc859d3ed190e9c6872241e6721c/src/codec/SkJpegMetadataDecoderImpl.cpp#176)
  parses XMP before validating its gainmap semantics;
  [line 471](https://skia.googlesource.com/skia/+/f8b66b7597c4cc859d3ed190e9c6872241e6721c/src/codec/SkJpegMetadataDecoderImpl.cpp#471)
  makes the earlier gate depend on valid MPF metadata.
- [SkJpegXmp.cpp:181](https://skia.googlesource.com/skia/+/f8b66b7597c4cc859d3ed190e9c6872241e6721c/src/codec/SkJpegXmp.cpp#181),
  [SkXmp.cpp:639](https://skia.googlesource.com/skia/+/f8b66b7597c4cc859d3ed190e9c6872241e6721c/src/codec/SkXmp.cpp#639)
  and [SkDOM.cpp:291](https://skia.googlesource.com/skia/+/f8b66b7597c4cc859d3ed190e9c6872241e6721c/src/xml/SkDOM.cpp#291)
  connect image metadata to the XML parser.
- [SkXMLParser.cpp:164](https://skia.googlesource.com/skia/+/f8b66b7597c4cc859d3ed190e9c6872241e6721c/src/xml/SkXMLParser.cpp#164)
  sets the salt and handlers, then calls Expat. Its entity-declaration callback
  stops parsing, but it does not reject every DOCTYPE/ATTLIST declaration.

The parser supplies a nonzero salt, generated once per process from a clock
value and `SkRandom` ([lines 65–81](https://skia.googlesource.com/skia/+/f8b66b7597c4cc859d3ed190e9c6872241e6721c/src/xml/SkXMLParser.cpp#65)).
This bypasses the particular Expat `getentropy` bug. It must not be described
as a cryptographically secure salt. No custom unknown-encoding handler is
registered by this source.

## Verified Expat 2.8.4 replacement in d5e17b6

The tracked [Dockerfile](../Dockerfile),
[package recipe](../scripts/container/build-package.sh) and
[focused verifier](../scripts/container/verify-expat.c) use the complete,
unmodified upstream release. They do not cherry-pick individual library fixes
or relabel the old binary. The official
[release asset listing](https://github.com/libexpat/libexpat/releases/expanded_assets/R_2_8_4)
and the independently hashed 519,688-byte `expat-2.8.4.tar.xz` agree on:

```
656ae1cc8da3b4ea513bb4e254f33e6243938084c0ec6239da873376b09985a7
```

Docker's `ADD --checksum` and the build recipe both enforce that digest.
Selected extracted source/test files were compared byte-for-byte with the
archive. The [2.8.4 release](https://github.com/libexpat/libexpat/releases/tag/R_2_8_4)
and [Changes](https://github.com/libexpat/libexpat/blob/R_2_8_4/expat/Changes)
are corroborated by the following source-level fixes:

| Advisory | Fix included in the verified release |
| --- | --- |
| CVE-2026-66046 | Attribute normalization uses a name-to-default-attribute index rather than repeatedly scanning the default-attribute array. First-declaration behavior is preserved. [Fix](https://github.com/libexpat/libexpat/commit/f8f7c4ffd883e3c2c58f0ebb49416a6c1d248738), [release source](https://github.com/libexpat/libexpat/blob/R_2_8_4/expat/lib/xmlparse.c#L3992). |
| CVE-2026-76641, required follow-up | `dtdCopy` allocates the new `NAME_AND_DEFAULT_ATTRIBUTE` representation and copies its index correctly. The external-entity DTD-copy regression test checks subsequent attribute normalization. This fixes the intermediate-patch regression; it is not a fourth original Expat finding in the supplied scan. [Fix](https://github.com/libexpat/libexpat/commit/98599f6dcc2b460410881fe420f5f55d6bec63bf), [source](https://github.com/libexpat/libexpat/blob/R_2_8_4/expat/lib/xmlparse.c#L7837), [test](https://github.com/libexpat/libexpat/blob/R_2_8_4/expat/tests/basic_tests.c#L2813), [Debian](https://security-tracker.debian.org/tracker/CVE-2026-76641). |
| CVE-2026-76956 | The `getentropy` result is tested against zero for success, repairing the inverted result check. This remedies the library independently of Skia's caller-specific salt mitigation. [Fix](https://github.com/libexpat/libexpat/commit/40daa9996d616e66a75dea41ed2b18f2c3901b9f), [source](https://github.com/libexpat/libexpat/blob/R_2_8_4/expat/lib/random_getentropy.c#L57). |
| CVE-2026-76957 | Conversion/release callbacks are wrapped in handler-state tracking, and destructive or parser-mutating reentry is rejected. The regression tests exercise normal custom conversion/release and prohibited reentry. [Fix](https://github.com/libexpat/libexpat/commit/127b7d4beb8fe7e5ce5cb021c2e56379c95863d0), [source](https://github.com/libexpat/libexpat/blob/R_2_8_4/expat/lib/xmlparse.c#L1203), [tests](https://github.com/libexpat/libexpat/commit/acbd2e1179c04fe9a8c3f3837701904d05de71fc). |

The isolated build stage uses upstream CMake with Debian hardening flags and
runs the upstream C test harness. It creates a real local Debian package,
`libexpat1:amd64 2.8.4-0modellab1`, with source `expat`, `Multi-Arch: same`,
`libc6 (>= 2.36)` dependency metadata and an `ldconfig` trigger. This is a Model
Lab local build, not an official Debian security package. Build dependencies
come from the configured Debian repositories; identical future binary output
is not claimed without preserving the toolchain as well as the source.

The package replaces the distribution library after `apt-get upgrade` in the
same runtime `RUN` layer. The final image does not ship the compiler, CMake or
the temporary verifier at their checked paths. Its active Expat directory
contains only the SONAME symlink and versioned `libexpat.so.1.12.4`. Independent
read-only inspection of the exact `d5e17b6` image established:

- `/lib/x86_64-linux-gnu/libexpat.so.1` resolves to
  `/usr/lib/x86_64-linux-gnu/libexpat.so.1.12.4`, SHA-256
  `2965e832f6b21d4f0039036b5cdc51ec64a134d740427a796e9e5e5de124ff13`.
- The SONAME remains `libexpat.so.1`, and its only direct needed library is
  `libc.so.6`. All 72 exported `XML_*` symbols match the old 2.8.3 baseline;
  every observed direct Chrome XML import listed above resolves. Export
  compatibility alone is not proof of arbitrary downstream semantic behavior.
- The actual Chrome 153.0.8010.52 executable successfully rendered
  `about:blank` with exit zero. `LD_DEBUG=libs` recorded the initialized
  `/lib/x86_64-linux-gnu/libexpat.so.1`; its resolved path and hash matched the
  measured replacement. The probe ran as UID 1000 with no network, no host
  mounts, a read-only root, all capabilities dropped, no-new-privileges,
  one CPU, 512 MiB memory, 128 PIDs, a 128 MiB temporary filesystem and a
  20-second process deadline.
- Explicit copying after package installation retains the four files below.
  Their contents/hashes were checked independently against the release and
  recipe, closing the earlier candidate's missing-documentation gap.

| File under `/usr/share/doc/libexpat1/` | SHA-256 |
| --- | --- |
| `copyright` | `31b15de82aa19a845156169a17a5488bf597e561b2c318d159ed583139b25e87` |
| `changelog` | `509f6f07b2999db24d4f0bc174fd83e2af6405156af1897cd4079b85d269739b` |
| `build-recipe.sh` | `647a355ec7be2e5eaf8e15b366f1cfe8160d3b54725f1570edf5825c50769b4d` |
| `source-provenance.txt` | `e31e76447fa3a47813a67b83e62f0d0ac41c4b0d59179f692100389c696694e5` |

The upstream `runtests` CTest entry passed in 7.22 seconds in the recorded build
used by this cached build stage. This one CTest entry runs the upstream C test
harness; it is not a claim of one test per CVE or a separate entropy test.
The final runtime-install verifier again reported `expat_2.8.4`, accepted normal
namespaced XML, rejected mismatched tags and completed the bounded upstream
PR1321 ATTLIST normalization fixture under a ten-second external timeout.
Recorded CPU times illustrate the repaired scaling:

| Attributes | Input bytes | Old 2.8.3 prototype baseline, seconds | Final d5e17b6 install check, seconds |
| --- | --- | --- | --- |
| 5,000 | 212,802 | 0.006964 | 0.002889 |
| 10,000 | 427,802 | 0.022394 | 0.005424 |
| 20,000 | 877,802 | 0.075189 | 0.011519 |
| 40,000 | 1,777,802 | 0.261624 | 0.024547 |

These are bounded corroborating measurements, not a timing pass threshold or
an end-to-end malicious JPEG/watchdog experiment. The fix conclusion rests on
the complete corrected upstream implementation, verified binary installation,
runtime linkage and legitimate-behavior checks. It does not depend on declaring
the old reachable parser harmless under the hostile-program CPU policy.

Synthetic evidence is retained in `artifacts-data/expat-remediation/`,
`artifacts-data/release-check-expat-build.log`,
`artifacts-data/release-check-expat-notices-build.log` and
`artifacts-data/release-check-expat-notices.json`. The latter identifies
`d5e17b6` and reports the full release smoke passed, including browser/CLI/HTTP,
restart/crash recovery and backup/restore. Its archive inspection covers 14
layers and 36,167 file entries, with no Sharp package paths or fully versioned
Expat library other than `1.12.4`. Its actual Playwright browser loader check
also requires the measured replacement path and hash. These observations
support this release artifact; they do not resolve the other advisory rows.

## Individual dispositions

`Not affected` below is scoped to the stated image, component and deployment
preconditions; it does not declare the Debian source package patched.
`Needs more evidence` means neither a complete exploitable path nor a complete
defeating proof was established. Parser reachability alone is not a confirmed
security-boundary violation. `Fixed in d5e17b6` refers to the exact Expat binary
and evidence above; the table preserves historical preconditions rather than
silently recasting an exposed parser as unreachable.

| CVE | Disposition | Preconditions, evidence and residual question |
| --- | --- | --- |
| **CVE-2026-66046** | **Fixed in d5e17b6** | The historical JPEG/XMP chain reaches attribute processing. ATTLIST declarations with matching nonnormalized values caused quadratic work without entity declarations; Skia's entity callback and salt did not defeat it. Complete 2.8.4 repairs the algorithm and includes the required 76641 follow-up. The old defect's impact beyond the accepted hostile-program CPU model was not demonstrated. [Upstream](https://github.com/libexpat/libexpat/pull/1321), [Debian](https://security-tracker.debian.org/tracker/CVE-2026-66046). |
| **CVE-2026-76956** | **Fixed in d5e17b6** | The replacement repairs the library's faulty `getentropy` success check. Historically, Skia's nonzero caller-supplied salt bypassed the bug; Fontconfig/Mesa lacked that API import and complete input exclusion was unproven. The fix does not rely on that exclusion. [Upstream](https://github.com/libexpat/libexpat/pull/1326), [Debian](https://security-tracker.debian.org/tracker/CVE-2026-76956). |
| **CVE-2026-76957** | **Fixed in d5e17b6** | Complete 2.8.4 repairs custom encoding callback reentry. Historical reviewed Skia source and browser/Fontconfig/Mesa imports did not register the required `XML_SetUnknownEncodingHandler`, supporting caller-specific counterevidence. The patched library additionally closes that API defect. [Upstream](https://github.com/libexpat/libexpat/pull/1322), [Debian](https://security-tracker.debian.org/tracker/CVE-2026-76957). |
| **CVE-2026-6653** | **Needs more evidence** | Installed libxml2 is vulnerable to the internal-subset parsing use-after-free. The observed system-library consumer is LLVM's Windows manifest parser, not a demonstrated generated-SVG route. No hostile-artifact-to-manifest path was found, but complete caller exclusion is unproven. Scanner CRITICAL does not itself establish code execution; the advisory describes denial of service. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-6653). |
| **CVE-2026-74860** | **Not affected in observed image** | Requires libxml2 Python SAX bindings and their attribute-declaration callback. The required Python runtime/bindings are absent; LLVM's native C use is a different surface. Recheck final component inventory. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-74860). |
| **CVE-2026-86138** | **Needs more evidence** | Requires overflowing lengths in `xmlDictAddQString`. The vulnerable package is present, but no hostile-input path to that operation through LLVM was established. The HTML-source size limit is not a sufficient defeating argument. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-86138), [fix](https://github.com/GNOME/libxml2/commit/a4cba4b5b5a8c42e155ed42d2d2a44955465a2e4). |
| **CVE-2026-86139** | **Needs more evidence** | Requires oversized input to `xmlURIEscapeStr`. No direct consumer import was found; relevant internal-library call coverage remains unresolved. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-86139), [fix](https://github.com/GNOME/libxml2/commit/8edbbdb09f24d26a2f900141fddc2b9d014f53b0). |
| **CVE-2026-86140** | **Needs more evidence** | Requires the vulnerable `xmlSnprintfElements` validation/error-formatting operation. LLVM's identified parse flags are `NOBLANKS | NODICT`; those flags alone do not prove every internal route excluded. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-86140), [fix](https://github.com/GNOME/libxml2/commit/d1686f91dbda141a752200419d35639fd6b38340). |
| **CVE-2026-86142** | **Needs more evidence; feature counterevidence** | Requires XPointer evaluation with an overflowing expression length. Observed LLVM use neither imports XPointer APIs nor requests this feature. Complete final-native-consumer coverage remains the gap. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-86142), [fix](https://github.com/GNOME/libxml2/commit/6b3a736c0edc74ceec3d82f5252499d7911b3a58). |
| **CVE-2026-86143** | **Needs more evidence** | Requires an overflowing output length reaching a write callback. LLVM imports `xmlDocDumpFormatMemoryEnc`; thus an output surface exists. No hostile-manifest or consequential oversized-output route was established. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-86143), [fix](https://github.com/GNOME/libxml2/commit/90f293ba74d28b1d570920382e707586f68ebf35). |
| **CVE-2026-86144** | **Needs more evidence; feature counterevidence** | Requires XInclude processing that loses parse flags plus a consequential resource loader. Observed LLVM use neither imports XInclude APIs nor sets that parse option; complete caller exclusion is still unproven. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-86144), [fix](https://github.com/GNOME/libxml2/commit/b63cd517afecb76582dd9488c55e54ceaf50de61). |
| **CVE-2023-5574** | **Not affected in patched image** | Requires running Xvfb with multiple protocol screens/Zaphod mode and pointer movement before reset/shutdown. Xvfb is absent in the patched image; the old scanned image contained it. [Debian](https://security-tracker.debian.org/tracker/CVE-2023-5574). |
| **CVE-2025-69720** | **Needs more evidence** | Vulnerable `infocmp` is present. The flaw is `analyze_string()` in the command-line tool, reached through `infocmp -i` with crafted terminfo; it is not a generic libtinfo application flaw. No application invocation or attacker-controlled terminfo route was established. [Debian](https://security-tracker.debian.org/tracker/CVE-2025-69720), [upstream fix note](https://invisible-island.net/ncurses/NEWS.html#index-t20251213), [option documentation](https://invisible-island.net/ncurses/man/infocmp.1m.html). |
| **CVE-2026-16742** | **Not affected in observed image** | Requires systemd-homed, a homed-managed active user and adoption of a manipulated embedded identity through the affected authentication path. The daemon is absent. `libsystemd`/`libudev` source-package matches do not supply that service. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-16742), [upstream](https://github.com/systemd/systemd/security/advisories/GHSA-jm29-p7hh-vjhv). |
| **CVE-2026-34980** | **Not affected in observed image** | Requires reachable `cupsd`, a shared PostScript queue, filter processing and scheduler interpretation of injected records. The daemon/server chain is absent; `libcups` alone does not provide it. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-34980), [upstream](https://github.com/OpenPrinting/cups/security/advisories/GHSA-4852-v58g-6cwf). |
| **CVE-2026-54369** | **Needs more evidence** | Requires a more-privileged caller of pathname-based ACL APIs operating on attacker-replaceable components. No such application route was established. Upgrading libacl alone does not repair legacy callers: safer `*_at` APIs require caller adoption. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-54369), [maintainer disclosure](https://www.openwall.com/lists/oss-security/2026/06/29/1). |
| **CVE-2026-76642** | **Not affected under examined deployment configuration** | Requires privileged mount, a user-authorized `fstab` entry, failing external helper and privileged post-hooks. The examined `fstab` is unconfigured and runtime effective capabilities are zero. Recheck final permissions and absence of other privileged libmount callers; SUID stripping does not patch libmount. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-76642), [upstream](https://github.com/util-linux/util-linux/security/advisories/GHSA-m25x-3hj9-m26f). |
| **CVE-2026-78408** | **Needs more evidence; privileged operator prerequisite unestablished** | `nsenter` is present in affected util-linux 2.41.5. Exploitation requires a root/capable operator using `--join-cgroup` against an attacker-controlled target, leaking a privileged cgroup descriptor. No such supported workflow was found. SUID stripping does not fix this advisory. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-78408), [upstream](https://github.com/util-linux/util-linux/security/advisories/GHSA-55fx-f4gg-cfhj). |
| **CVE-2026-78409** | **Not affected under examined configuration; version counterevidence** | Required authorized `X-mount.subdir` entries are absent. Upstream lists affected versions starting at 2.42 and Linux at least 6.15; installed util-linux is 2.41.5. Upstream 2.41.5 rejects restricted users in the relevant hook and lacks the described detached fast path. Debian still marks its source package vulnerable; exact Debian backport coverage was not established. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-78409), [upstream](https://github.com/util-linux/util-linux/security/advisories/GHSA-8f2p-47x3-43mv), [2.41.5 source](https://raw.githubusercontent.com/util-linux/util-linux/v2.41.5/libmount/src/hook_subdir.c). |
| **CVE-2026-78410** | **Not affected under examined configuration** | Requires privileged restricted bind mounting through user-authorized, attacker-influenced `fstab` paths; ownership escalation additionally requires `X-mount.owner/group/mode`. Those entries are absent. Recheck final SUID removal and supported deployment changes. [Debian](https://security-tracker.debian.org/tracker/CVE-2026-78410), [upstream](https://github.com/util-linux/util-linux/security/advisories/GHSA-rh77-686x-2f2m). |

For LLVM, the matching upstream source is
[WindowsManifestMerger.cpp in LLVM 19.1.7](https://github.com/llvm/llvm-project/blob/llvmorg-19.1.7/llvm/lib/WindowsManifest/WindowsManifestMerger.cpp#L597):
lines 597–599 parse a supplied Windows manifest with `NOBLANKS | NODICT`, and
line 637 serializes the merged result. This explains the inspected imports;
it does not demonstrate that a generated browser artifact calls the merger.
Fontconfig's [official configuration documentation](https://fontconfig.pages.freedesktop.org/fontconfig/fontconfig-user.html)
distinguishes local XML configuration parsing from font matching. That is
counterevidence to treating all web font use as Expat XML input, not a complete
proof about every native consumer.

## Remediation and final-image gates

Debian's retrieved tracker records list trixie Expat 2.8.3 as vulnerable and
forky/sid Expat 2.8.4 as fixed for the three reviewed Expat advisories. The local
2.8.4 package above uses the complete upstream release and includes the 76641
follow-up; it does not mix a sid binary into trixie. Its scoped fix verification
is separate from the raw scanner's distribution-advisory matching.

The final, unsuppressed `d5e17b6` scan is retained as
`artifacts-data/image-vulnerabilities-expat-notices.json` and its
`-summary.json`. It used Trivy 0.74.0, scanner image
`aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969`,
with advisory database updated `2026-09-18T01:11:25.279659641Z`; inspection ran
without network. It identifies Debian 13.7 and reports 172 OS packages with
54 HIGH, one CRITICAL, 88 MEDIUM, 108 LOW and three UNKNOWN occurrences. Its
HIGH/CRITICAL records cover 20 unique IDs. The
353 identified Node packages have no reported findings. The strict scanner
gate still fails; this is not a zero-vulnerability image.

The raw report still marks CVEs 66046, 76956 and 76957 affected against the
truthful local `2.8.4-0modellab1` package, with an empty fixed-version field in
the Debian advisory mapping. The source and runtime verification above support
the specific fix dispositions despite those retained matches. The report also
contains Expat **CVE-2025-66382** with `fix_deferred` status; that advisory is
outside this bounded three-advisory fix review and receives no disposition
here. No source-backed conclusion erases or suppresses a raw scanner record.

The final HIGH/CRITICAL set differs from the original 20-row triage table:
CVE-2023-5574 is absent, while CVE-2026-9538 is now matched to `perl-base`
`5.40.1-6+deb13u1` with `fix_deferred` status. A separate bounded review establishes
**not affected in the examined image**: the flaw is Archive::Tar's allocation from
an untrusted tar entry size, not the Perl interpreter. The exact final image has
only `perl-base`, no `perl`, `perl-modules` or `libarchive-tar-perl` package, and no
`Archive/Tar.pm`, `Archive/Tar/*` or `ptar` entrypoint under `/usr`, `/opt` or `/app`.
No application caller was found. These checks used a read-only, offline, capability-
restricted container and are recorded in the synthetic review evidence; no PoC
was needed because the vulnerable component is absent. The raw package match
remains in the report, and other native findings still block publication.
[Debian advisory](https://security-tracker.debian.org/tracker/CVE-2026-9538),
[upstream fix](https://github.com/jib/archive-tar-new/commit/f9af01426038e29d9578825a0cd3626946ab08c7).

Before publication:

1. Preserve the matching immutable image identity, scanner/database versions
   and full report above, including findings without a distro-provided fix.
   Scan any replacement publication artifact independently; do not copy these
   counts forward to a different image.
2. Preserve the verified browser/Expat identity, loader evidence, notices and
   layer checks above. Final smoke records UID 1000, no SUID/SGID under `/usr`,
   no Sharp in inspected layers and a disabled image optimizer. Reverify other
   component/configuration preconditions before transferring the historical
   not-affected dispositions to a publication image.
3. Retain the local Expat package recipe and maintenance responsibility. A
   version string alone is not an installation or remediation proof; any
   changed source, build or runtime image needs the relevant checks again.
4. For any remaining parser CPU concern, use a bounded, keyless synthetic
   harness with no external network or private mounts, explicit CPU/memory/PID
   limits and an external hard deadline. Compare a small crafted JPEG/XMP
   workload with a normalized control; record context closure, CPU settling
   and usability of an independent artifact in the same browser and a later
   fresh run. Do not scale indefinitely. These results establish only the
   tested mitigation scope, not arbitrary native-code safety.
5. Resolve remaining proof gaps or obtain an explicit, narrowly stated release
   risk decision. Do not transform an unproven input path into either a
   confirmed exploit or an unconditional not-affected claim.

No blanket ignore file, severity-based waiver, package-wide VEX dismissal or
scanner suppression is authorized by this review. Debian `no-dsa`, postponed
or minor-issue annotations describe distribution handling; they do not defeat
an application's attack path. Component absence and deployment mitigations
must remain tied to the examined artifact and their specific preconditions.
