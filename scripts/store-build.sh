#!/usr/bin/env bash
#
# Builds the Microsoft Store package (MSIX) of a pushed release by dispatching the "Microsoft Store build"
# workflow (.github/workflows/store-build.yml) for its tag. Called by deploy.sh after a release, and runnable on
# its own (`npm run store`), for example to build an older tag or to retry:
#
#   ./scripts/store-build.sh [--dry-run] [--tag vX.Y.Z]
#
# Without --tag it takes the highest vX.Y.Z tag on GitHub (not the local tags, which may be behind).
#
# This only BUILDS: the workflow is dispatched with submit=false, so the package becomes an artifact of the run
# and nothing is uploaded to Partner Center. Submitting is a separate, deliberate step because it goes to
# certification, cannot be taken back, and cannot replace a submission that is still in certification:
#
#   gh workflow run store-build.yml --repo alun-hub/sshs3 --ref master -f tag=vX.Y.Z -f submit=true
#
# It is run from master because the "store" environment, which holds the Partner Center credentials, allows only
# that branch; the tag input makes the workflow build the released code.
#
# (Check first that the previous submission is published. The "What's new" text of a submission is the CHANGELOG
# entry of that version, so make sure that entry reads well for users.)
#
# --dry-run only checks the prerequisites and prints what would happen.
#
# Environment: SSHS3_GH_REPO (default alun-hub/sshs3); SSHS3_STORE_POLL_SECONDS (default 5): the wait between
#              looks for the run it started.

set -euo pipefail

GH_REPO="${SSHS3_GH_REPO:-alun-hub/sshs3}"
WORKFLOW="store-build.yml"
POLL_SECONDS="${SSHS3_STORE_POLL_SECONDS:-5}"
DRY_RUN=false
TAG=""

YELLOW="\033[0;33m"; GREEN="\033[0;32m"; CYAN="\033[0;36m"; RED="\033[0;31m"; RESET="\033[0m"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --tag)
      [[ $# -ge 2 ]] || { echo -e "${RED}--tag needs a value.${RESET}" >&2; exit 2; }
      TAG="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo -e "${RED}Unknown option: $1${RESET}" >&2; exit 2 ;;
  esac
done

fail() { echo -e "${RED}store: $*${RESET}" >&2; exit 1; }
info() { echo -e "${CYAN}store: $*${RESET}"; }

# 1. Prerequisites.
command -v gh >/dev/null 2>&1 || fail "'gh' is not installed."
gh auth status >/dev/null 2>&1 || fail "the gh CLI is not logged in (gh auth login)."
gh workflow view "$WORKFLOW" --repo "$GH_REPO" >/dev/null 2>&1 \
  || fail "cannot find the workflow ${WORKFLOW} in ${GH_REPO} (check SSHS3_GH_REPO and gh access)."

# 2. The tag: default to the highest vX.Y.Z on GitHub, and never pass anything else on to the workflow.
if [[ -z "$TAG" ]]; then
  refs="$(gh api --paginate "repos/${GH_REPO}/git/matching-refs/tags/v" --jq '.[].ref')" \
    || fail "cannot list the tags of ${GH_REPO} (pass --tag vX.Y.Z)."
  TAG="$(sed 's#^refs/tags/##' <<<"$refs" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n1 || true)"
  [[ -n "$TAG" ]] || fail "${GH_REPO} has no release tag of the form vX.Y.Z (pass --tag)."
fi
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'${TAG}' is not a release tag of the form vX.Y.Z."

if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "${YELLOW}[DRY RUN] Would, for ${TAG}:${RESET}"
  echo "  1. gh workflow run ${WORKFLOW} --ref ${TAG} -f submit=false   (build only; nothing is uploaded to Partner Center)"
  echo -e "${GREEN}✓ Dry run complete. Prerequisites are in place; nothing was started.${RESET}"
  exit 0
fi

# 3. The tag has to be on GitHub: the workflow builds from it.
gh api "repos/${GH_REPO}/git/ref/tags/${TAG}" >/dev/null 2>&1 \
  || fail "the tag ${TAG} is not on ${GH_REPO} (push it first)."

# 4. Dispatch the build. submit is written out so that the default of the workflow can never turn this into a submission.
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
info "building the Store package for ${TAG} (build only, no submission)..."
gh workflow run "$WORKFLOW" --repo "$GH_REPO" --ref "$TAG" -f submit=false >/dev/null \
  || fail "could not start ${WORKFLOW} for ${TAG}."

# 5. Find the run it created (dispatching returns no id). Not finding it is not an error: the build is running.
run_url=""
for _ in 1 2 3 4 5 6; do
  sleep "$POLL_SECONDS"
  run_url="$(gh run list --repo "$GH_REPO" --workflow "$WORKFLOW" --branch "$TAG" --event workflow_dispatch --limit 5 \
    --json url,createdAt --jq "map(select(.createdAt >= \"${started}\")) | .[0].url // empty" 2>/dev/null || true)"
  [[ -n "$run_url" ]] && break
done

if [[ -n "$run_url" ]]; then
  echo -e "${GREEN}✓ Store build started: ${run_url}${RESET}"
else
  echo -e "${GREEN}✓ Store build started: https://github.com/${GH_REPO}/actions/workflows/${WORKFLOW}${RESET}"
fi
echo "  Not submitted. To submit it once the previous submission is published:"
echo "    gh workflow run ${WORKFLOW} --repo ${GH_REPO} --ref master -f tag=${TAG} -f submit=true"
