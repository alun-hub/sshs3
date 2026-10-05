#!/usr/bin/env bash
#
# Publishes the sshs3-site (sshs3.com landing page + docs.sshs3.com documentation, a Cloudflare Worker
# with static assets) from a checkout next to this repo. Called by deploy.sh after a release, and
# runnable on its own to refresh the site without a release:
#
#   ./scripts/deploy-site.sh [--dry-run] [--tag vX.Y.Z]
#
# What it does, in order (any failure stops here and nothing is deployed):
#   1. Refuse if the site checkout has uncommitted work outside the generated paths (docs content,
#      templates and scripts are authored by hand and must be committed first).
#   2. Sync screenshots from docs/screenshots into the site (scripts/sync-docs.mjs).
#   3. Rebuild the docs (`npm run build:docs` in the site: extracts the IPC channels and keyboard
#      shortcuts from THIS checkout's source, then renders content/docs/*.md through the templates).
#   4. Validate the generated pages (`npm run validate:links`).
#   5. Commit the generated paths, push the site repo, and `wrangler deploy`.
#
# The English docs in sshs3-site/content/docs are NOT generated from docs/user-guide (Swedish); they are
# maintained by hand there. Only screenshots, shortcuts and IPC channels flow in automatically.
#
# Environment: SSHS3_SITE_DIR overrides the site checkout (default: ../sshs3-site).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_DIR="${SSHS3_SITE_DIR:-$REPO_ROOT/../sshs3-site}"
DRY_RUN=false
TAG=""

# Paths the build/sync may change and that this script commits. Everything else in the site
# repo must already be committed.
GENERATED_PATHS=(public/img public/docs content/_generated_metadata.json)

YELLOW="\033[0;33m"; GREEN="\033[0;32m"; CYAN="\033[0;36m"; RED="\033[0;31m"; RESET="\033[0m"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo -e "${RED}Unknown option: $1${RESET}" >&2; exit 2 ;;
  esac
done

fail() { echo -e "${RED}sshs3-site: $*${RESET}" >&2; exit 1; }

[[ -d "$SITE_DIR/.git" ]] || fail "no git checkout at ${SITE_DIR} (set SSHS3_SITE_DIR)."
SITE_DIR="$(cd "$SITE_DIR" && pwd)"
[[ -f "$SITE_DIR/package.json" && -f "$SITE_DIR/wrangler.jsonc" ]] || fail "${SITE_DIR} doesn't look like sshs3-site (package.json/wrangler.jsonc missing)."

cd "$SITE_DIR"

# 1. Only generated paths may be dirty.
exclude_args=()
for p in "${GENERATED_PATHS[@]}"; do exclude_args+=(":(exclude)$p"); done
stray="$(git status --porcelain -- . "${exclude_args[@]}")"
if [[ -n "$stray" ]]; then
  echo -e "${YELLOW}sshs3-site has uncommitted changes outside the generated paths (${GENERATED_PATHS[*]}); commit or stash them first:${RESET}" >&2
  echo "$stray" >&2
  exit 1
fi

# Without an upstream there is nothing to compare against: fail loudly instead of deploying a Worker
# built from a local-only commit.
branch="$(git rev-parse --abbrev-ref HEAD)"
git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1 || fail "branch '${branch}' has no upstream; run: git -C ${SITE_DIR} push -u origin ${branch}"

if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "${YELLOW}[DRY RUN] sshs3-site (${SITE_DIR}, branch ${branch}) would:${RESET}"
  echo "  1. sync screenshots from ${REPO_ROOT}/docs/screenshots (public/img and public/img/docs)"
  echo "  2. npm run build:docs   (IPC channels + shortcuts read from ${REPO_ROOT})"
  echo "  3. npm run validate:links"
  echo "  4. commit ${GENERATED_PATHS[*]} if changed, push '${branch}'"
  echo "  5. npx wrangler deploy  -> sshs3.com, www.sshs3.com, docs.sshs3.com"
  [[ -d node_modules ]] || echo "     (node_modules missing: npm ci would run first)"
  exit 0
fi

# 2. Screenshots (the script writes next to public/docs).
SSHS3_SITE_DOCS_DIR="$SITE_DIR/public/docs" node "$REPO_ROOT/scripts/sync-docs.mjs" >/dev/null

# 3. Rebuild the docs from this checkout's source.
[[ -d node_modules ]] || npm ci
SSHS3_APP_DIR="$REPO_ROOT" npm run build:docs

# 4. Validate before anything is committed or published.
npm run validate:links

# 5. Commit, push, deploy.
git add -- "${GENERATED_PATHS[@]}"
if ! git diff --cached --quiet; then
  git commit -m "docs: sync from sshs3 ${TAG:-$(git -C "$REPO_ROOT" describe --tags --abbrev=0 2>/dev/null || echo HEAD)}"
fi
if [[ "$(git rev-list --count '@{u}..HEAD')" -gt 0 ]]; then
  git push origin "$branch"
fi
npx wrangler deploy

echo -e "${GREEN}✓ sshs3-site deployed (sshs3.com, docs.sshs3.com).${RESET}"
