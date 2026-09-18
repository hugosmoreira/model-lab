# Scope of the libvips source review packet

This packet covers the formerly inspected optional
`@img/sharp-libvips-linux-x64@1.3.3` bundle. It is a reproducible collection for
review, not a declaration that all corresponding source has been delivered.
If the final runtime excludes Sharp and this native bundle, these open items
apply only to a later distribution that includes them.

Included: the 28 exact upstream source archives, the complete packaging source
at `6e5971d333377743163edc3ad9e5d0b897abcbc9` (including Linux x64 Dockerfile,
CMake toolchain, Meson cross file and pkgconf wrapper), the recorded four
external patches, 87 extracted notices, full GNU texts, and hash manifests.

Remaining evidence and delivery work is specific:

1. `librsvg-2.62.91/Cargo.lock` lists **350 registry package entries** and no git
   dependencies. Its archive has **no `vendor/` files**. This count includes
   entries that may be target-specific or development-only; it is not a claim
   that all 350 entered the binary. `build/posix.sh` modifies the workspace and
   then runs `cargo update --workspace` before compilation (lines 334–341).
   Obtain the actual post-update lockfile, target/features and resolved crate
   sources/notices from the release build; the original lockfile alone cannot
   identify that resolved set. Vendor that set and verify an offline build.
2. `platforms/linux-x64/Dockerfile` uses the mutable Rocky Linux `8-ubi-init` tag,
   unversioned distro updates and Meson/Ninja installation, a moving Rust
   `nightly`, and an unversioned `cargo install cargo-c --locked`. Retain the
   actual build-image digest, package versions, Rust/cargo-c versions and build
   log before claiming reproducibility. The packaging source and its C/C++
   settings are present; actual release toolchain provenance is not.
3. The recipe statically builds dependencies, then creates the shared
   `libvips-cpp` library, strips output and filters the distributed files.
   The packet contains source/build recipes, **not** the intermediate objects
   and archives or a verified relink procedure for the exact distributed
   combined library. Establish and test the applicable LGPL recombination
   route, including needed non-library material, and document replacement of
   the shared library. Do not treat an upstream source link as a relink test.
4. The saved libultrahdr patch uses a pull-request URL; its exact collected bytes
   and SHA-256 are retained, but the original binary build's patch hash was not
   independently established. Verify that match. Other recipe edits performed
   with `sed` are preserved in the pinned script.
5. Cairo's upstream `COPYING` identifies LGPL-2.1 or MPL-1.1, while the package
   table labels it MPL-2.0. Preserve the original terms and determine the route
   actually used for distribution. Auxiliary source tools/tests carry other
   licenses; their presence here does not prove inclusion in the binary.
6. No upload or recipient-accessible source hosting has been made. If this
   binary is distributed, select and implement the source-delivery route and
   verify a recipient can retrieve the exact required source/build material.
   The ignored local packet is preparation, not delivery. Debian, browser and
   other separately bundled programs are outside this packet's scope.
