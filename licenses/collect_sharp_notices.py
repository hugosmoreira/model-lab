"""Fetch pinned libvips source archives and retain their unmodified notice files.

Run from the repository with Python 3.10+: python licenses/collect_sharp_notices.py
Archives stay in ignored artifacts-data/release-source-material; only notices and
their provenance manifest enter licenses/. This does not certify a complete
corresponding-source distribution (see THIRD_PARTY_NOTICES.md).
"""

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import re
import tarfile
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "licenses" / "sharp-libvips-1.3.3"
CACHE = ROOT / "artifacts-data" / "release-source-material" / "sharp-libvips-1.3.3"
COMMIT = "6e5971d333377743163edc3ad9e5d0b897abcbc9"
MAX_BYTES = 96 * 1024 * 1024

# Exact versions and source URLs from this commit's versions.properties and
# build/posix.sh; URLs are data, never evaluated as shell commands.
SOURCES = [
    ("aom", "3.15.0", "https://storage.googleapis.com/aom-releases/libaom-3.15.0.tar.gz"),
    ("archive", "3.8.9", "https://github.com/libarchive/libarchive/releases/download/v3.8.9/libarchive-3.8.9.tar.xz"),
    ("cairo", "1.18.4", "https://cairographics.org/releases/cairo-1.18.4.tar.xz"),
    ("cgif", "0.5.3", "https://github.com/dloebl/cgif/archive/v0.5.3.tar.gz"),
    ("exif", "0.6.26", "https://github.com/libexif/libexif/releases/download/v0.6.26/libexif-0.6.26.tar.xz"),
    ("expat", "2.8.3", "https://github.com/libexpat/libexpat/releases/download/R_2_8_3/expat-2.8.3.tar.xz"),
    ("ffi", "3.8.0", "https://github.com/libffi/libffi/releases/download/v3.8.0/libffi-3.8.0.tar.gz"),
    ("fontconfig", "2.18.3", "https://gitlab.freedesktop.org/fontconfig/fontconfig/-/archive/2.18.3/fontconfig-2.18.3.tar.gz"),
    ("freetype", "2.14.3", "https://github.com/freetype/freetype/archive/VER-2-14-3.tar.gz"),
    ("fribidi", "1.0.16", "https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz"),
    ("glib", "2.89.4", "https://download.gnome.org/sources/glib/2.89/glib-2.89.4.tar.xz"),
    ("harfbuzz", "14.3.1", "https://github.com/harfbuzz/harfbuzz/archive/14.3.1.tar.gz"),
    ("heif", "1.23.2", "https://github.com/strukturag/libheif/releases/download/v1.23.2/libheif-1.23.2.tar.gz"),
    ("highway", "1.4.0", "https://github.com/google/highway/archive/1.4.0.tar.gz"),
    ("imagequant", "2.4.1", "https://github.com/lovell/libimagequant/archive/v2.4.1.tar.gz"),
    ("lcms", "2.19.1", "https://github.com/mm2/Little-CMS/releases/download/lcms2.19.1/lcms2-2.19.1.tar.gz"),
    ("mozjpeg", "0826579", "https://github.com/mozilla/mozjpeg/archive/0826579.tar.gz"),
    ("pango", "1.58.2", "https://download.gnome.org/sources/pango/1.58/pango-1.58.2.tar.xz"),
    ("pixman", "0.46.4", "https://cairographics.org/releases/pixman-0.46.4.tar.gz"),
    ("png", "1.6.58", "https://github.com/pnggroup/libpng/archive/v1.6.58.tar.gz"),
    ("proxy-libintl", "0.5", "https://github.com/frida/proxy-libintl/archive/0.5.tar.gz"),
    ("rsvg", "2.62.91", "https://download.gnome.org/sources/librsvg/2.62/librsvg-2.62.91.tar.xz"),
    ("tiff", "4.7.2", "https://gitlab.com/libtiff/libtiff/-/archive/v4.7.2/libtiff-v4.7.2.tar.gz"),
    ("uhdr", "2.0.2", "https://github.com/google/libultrahdr/archive/v2.0.2.tar.gz"),
    ("vips", "8.18.6", "https://github.com/libvips/libvips/releases/download/v8.18.6/vips-8.18.6.tar.xz"),
    ("webp", "1.6.0", "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz"),
    ("xml2", "2.15.3", "https://download.gnome.org/sources/libxml2/2.15/libxml2-2.15.3.tar.xz"),
    ("zlib-ng", "2.3.3", "https://github.com/zlib-ng/zlib-ng/archive/2.3.3.tar.gz"),
]


def download(url, target):
    if not target.exists():
        req = Request(url, headers={"User-Agent": "Model-Lab-release-notice-review"})
        with urlopen(req, timeout=40) as response:
            content = response.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise ValueError("Source exceeds bounded download size")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    content = target.read_bytes()
    return {"url": url, "sha256": sha256(content).hexdigest(), "bytes": len(content)}


def collect_source(item):
    name, version, url = item
    archive = CACHE / (name + ".tar")
    result = {"component": name, "version": version, "notices": []}
    try:
        result.update(download(url, archive))
        result["cachedArchive"] = archive.relative_to(ROOT).as_posix()
        with tarfile.open(archive) as tar:
            for member in tar:
                if not member.isfile() or member.size > 2 * 1024 * 1024:
                    continue
                basename = member.name.rsplit("/", 1)[-1]
                if not re.match(r"^(licen[sc]e|copying|copyright|notice|authors|ftl)([.-]|$)", basename, re.I):
                    continue
                handle = tar.extractfile(member)
                if handle is None:
                    continue
                content = handle.read()
                # Flatten archive names; no archive paths are ever extracted.
                stem = re.sub(r"[^a-zA-Z0-9._-]", "_", member.name)
                destination = OUT / "components" / name / (stem + ".txt")
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
                result["notices"].append({"archivePath": member.name, "file": destination.relative_to(OUT).as_posix(), "sha256": sha256(content).hexdigest()})
        result["status"] = "collected" if result["notices"] else "no-matching-notice-files"
    except Exception as error:
        result["status"] = "needs-review"
        result["error"] = str(error)
    print(name + ": " + result["status"], flush=True)
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    packaging_archive = CACHE / "packaging-source.tar.gz"
    packaging = download(f"https://codeload.github.com/lovell/sharp-libvips/tar.gz/{COMMIT}", packaging_archive)
    packaging["cachedArchive"] = packaging_archive.relative_to(ROOT).as_posix()
    (OUT / "packaging-source-manifest.json").write_text(json.dumps(packaging, indent=2) + "\n", encoding="utf-8")
    pinned = []
    for upstream, local in [("LICENSE", "PACKAGING-LICENSE.txt"), ("THIRD-PARTY-NOTICES.md", "UPSTREAM-THIRD-PARTY-NOTICES.txt"), ("versions.properties", "versions.properties.txt"), ("build/posix.sh", "build-posix.sh.txt")]:
        url = f"https://raw.githubusercontent.com/lovell/sharp-libvips/{COMMIT}/{upstream}"
        pinned.append({"file": local, **download(url, OUT / local)})
    supplemental = []
    for local, url in [
        ("GPL-3.0.txt", "https://www.gnu.org/licenses/gpl-3.0.txt"),
        ("LGPL-3.0.txt", "https://www.gnu.org/licenses/lgpl-3.0.txt"),
        ("glib-without-gregex.patch.txt", "https://gist.github.com/kleisauke/284d685efa00908da99ea6afbaaf39ae/raw/bdad5489a61c217850631571caf57f5db6ea8b2c/glib-without-gregex.patch"),
        ("mozjpeg-overflow.patch.txt", "https://github.com/mozilla/mozjpeg/commit/f90668e0e4fb79c81e1f24a0ccc0e2090af761bf.patch"),
        ("libultrahdr-platform.patch.txt", "https://patch-diff.githubusercontent.com/raw/google/libultrahdr/pull/383.patch"),
        ("libvips-soname.patch.txt", "https://gist.githubusercontent.com/lovell/313a6901e9db1bf285f2a1f1180499e4/raw/3988223c7dfa4d22745d9392034b0117abef1446/libvips-cpp-soversion.patch"),
    ]:
        supplemental.append({"file": local, **download(url, OUT / local)})
    (OUT / "supplemental-manifest.json").write_text(json.dumps(supplemental, indent=2) + "\n", encoding="utf-8")
    with ThreadPoolExecutor(max_workers=4) as pool:
        sources = list(pool.map(collect_source, SOURCES))
    manifest = {
        "package": "@img/sharp-libvips-linux-x64@1.3.3",
        "upstreamCommit": COMMIT,
        "versionEvidence": "npm gitHead and GitHub v1.3.3 release; all 28 versions match the inspected Linux package versions.json",
        "sourceCompleteness": "Upstream archives, build recipe, external patches and notices retained. Rust dependency closure, toolchains, relinking material and recipient delivery still require review.",
        "pinnedPackagingFiles": pinned,
        "components": sources,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"collected": sum(s["status"] == "collected" for s in sources), "total": len(sources)}))


if __name__ == "__main__":
    main()
