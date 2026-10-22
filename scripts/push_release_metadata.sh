#!/usr/bin/env bash
# Run inside the private checkout after sync_release_manifest.py has staged metadata.
set -euo pipefail

: "${RELEASE_VERSION:?RELEASE_VERSION is required}"
: "${PRIVATE_DATA_BRANCH:?PRIVATE_DATA_BRANCH is required}"
[[ "$RELEASE_VERSION" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid release version' >&2; exit 1; }
git check-ref-format "refs/heads/${PRIVATE_DATA_BRANCH}"

tag="v${RELEASE_VERSION}"
message="chore(data): sync published release ${tag}"
if ! git diff --cached --quiet; then
  git -c core.hooksPath=/dev/null commit --quiet -m "$message"
fi

# On retry the branch may have advanced beyond the existing sync commit.
commit=$(git log -1 --format=%H --grep="^${message}$" HEAD)
if [[ -z "$commit" && "$(git rev-parse --is-shallow-repository)" == 'true' ]]; then
  git -c core.hooksPath=/dev/null fetch --no-tags --filter=blob:none --unshallow origin "$PRIVATE_DATA_BRANCH"
  commit=$(git log -1 --format=%H --grep="^${message}$" HEAD)
fi
if [[ -z "$commit" ]]; then
  echo "Cannot find private sync commit for ${tag}" >&2
  exit 1
fi
for path in assets/manifest.json assets/version.json; do
  if [[ "$(git rev-parse "${commit}:${path}")" != "$(git rev-parse "HEAD:${path}")" ]]; then
    echo "Sync commit for ${tag} does not match verified release metadata" >&2
    exit 1
  fi
done

if git show-ref --verify --quiet "refs/tags/${tag}"; then
  if [[ "$(git rev-parse "refs/tags/${tag}^{commit}")" != "$commit" ]]; then
    echo "Tag ${tag} already points to a different commit" >&2
    exit 1
  fi
else
  git -c core.hooksPath=/dev/null tag "$tag" "$commit"
fi

# Publish both refs together; a conflicting tag or advanced branch updates neither.
git -c core.hooksPath=/dev/null push --atomic origin "HEAD:refs/heads/${PRIVATE_DATA_BRANCH}" "refs/tags/${tag}"
