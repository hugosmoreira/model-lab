"""Create the deterministic, offline libvips review packet from verified inputs.

Run after collect_sharp_notices.py. Output stays under ignored artifacts-data.
This packages review material only; SOURCE_REVIEW_GAPS.md states its limits.
"""

import gzip
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
NOTICES = ROOT / "licenses" / "sharp-libvips-1.3.3"
OUTPUT = ROOT / "artifacts-data" / "release-source-material"
NAME = "sharp-libvips-1.3.3-source-review"


def digest(path):
    result = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def verified_archive(entry):
    path = (ROOT / entry["cachedArchive"]).resolve()
    if not path.is_relative_to(OUTPUT.resolve()):
        raise ValueError("Archive path escapes the source cache")
    if digest(path) != entry["sha256"]:
        raise ValueError("Source hash mismatch: " + path.name)
    return path


def main():
    manifest = json.loads((NOTICES / "manifest.json").read_text(encoding="utf-8"))
    files = {}
    for entry in manifest["components"]:
        path = verified_archive(entry)
        files["sources/" + path.name] = path
    packaging = json.loads((NOTICES / "packaging-source-manifest.json").read_text(encoding="utf-8"))
    path = verified_archive(packaging)
    files["sources/" + path.name] = path
    for path in sorted(NOTICES.rglob("*")):
        if path.is_file():
            files["notices/" + path.relative_to(NOTICES).as_posix()] = path
    for filename in ("collect_sharp_notices.py", "build_source_review_packet.py"):
        files["collection/" + filename] = ROOT / "licenses" / filename
    rows = [{"path": name, "bytes": path.stat().st_size, "sha256": digest(path)} for name, path in sorted(files.items())]
    index = ("".join(row["sha256"] + "  " + row["path"] + "\n" for row in rows)).encode()
    target = OUTPUT / (NAME + ".tar.gz")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    # Normalise every metadata field and the gzip header; no filesystem times,
    # user names or absolute paths enter the packet.
    with target.open("wb") as raw:
        with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0, compresslevel=1) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
                for name in sorted([*files, "SHA256SUMS"]):
                    data = index if name == "SHA256SUMS" else files[name].read_bytes()
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    info.mtime = 0
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.mode = 0o644
                    archive.addfile(info, BytesIO(data))
    archive_hash = digest(target)
    (OUTPUT / (NAME + ".SHA256SUMS")).write_text(archive_hash + "  " + target.name + "\n", encoding="utf-8", newline="\n")
    (OUTPUT / (NAME + ".files.SHA256SUMS")).write_bytes(index)
    report = {"archive": target.name, "sha256": archive_hash, "bytes": target.stat().st_size,
              "componentArchives": len(manifest["components"]), "packagingArchives": 1,
              "files": rows, "completeCorrespondingSource": False,
              "scopeAndGaps": "notices/SOURCE_REVIEW_GAPS.md", "uploaded": False}
    (OUTPUT / (NAME + ".json")).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({key: value for key, value in report.items() if key != "files"}, indent=2))


if __name__ == "__main__":
    main()
