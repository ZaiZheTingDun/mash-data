from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class BasePackSpec:
    name: str
    output_name: str
    roots: tuple[Path, ...]
    extensions: tuple[str, ...]


@dataclass(frozen=True)
class FileEntry:
    path: str
    size: int
    sha256: str


@dataclass(frozen=True)
class ZipResult:
    name: str
    path: Path
    sha256: str
    size: int
    file_count: int


@dataclass(frozen=True)
class VersionLabel:
    label: str
    version: int


@dataclass(frozen=True)
class PatchResult:
    from_version: int
    to_version: int
    path: Path
    sha256: str
    size: int
    added: int
    modified: int
    deleted: int
