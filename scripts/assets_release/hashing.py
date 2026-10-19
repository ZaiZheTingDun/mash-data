from __future__ import annotations

import hashlib
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_sha256_file(zip_path: Path, sha256: str) -> Path:
    sha256_path = zip_path.with_suffix(zip_path.suffix + ".sha256")
    sha256_path.write_text(sha256, encoding="utf-8")
    return sha256_path


def ensure_zip_sha256(zip_path: Path) -> str:
    sha256 = sha256_file(zip_path)
    write_sha256_file(zip_path, sha256)
    return sha256
