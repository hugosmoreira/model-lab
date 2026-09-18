"""Inspect every saved Docker image layer without extracting untrusted paths."""

import gzip
import io
import re
import tarfile
from pathlib import Path


def scan_stream(stream, marker: bytes, label: str) -> int:
    """Bound memory and retain enough overlap to catch chunk-boundary matches."""
    total = 0
    tail = b""
    while chunk := stream.read(1024 * 1024):
        total += len(chunk)
        combined = tail + chunk
        if marker in combined:
            raise ValueError(f"Synthetic packaging sentinel found in {label}")
        tail = combined[-max(len(marker) - 1, 0) :]
    return total


def inspect_image_archive(archive: Path, marker: str) -> dict:
    """Check file contents and metadata, including gzip OCI blobs and old layers.

    Docker save uses an outer tar archive. Classic layer.tar entries and OCI
    uncompressed blobs are inspected directly; compressed OCI blobs are also
    decompressed. Fail closed on unsupported zstd blobs rather than claiming
    that compressed content was inspected. No image files are executed.
    """
    needle = marker.encode("utf-8")
    if len(needle) < 16:
        raise ValueError("Use a unique sentinel of at least 16 bytes")
    entries = 0
    inspected = 0
    compressed = 0
    with tarfile.open(archive, "r:") as saved:
        for member in saved:
            metadata = f"{member.name}\n{member.linkname}".encode("utf-8")
            if needle in metadata:
                raise ValueError("Synthetic packaging sentinel found in archive metadata")
            if not member.isfile():
                continue
            entries += 1
            with saved.extractfile(member) as raw:
                header = raw.read(4)
                raw.seek(0)
                if header == b"\x28\xb5\x2f\xfd":
                    raise ValueError(f"Cannot inspect zstd image blob: {member.name}")
                if header[:2] == b"\x1f\x8b":
                    with gzip.GzipFile(fileobj=raw) as uncompressed:
                        inspected += scan_stream(uncompressed, needle, member.name)
                    compressed += 1
                else:
                    inspected += scan_stream(raw, needle, member.name)
    if entries == 0 or inspected == 0:
        raise ValueError("Image archive had no inspectable contents")
    return {"entries": entries, "uncompressedBytesInspected": inspected, "gzipBlobs": compressed}


def inspect_forbidden_layer_paths(archive: Path, patterns: tuple[str, ...]) -> dict:
    """Reject forbidden package files in any layer, even if a later layer deletes them."""
    rules = [re.compile(pattern) for pattern in patterns]
    layers = 0
    entries = 0
    with tarfile.open(archive, "r:") as saved:
        for member in saved:
            if not member.isfile():
                continue
            with saved.extractfile(member) as raw:
                header = raw.read(512)
                raw.seek(0)
                is_layer = (header[:2] == b"\x1f\x8b" or header[257:262] == b"ustar"
                            or member.name.endswith("layer.tar"))
                if not is_layer:
                    continue
                with tarfile.open(fileobj=raw, mode="r|*") as layer:
                    layers += 1
                    for entry in layer:
                        entries += 1
                        if any(rule.search(entry.name.lstrip("./")) for rule in rules):
                            raise ValueError(f"Forbidden package path retained in image layer: {entry.name}")
    if layers == 0 or entries == 0:
        raise ValueError("No image layer file entries were inspected")
    return {"layers": layers, "fileEntries": entries, "forbiddenPatterns": list(patterns)}


def self_test() -> None:
    """A leaked file still fails even if a later layer removes that file."""
    import tempfile
    import unittest

    class LayerTests(unittest.TestCase):
        marker = "model-lab-test-sentinel-123456789"

        def archive(self, path, content, compressed=False):
            inner = io.BytesIO()
            with tarfile.open(fileobj=inner, mode="w") as layer:
                data = tarfile.TarInfo("app/.env")
                data.size = len(content)
                layer.addfile(data, io.BytesIO(content))
            payload = gzip.compress(inner.getvalue()) if compressed else inner.getvalue()
            with tarfile.open(path, "w") as outer:
                entry = tarfile.TarInfo("blobs/sha256/layer")
                entry.size = len(payload)
                outer.addfile(entry, io.BytesIO(payload))
                deleted = tarfile.TarInfo("later-layer/.wh..env")
                outer.addfile(deleted, io.BytesIO())

        def test_absent(self):
            with tempfile.TemporaryDirectory(prefix="model-lab-layer-test-") as directory:
                path = Path(directory) / "image.tar"
                self.archive(path, b"safe content")
                self.assertGreater(inspect_image_archive(path, self.marker)["entries"], 0)

        def test_plain_and_gzip_leaks(self):
            for compressed in (False, True):
                with self.subTest(compressed=compressed):
                    with tempfile.TemporaryDirectory(prefix="model-lab-layer-test-") as directory:
                        path = Path(directory) / "image.tar"
                        self.archive(path, self.marker.encode(), compressed)
                        with self.assertRaisesRegex(ValueError, "sentinel found"):
                            inspect_image_archive(path, self.marker)

        def test_chunk_boundary(self):
            value = b"x" * (1024 * 1024 - 5) + self.marker.encode()
            with self.assertRaisesRegex(ValueError, "sentinel found"):
                scan_stream(io.BytesIO(value), self.marker.encode(), "boundary")

        def test_unsupported_compression_fails(self):
            with tempfile.TemporaryDirectory(prefix="model-lab-layer-test-") as directory:
                path = Path(directory) / "image.tar"
                with tarfile.open(path, "w") as outer:
                    entry = tarfile.TarInfo("blobs/sha256/layer")
                    entry.size = 4
                    outer.addfile(entry, io.BytesIO(b"\x28\xb5\x2f\xfd"))
                with self.assertRaisesRegex(ValueError, "Cannot inspect zstd"):
                    inspect_image_archive(path, self.marker)

        def test_forbidden_file_survives_layer_deletion(self):
            with tempfile.TemporaryDirectory(prefix="model-lab-layer-test-") as directory:
                path = Path(directory) / "image.tar"
                self.archive(path, b"safe content", compressed=True)
                with self.assertRaisesRegex(ValueError, "Forbidden package path"):
                    inspect_forbidden_layer_paths(path, (r"^app/\.env$",))
                self.assertGreater(inspect_forbidden_layer_paths(path, (r"^app/native/",))["fileEntries"], 0)

    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(LayerTests))
    if not result.wasSuccessful():
        raise SystemExit(1)


if __name__ == "__main__":
    self_test()
