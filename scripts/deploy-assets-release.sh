#!/usr/bin/env bash
set -euo pipefail

AWS_PROFILE="${AWS_PROFILE-mash}"
# AWS CLI treats an exported empty value as a profile name, not as "no profile".
if [[ -z "$AWS_PROFILE" ]]; then
  unset AWS_PROFILE
fi
R2_PREFIX="${R2_PREFIX:-mash}"
ASSETS_PREFIX="${ASSETS_PREFIX:-assets}"
CACHE_CONTROL="${CACHE_CONTROL:-public, max-age=300}"

usage() {
  cat <<'EOF'
Usage:
  MASH_DATA_ROOT=... R2_ENDPOINT=... R2_BUCKET=... scripts/deploy-assets-release.sh

Uploads dist/assets-release/ to Cloudflare R2, preserving the directory
structure below dist/assets-release.

Optional environment:
  AWS_PROFILE     AWS CLI profile to use (default: mash; set to empty to use AWS env credentials)
  R2_PREFIX       Object key prefix (default: mash)
  ASSETS_PREFIX   Assets key prefix below R2_PREFIX (default: assets)
  SOURCE_DIR      Source directory (default: $MASH_DATA_ROOT/dist/assets-release)
  CACHE_CONTROL   Cache-Control metadata (default: public, max-age=300)
EOF
}

fail() {
  echo "error: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

aws_args() {
  if [[ -n "${AWS_PROFILE:-}" ]]; then
    printf '%s\n' --profile "$AWS_PROFILE" --endpoint-url "$R2_ENDPOINT"
  else
    printf '%s\n' --endpoint-url "$R2_ENDPOINT"
  fi
}

aws_s3_sync() {
  local args=()
  while IFS= read -r arg; do
    args+=("$arg")
  done < <(aws_args)
  aws s3 sync "$@" "${args[@]}"
}

aws_s3api_head_object() {
  local args=()
  while IFS= read -r arg; do
    args+=("$arg")
  done < <(aws_args)
  aws s3api head-object "$@" "${args[@]}" >/dev/null
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ $# -eq 0 ]] || fail "expected no arguments"
[[ -n "${R2_ENDPOINT:-}" ]] || fail "R2_ENDPOINT is required"
[[ -n "${R2_BUCKET:-}" ]] || fail "R2_BUCKET is required"

require_cmd aws

data_root="${MASH_DATA_ROOT:-}"
[[ -n "${data_root//[[:space:]]/}" ]] || fail "MASH_DATA_ROOT is required"
source_dir="${SOURCE_DIR:-$data_root/dist/assets-release}"

if [[ ! -d "$source_dir" ]]; then
  fail "missing assets release directory: $source_dir; run the assets release build before deploying"
fi

[[ -f "$source_dir/latest.json" ]] || fail "missing release entrypoint: $source_dir/latest.json"

R2_PREFIX="${R2_PREFIX#/}"
R2_PREFIX="${R2_PREFIX%/}"
ASSETS_PREFIX="${ASSETS_PREFIX#/}"
ASSETS_PREFIX="${ASSETS_PREFIX%/}"

if [[ -n "$R2_PREFIX" && -n "$ASSETS_PREFIX" ]]; then
  object_prefix="$R2_PREFIX/$ASSETS_PREFIX"
elif [[ -n "$R2_PREFIX" ]]; then
  object_prefix="$R2_PREFIX"
else
  object_prefix="$ASSETS_PREFIX"
fi

echo "Uploading assets release"
echo "  source: $source_dir/"
echo "  target: s3://$R2_BUCKET/$object_prefix/"

aws_s3_sync "$source_dir/" "s3://$R2_BUCKET/$object_prefix/" \
  --exclude ".DS_Store" \
  --exclude "*/.DS_Store" \
  --cache-control "$CACHE_CONTROL"

echo "Validating R2 object"
aws_s3api_head_object --bucket "$R2_BUCKET" --key "$object_prefix/latest.json"

echo "Deployed assets release:"
echo "  s3://$R2_BUCKET/$object_prefix/"
