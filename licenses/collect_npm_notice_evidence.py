"""Retain exact published attribution for packages with missing root notices.

Reads public npm metadata/tarballs only; verifies npm SHA-512 integrity before
reading tar members. It never extracts or executes package code.
"""

from base64 import b64encode
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256, sha512
from io import BytesIO
import json
from pathlib import Path
import tarfile
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "licenses" / "npm" / "published"
CACHE = ROOT / "artifacts-data" / "release-source-material" / "npm"
PACKAGES = [
    ("@humanfs/types", "0.15.0"),
    ("@types/json5", "0.0.29"),
    ("client-only", "0.0.1"),
    ("keyv", "4.5.4"),
    ("language-subtag-registry", "0.3.23"),
    ("language-tags", "1.0.9"),
    ("natural-compare", "1.4.0"),
    ("stable-hash", "0.0.5"),
]


def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": "Model-Lab-notice-review"}), timeout=35) as response:
        data = response.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise ValueError("Public package exceeds bounded download limit")
    return data


def collect(item):
    name, version = item
    stem = name.replace("@", "").replace("/", "-") + "-" + version
    url = "https://registry.npmjs.org/" + quote(name, safe="") + "/" + version
    meta = json.loads(fetch(url))
    target = CACHE / (stem + ".tgz")
    blob = target.read_bytes() if target.exists() else fetch(meta["dist"]["tarball"])
    integrity = "sha512-" + b64encode(sha512(blob).digest()).decode()
    if integrity != meta["dist"]["integrity"]:
        raise ValueError("Published integrity mismatch: " + name)
    target.write_bytes(blob)
    destination = OUT / stem
    destination.mkdir(parents=True, exist_ok=True)
    evidence = {
        "package": name, "version": version, "metadataUrl": url,
        "tarballUrl": meta["dist"]["tarball"], "integrity": integrity,
        "tarballSha256": sha256(blob).hexdigest(),
        "gitHead": meta.get("gitHead"), "repository": meta.get("repository"),
        "license": meta.get("license"), "author": meta.get("author"),
        "contributors": meta.get("contributors"), "members": [], "retained": [],
    }
    with tarfile.open(fileobj=BytesIO(blob)) as archive:
        for member in archive:
            if not member.isfile():
                continue
            evidence["members"].append(member.name)
            basename = member.name.rsplit("/", 1)[-1]
            if basename.lower() == "package.json" or basename.lower().startswith(("readme", "license", "copying", "notice")):
                content = archive.extractfile(member).read()
                file = destination / (basename + ".txt")
                file.write_bytes(content)
                evidence["retained"].append({"member": member.name, "file": file.relative_to(OUT.parent).as_posix(), "sha256": sha256(content).hexdigest(), "bytes": len(content)})
            if (name == "@humanfs/types" and basename == "hfs-types.ts") or (name == "@types/json5" and basename == "index.d.ts"):
                content = archive.extractfile(member).read()
                if name == "@humanfs/types":
                    content = content[:content.index(b"*/") + 2] + b"\n"
                file = destination / "SOURCE-ATTRIBUTION.txt"
                file.write_bytes(content)
                evidence["retained"].append({"member": member.name, "file": file.relative_to(OUT.parent).as_posix(), "sha256": sha256(content).hexdigest(), "bytes": len(content), "scope": "initial author comment" if name == "@humanfs/types" else "complete published declaration"})
    return evidence


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        evidence = list(pool.map(collect, PACKAGES))
    (OUT.parent / "published-package-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps([{"package": x["package"], "version": x["version"], "members": x["members"]} for x in evidence], indent=2))
