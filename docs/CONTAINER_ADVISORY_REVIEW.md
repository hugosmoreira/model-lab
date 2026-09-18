# Container advisory review

Review date: 2026-09-18 UTC. This document records a bounded, source-backed review
of the 20 unique OS CVEs represented by 56 HIGH and one CRITICAL occurrences in
the supplied remediation scan. Repeated occurrences across Debian binary
packages are retained in the scanner report; this review explains each unique
advisory. It does not certify the container or replace the release gates.

**Publication is not cleared by this review.** The Expat attribute-processing
parser is reachable from generated artifacts, while its impact beyond the
documented hostile-program CPU model still needs evidence. Several other
installed-library findings have unresolved reachability questions. Work to
replace Expat with upstream version 2.8.4 is underway; no final image containing
that remediation has been verified here, and this document does not claim it is
fixed.

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

The last image was **not independently reverified by this review**. Neither a
tag nor a statement that binaries are unchanged transfers evidence to a new
immutable image automatically. The eventual Expat-remediated image will also
need its own identity and verification.

The local source checkout was based on commit
`ac8479891660ec9bdc89690c7283d82dafb0fcc6` with ongoing uncommitted release work.
That commit alone does not identify the reviewed source snapshot or image.

Inspection used temporary, read-only containers, no host mounts and
`--network none`. It read selected package metadata, executable presence,
permissions, and ELF dynamic imports/dependencies. Public Debian and upstream
advisory/source material was consulted separately. No application or exploit
probe was run for this review; no real environment file, credential, private
database or private artifact was read. A scan of system shared-library import
tables is not proof that arbitrary runtime `dlopen`/`dlsym` behavior is absent.

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
The old image demonstrably retained SUID/SGID programs. Final permission
verification is still required; source instructions alone do not prove that
the published filesystem has those permissions.

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

## Individual dispositions

`Not affected` below is scoped to the stated image, component and deployment
preconditions; it does not declare the Debian source package patched.
`Needs more evidence` means neither a complete exploitable path nor a complete
defeating proof was established. Parser reachability alone is not a confirmed
security-boundary violation.

| CVE | Disposition | Preconditions, evidence and residual question |
| --- | --- | --- |
| **CVE-2026-66046** | **Reachable parser; impact needs more evidence** | The JPEG/XMP chain above reaches Expat's vulnerable attribute-processing code. ATTLIST declarations with matching nonnormalized attribute values cause quadratic work without entity declarations, so Skia's entity callback and hash salt do not defeat this condition. Whether it exceeds the accepted hostile-program CPU model depends on measured termination and independent-run recovery. [Upstream](https://github.com/libexpat/libexpat/pull/1321), [Debian](https://security-tracker.debian.org/tracker/CVE-2026-66046). |
| **CVE-2026-76956** | **Not affected through reviewed Skia caller; other consumers need more evidence** | Skia supplies a nonzero salt instead of using Expat's faulty `getentropy` path. Fontconfig/Mesa do not import the salt-setting API. Their XML inputs appear to be local configuration, but a complete exclusion of less-trusted input was not established for all consumers. [Upstream](https://github.com/libexpat/libexpat/pull/1326), [Debian](https://security-tracker.debian.org/tracker/CVE-2026-76956). |
| **CVE-2026-76957** | **Not affected in reviewed native consumers** | The flaw requires application-supplied custom encoding conversion/release callbacks reentering the same parser. Exact Skia source registers none; actual browser, Fontconfig and Mesa import tables lack `XML_SetUnknownEncodingHandler`. This conclusion covers the reviewed consumers, not arbitrary added native extensions. [Upstream](https://github.com/libexpat/libexpat/pull/1322), [Debian](https://security-tracker.debian.org/tracker/CVE-2026-76957). |
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
forky/sid Expat 2.8.4 as fixed for the three reviewed Expat advisories. This is
advisory evidence, not proof that a supported trixie update is available or that
mixing distribution packages is safe. The Expat 2.8.4 replacement is a separate
work item in progress. Its provenance, compatibility, installation and final
scan results must be recorded before changing dispositions to fixed. The
66046 tracker also identifies a required follow-up fix to avoid CVE-2026-76641;
an incomplete cherry-pick is not equivalent to the complete 2.8.4 release.

Before publication:

1. Record the final immutable image ID/digest and scan that same artifact.
   Preserve scanner/database versions and the full report, including findings
   without a distro-provided fix. Do not copy the old occurrence count forward
   as a final-image result.
2. Reverify exact browser and XML-library versions, active native imports,
   removed components, UID/capabilities, `fstab`, SUID/SGID permissions, Sharp
   absence in every layer and image-optimizer configuration.
3. Verify the Expat replacement's provenance and browser/native compatibility.
   A version string alone is not an installation or remediation proof.
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
