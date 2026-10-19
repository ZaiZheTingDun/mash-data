from __future__ import annotations

from .models import VersionLabel


class VersionError(RuntimeError):
    pass


def parse_version_label(label: str) -> VersionLabel:
    if not label.startswith("v"):
        raise VersionError(f"Invalid version label '{label}'. Expected format: v<number>")
    version_text = label[1:]
    if not version_text.isdigit() or (len(version_text) > 1 and version_text.startswith("0")):
        raise VersionError(f"Invalid version label '{label}'. Expected format: v<number>")
    return VersionLabel(label=label, version=int(version_text))
