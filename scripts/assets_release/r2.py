from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

from .hashing import sha256_file


def aws_environment() -> dict[str, str]:
    environment = os.environ.copy()
    # Empty means environment credentials in our scripts, but AWS CLI treats it
    # as a literal profile name even when --profile is omitted.
    if environment.get("AWS_PROFILE") == "":
        environment.pop("AWS_PROFILE")
    return environment


def safe_path(value: str) -> str:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or ".." in path.parts or "\\" in value or str(path) != value:
        raise ValueError(f"invalid relative release path: {value!r}")
    return value


def verify_file(path: Path, entry: dict) -> None:
    size, digest = entry.get("size"), entry.get("sha256")
    if (type(size) is not int or size < 0 or not isinstance(digest, str)
            or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest)):
        raise ValueError(f"invalid integrity metadata for {path.name}")
    if not path.is_file() or path.stat().st_size != size or sha256_file(path) != digest:
        raise ValueError(f"size/SHA-256 mismatch: {path.name}")


class R2Store:
    def __init__(self) -> None:
        self.bucket = os.environ["R2_BUCKET"]
        self.endpoint = os.environ["R2_ENDPOINT"]
        self.prefix = "/".join(part.strip("/") for part in (
            os.environ.get("R2_PREFIX", "mash"), os.environ.get("ASSETS_PREFIX", "assets")
        ) if part.strip("/"))
        self.profile = os.environ.get("AWS_PROFILE", "mash")

    def call(self, operation: str, key: str, *args: str, missing_ok: bool = False) -> dict | None:
        object_key = "/".join(filter(None, [self.prefix, safe_path(key)]))
        command = ["aws", "--endpoint-url", self.endpoint]
        if self.profile:
            command += ["--profile", self.profile]
        command += ["s3api", operation, "--bucket", self.bucket, "--key", object_key, *args, "--output", "json"]
        result = subprocess.run(command, capture_output=True, text=True, check=False, env=aws_environment())
        if result.returncode:
            if missing_ok and ("(NoSuchKey)" in result.stderr or "(404)" in result.stderr):
                return None
            raise RuntimeError(f"R2 {operation} failed for {key}: {result.stderr.strip()}")
        return json.loads(result.stdout)

    def read_json(self, key: str, *, missing_ok: bool = False) -> tuple[dict | None, str | None]:
        with tempfile.TemporaryDirectory(prefix="mash-r2-") as temp:
            target = Path(temp) / "object"
            metadata = self.call("get-object", key, str(target), missing_ok=missing_ok)
            if metadata is None:
                return None, None
            payload = json.loads(target.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                raise ValueError(f"{key} must contain a JSON object")
            return payload, metadata["ETag"]

    def verify(self, key: str, entry: dict) -> None:
        # Read from the authenticated S3 endpoint, never a potentially stale CDN.
        with tempfile.TemporaryDirectory(prefix="mash-r2-") as temp:
            target = Path(temp) / "object"
            self.call("get-object", key, str(target))
            verify_file(target, entry)

    def put(self, key: str, source: Path, *, etag: str | None = None) -> None:
        condition = ["--if-match", etag] if etag else ["--if-none-match", "*"]
        cache = "public, max-age=60, must-revalidate" if key == "latest.json" else "public, max-age=31536000, immutable"
        content_type = "application/json" if source.suffix == ".json" else "application/zip" if source.suffix == ".zip" else "text/plain"
        self.call("put-object", key, "--body", str(source), "--cache-control", cache,
                  "--content-type", content_type, *condition)

    def put_immutable(self, key: str, source: Path, entry: dict) -> None:
        if self.call("head-object", key, missing_ok=True) is None:
            self.put(key, source)
        # Existing objects may be reused only when their actual bytes match.
        self.verify(key, entry)
