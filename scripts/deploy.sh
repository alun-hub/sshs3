#!/usr/bin/env bash
#
# deploy.sh
#
# Bumps the patch version (e.g. 0.96.2 -> 0.96.3), drafts a CHANGELOG entry
# (unless one already exists), commits all code changes,
# creates an annotated git tag (e.g. v0.96.3), and pushes both the branch
# and tag to GitHub to trigger the release workflow in GitHub Actions.
#
# Optionally also publishes the sshs3-site (sshs3.com / docs.sshs3.com) Cloudflare
# Worker: syncs screenshots, commits and pushes the site repo, runs `wrangler deploy`.
# By default this happens only when docs/ changed since the previous tag.
#
# After a successful push it also prunes old GitHub releases: all drafts (except the one for the
# tag just pushed) and every published release beyond the newest N (default 10, counting the one the
# workflow is about to publish). Git tags are never deleted. See --keep-releases / --no-prune.
#

set -euo pipefail

# Ensure we run from project root (handling symlinks gracefully)
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ANSI Colors
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
RESET="\033[0m"

SKIP_CHECKS=false
DRY_RUN=false
COMMIT_MSG=""
VERSION_TYPE="patch"
SITE_MODE="auto"   # auto | on | off
SITE_DIR="${SSHS3_SITE_DIR:-$REPO_ROOT/../sshs3-site}"
KEEP_RELEASES="${SSHS3_KEEP_RELEASES:-10}"   # published releases to keep, including the new one
PRUNE_RELEASES=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-checks|--no-verify)
      SKIP_CHECKS=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --site)
      SITE_MODE="on"
      shift
      ;;
    --no-site)
      SITE_MODE="off"
      shift
      ;;
    --keep-releases)
      if [[ $# -lt 2 || ! "$2" =~ ^[0-9]+$ ]]; then
        echo -e "${RED}Error: --keep-releases needs a whole number (e.g. --keep-releases 10).${RESET}"
        exit 1
      fi
      KEEP_RELEASES="$2"
      shift 2
      ;;
    --no-prune)
      PRUNE_RELEASES=false
      shift
      ;;
    --minor)
      VERSION_TYPE="minor"
      shift
      ;;
    --major)
      VERSION_TYPE="major"
      shift
      ;;
    -m|--message)
      shift
      if [[ $# -gt 0 ]]; then
        COMMIT_MSG="$1"
        shift
      else
        echo -e "${RED}Error: --message requires an argument.${RESET}"
        exit 1
      fi
      ;;
    -h|--help)
      echo -e "${BOLD}Usage:${RESET} ./deploy.sh [options] [commit_message]"
      echo ""
      echo "Bumps the patch version, drafts a CHANGELOG entry, commits all changes, tags, and pushes to trigger release.yml."
      echo ""
      echo -e "${BOLD}Options:${RESET}"
      echo "  -m, --message <msg>   Custom commit message (defaults to 'chore: release v<version>')"
      echo "  --skip-checks         Skip typecheck, lint, and test before deploying"
      echo "  --dry-run             Simulate version bump and commit without pushing or writing git state"
      echo "  --site                Always deploy sshs3-site after the release (default: only if docs/ changed)"
      echo "  --no-site             Never deploy sshs3-site"
      echo "  --keep-releases <n>   Keep the newest n published GitHub releases (default 10) and delete older ones"
      echo "  --no-prune            Do not delete any old releases or drafts"
      echo "  --minor               Bump minor version instead of patch"
      echo "  --major               Bump major version instead of patch"
      echo "  -h, --help            Show this help message"
      echo ""
      echo "Environment: SSHS3_SITE_DIR overrides the sshs3-site checkout (default: ../sshs3-site)."
      echo "             SSHS3_KEEP_RELEASES sets the default for --keep-releases."
      echo ""
      echo -e "${BOLD}Examples:${RESET}"
      echo "  ./deploy.sh"
      echo "  ./deploy.sh \"feat: add smartcard support\""
      echo "  ./deploy.sh --message \"fix: askpass prompt fix\" --skip-checks"
      exit 0
      ;;
    *)
      if [[ -z "$COMMIT_MSG" ]]; then
        COMMIT_MSG="$1"
      else
        COMMIT_MSG="$COMMIT_MSG $1"
      fi
      shift
      ;;
  esac
done

# Validate the retention setting early (it also comes from SSHS3_KEEP_RELEASES).
if [[ ! "$KEEP_RELEASES" =~ ^[0-9]+$ || "$KEEP_RELEASES" -lt 1 ]]; then
  echo -e "${RED}Error: --keep-releases / SSHS3_KEEP_RELEASES must be a whole number >= 1 (got '${KEEP_RELEASES}').${RESET}"
  exit 1
fi

# Prune old GitHub releases so they do not pile up (each release carries ~0.8 GB of installers).
#   - every draft, except the one for the tag being released (the workflow may be creating it right now)
#   - every published release beyond the newest KEEP_RELEASES - 1, because the release this run is
#     pushing will be published by the workflow and takes the last slot
# Only releases are deleted: git tags stay, so any version can be rebuilt. Never fatal: the release
# itself is already pushed (or, in a dry run, nothing is deleted at all).
#   usage: prune_releases plan|apply
PRUNE_RESULT="skipped"
prune_releases() {
  local mode="$1"
  if [[ "$PRUNE_RELEASES" != "true" ]]; then
    PRUNE_RESULT="disabled (--no-prune)"
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
    PRUNE_RESULT="skipped (gh CLI missing or not logged in)"
    echo -e "${YELLOW}Warning: cannot prune old releases: the gh CLI is not installed or not authenticated.${RESET}"
    return 0
  fi

  local listing
  if ! listing="$(gh api --paginate 'repos/{owner}/{repo}/releases?per_page=100' \
      --jq '.[] | [.id, .tag_name, (.draft | tostring)] | @tsv' 2>/dev/null)"; then
    PRUNE_RESULT="skipped (could not list releases)"
    echo -e "${YELLOW}Warning: could not list GitHub releases; skipping prune.${RESET}"
    return 0
  fi

  local drafts older
  drafts="$(awk -F'\t' -v tag="$TAG" '$3 == "true" && $2 != tag { print $1 "\t" $2 }' <<<"$listing")"
  older="$(awk -F'\t' -v tag="$TAG" '$3 == "false" && $2 != tag { print $1 "\t" $2 }' <<<"$listing" \
    | sort -t $'\t' -k2,2Vr | tail -n +"$KEEP_RELEASES")"

  local n_drafts=0 n_old=0
  [[ -n "$drafts" ]] && n_drafts="$(wc -l <<<"$drafts")"
  [[ -n "$older" ]] && n_old="$(wc -l <<<"$older")"
  if (( n_drafts + n_old == 0 )); then
    PRUNE_RESULT="nothing to prune (keeping ${KEEP_RELEASES})"
    return 0
  fi

  if [[ "$mode" == "plan" ]]; then
    echo "  7. prune GitHub releases (tags are kept): ${n_drafts} draft(s), ${n_old} published older than the newest $((KEEP_RELEASES - 1)) + ${TAG}"
    [[ -n "$older" ]] && echo "     would delete: $(cut -f2 <<<"$older" | paste -sd' ' -)"
    PRUNE_RESULT="planned"
    return 0
  fi

  local id deleted=0 failed=0
  while IFS=$'\t' read -r id _; do
    [[ -z "$id" ]] && continue
    if gh api -X DELETE "repos/{owner}/{repo}/releases/${id}" >/dev/null 2>&1; then
      deleted=$((deleted + 1))
    else
      failed=$((failed + 1))
    fi
  done <<<"${drafts}"$'\n'"${older}"

  PRUNE_RESULT="deleted ${deleted} (${n_drafts} draft(s), ${n_old} older), ${failed} failed; newest ${KEEP_RELEASES} kept"
  if (( failed > 0 )); then
    echo -e "${YELLOW}⚠ ${failed} old release(s) could not be deleted (see the GitHub releases page).${RESET}"
  else
    echo -e "${GREEN}✓ Pruned old releases: ${PRUNE_RESULT}.${RESET}"
  fi
}

echo -e "${BOLD}${CYAN}=== SSHS3 Deploy & Release Script ===${RESET}"

# 1. Check git repository
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo -e "${RED}Error: Current directory is not a git repository.${RESET}"
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ -z "$CURRENT_BRANCH" || "$CURRENT_BRANCH" == "HEAD" ]]; then
  echo -e "${RED}Error: Detached HEAD state. Please checkout a branch before deploying.${RESET}"
  exit 1
fi

if [[ "$CURRENT_BRANCH" != "master" && "$CURRENT_BRANCH" != "main" ]]; then
  echo -e "${YELLOW}Warning: Current branch is '${CURRENT_BRANCH}', not 'master' or 'main'.${RESET}"
  if [[ -t 0 ]]; then
    read -r -p "Continue release from branch '${CURRENT_BRANCH}'? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[yY]([eE][sS])?$ ]]; then
      echo "Deployment aborted."
      exit 1
    fi
  fi
fi

# 2. Check remote origin
if ! git remote get-url origin >/dev/null 2>&1; then
  echo -e "${RED}Error: Git remote 'origin' is not configured.${RESET}"
  exit 1
fi

# 3. Pre-flight checks (typecheck, lint, test)
if [[ "$SKIP_CHECKS" == "false" && "$DRY_RUN" == "false" ]]; then
  echo -e "\n${CYAN}Running pre-flight checks (typecheck & lint)...${RESET}"
  if ! npm run typecheck; then
    echo -e "${RED}❌ Typecheck failed! Fix TypeScript errors or use --skip-checks to bypass.${RESET}"
    exit 1
  fi

  if ! npm run lint; then
    echo -e "${RED}❌ Lint failed! Fix lint errors or use --skip-checks to bypass.${RESET}"
    exit 1
  fi
  echo -e "${GREEN}✓ Pre-flight checks passed.${RESET}"
else
  if [[ "$SKIP_CHECKS" == "true" ]]; then
    echo -e "${YELLOW}Skipping pre-flight checks (--skip-checks enabled).${RESET}"
  fi
fi

# 4. Determine current and next version
OLD_VERSION="$(node -p "require('./package.json').version")"
echo -e "\n${CYAN}Current version:${RESET} ${BOLD}${OLD_VERSION}${RESET}"

# Create temporary backups of package files in case of abort or dry run
cp package.json package.json.bak
cp package-lock.json package-lock.json.bak
cp CHANGELOG.md CHANGELOG.md.bak

restore_backups() {
  if [[ -f package.json.bak ]]; then
    mv -f package.json.bak package.json
  fi
  if [[ -f package-lock.json.bak ]]; then
    mv -f package-lock.json.bak package-lock.json
  fi
  if [[ -f CHANGELOG.md.bak ]]; then
    mv -f CHANGELOG.md.bak CHANGELOG.md
  fi
}

cleanup_backups() {
  rm -f package.json.bak package-lock.json.bak CHANGELOG.md.bak
}

# Bump version using npm without git tag/commit yet
npm version "$VERSION_TYPE" --no-git-tag-version >/dev/null
NEW_VERSION="$(node -p "require('./package.json').version")"
TAG="v${NEW_VERSION}"

echo -e "${CYAN}New bumped version:${RESET} ${BOLD}${GREEN}${NEW_VERSION}${RESET} (${TAG})"

# Check if tag already exists locally or remotely
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo -e "${RED}Error: Git tag '${TAG}' already exists locally.${RESET}"
  restore_backups
  exit 1
fi

# 4b. Add a CHANGELOG entry (skipped if one for this version already exists,
# e.g. written by hand beforehand). Drafted from commit subjects since the last tag.
if grep -q "^## \\[${NEW_VERSION}\\]" CHANGELOG.md; then
  echo -e "${CYAN}CHANGELOG.md already has an entry for ${NEW_VERSION}; leaving it untouched.${RESET}"
else
  LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
  RANGE="${LAST_TAG:+${LAST_TAG}..}HEAD"
  NEW_VERSION="$NEW_VERSION" RANGE="$RANGE" node -e '
    const { execSync } = require("child_process");
    const fs = require("fs");
    const subjects = execSync(`git log ${process.env.RANGE} --no-merges --pretty=%s`, { encoding: "utf8" })
      .split("\n").filter((l) => l && !/^chore: release/.test(l));
    const groups = { Added: [], Fixed: [], Changed: [] };
    for (const subj of subjects) {
      const m = subj.match(/^(\w+)(?:\([^)]*\))?!?:\s*(.*)$/);
      const [type, text] = m ? [m[1], m[2]] : ["", subj];
      (type === "feat" ? groups.Added : type === "fix" ? groups.Fixed : groups.Changed).push(text);
    }
    const date = new Date().toISOString().slice(0, 10);
    let entry = `## [${process.env.NEW_VERSION}] - ${date}\n\n`;
    for (const [name, items] of Object.entries(groups)) {
      if (items.length) entry += `### ${name}\n${items.map((i) => `- ${i}`).join("\n")}\n\n`;
    }
    if (!subjects.length) entry += "### Changed\n- Maintenance release.\n\n";
    const log = fs.readFileSync("CHANGELOG.md", "utf8");
    const i = log.search(/^## \[/m);
    fs.writeFileSync("CHANGELOG.md", i < 0 ? log.trimEnd() + "\n\n" + entry : log.slice(0, i) + entry + log.slice(i));
  '
  echo -e "${GREEN}✓ Drafted CHANGELOG.md entry for ${NEW_VERSION} (edit it before the next release if needed).${RESET}"
fi

# 4c. Decide whether sshs3-site should be deployed (docs/ changed since last tag, or forced)
LAST_TAG_FOR_SITE="$(git describe --tags --abbrev=0 2>/dev/null || true)"
DO_SITE=false
if [[ "$SITE_MODE" == "on" ]]; then
  DO_SITE=true
elif [[ "$SITE_MODE" == "auto" ]]; then
  if [[ -z "$LAST_TAG_FOR_SITE" ]] || [[ -n "$(git diff --name-only "$LAST_TAG_FOR_SITE" -- docs)" ]]; then
    DO_SITE=true
  fi
fi
if [[ "$DO_SITE" == "true" && ! -d "$SITE_DIR/.git" ]]; then
  echo -e "${YELLOW}Warning: sshs3-site not found at ${SITE_DIR}; skipping site deploy (set SSHS3_SITE_DIR).${RESET}"
  DO_SITE=false
fi

# 5. Format commit message
if [[ -z "$COMMIT_MSG" ]]; then
  FINAL_COMMIT_MSG="chore: release ${TAG}"
else
  FINAL_COMMIT_MSG="${COMMIT_MSG}"
fi

# 6. Dry run handling
if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "\n${YELLOW}[DRY RUN] Would execute:${RESET}"
  echo "  1. git add -A"
  echo "  2. git commit -m \"${FINAL_COMMIT_MSG}\""
  echo "  3. git tag -a \"${TAG}\" -m \"Release ${TAG}\""
  echo "  4. git push origin \"${CURRENT_BRANCH}\""
  echo "  5. git push origin \"${TAG}\""
  if [[ "$DO_SITE" == "true" ]]; then
    echo "  6. sshs3-site (${SITE_DIR}): sync screenshots, commit, push, npx wrangler deploy"
  else
    echo "  6. (sshs3-site deploy skipped: ${SITE_MODE})"
  fi
  if [[ "$PRUNE_RELEASES" == "true" ]]; then
    prune_releases plan
    [[ "$PRUNE_RESULT" == nothing* || "$PRUNE_RESULT" == skipped* ]] && echo "  7. prune GitHub releases: ${PRUNE_RESULT}"
  else
    echo "  7. (release pruning disabled: --no-prune)"
  fi
  
  # Revert version bump for dry run
  restore_backups
  echo -e "${GREEN}✓ Dry run complete. No changes were committed or pushed.${RESET}"
  exit 0
fi

# Clean up backups since we are proceeding with commit
cleanup_backups

# 7. Stage all files and commit
echo -e "\n${CYAN}Staging all changes and committing...${RESET}"
git add -A

if git diff --cached --quiet; then
  echo -e "${YELLOW}No changes to commit.${RESET}"
else
  git commit -m "${FINAL_COMMIT_MSG}"
  COMMIT_HASH="$(git rev-parse --short HEAD)"
  echo -e "${GREEN}✓ Committed as ${BOLD}${COMMIT_HASH}${RESET}: ${FINAL_COMMIT_MSG}"
fi

# 8. Create annotated git tag
echo -e "\n${CYAN}Creating git tag '${TAG}'...${RESET}"
git tag -a "${TAG}" -m "Release ${TAG}"
echo -e "${GREEN}✓ Tag ${TAG} created.${RESET}"

# 9. Push branch and tag to GitHub
echo -e "\n${CYAN}Pushing branch '${CURRENT_BRANCH}' and tag '${TAG}' to GitHub...${RESET}"
git push origin "${CURRENT_BRANCH}"
git push origin "${TAG}"

# 10. Deploy sshs3-site (Cloudflare Worker). The release is already pushed at this point,
# so a failure here only warns; re-run the printed commands manually.
#
# Written as a function with explicit `|| return 1` after every step: `set -e` is ignored inside
# anything that runs as an `if` condition (including a `( set -e; ... )` subshell), so a failing
# sync, commit or push would otherwise be skipped over and `wrangler deploy` would still run.
deploy_site() {
  # Keep the screenshot sync pointed at the same checkout we commit in (sync-docs.mjs defaults to
  # ../sshs3-site and would otherwise ignore SSHS3_SITE_DIR).
  SSHS3_SITE_DOCS_DIR="$SITE_DIR/public/docs" node "$REPO_ROOT/scripts/sync-docs.mjs" >/dev/null || return 1

  cd "$SITE_DIR" || return 1

  # Only the synced assets may be committed. Refuse to sweep unrelated work in the site repo into a
  # release commit.
  local stray
  stray="$(git status --porcelain -- . ':(exclude)public/img' ':(exclude)public/docs')" || return 1
  if [[ -n "$stray" ]]; then
    echo -e "${YELLOW}sshs3-site has uncommitted changes outside public/img and public/docs; commit or stash them first:${RESET}" >&2
    echo "$stray" >&2
    return 1
  fi

  git add -- public/img public/docs || return 1
  if ! git diff --cached --quiet; then
    git commit -m "docs: sync from sshs3 ${TAG}" || return 1
  fi

  # Without an upstream there is nothing to compare against: fail loudly instead of silently
  # skipping the push and deploying a Worker built from a local-only commit.
  local site_branch ahead
  site_branch="$(git rev-parse --abbrev-ref HEAD)" || return 1
  if ! git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    echo -e "${YELLOW}sshs3-site branch '${site_branch}' has no upstream; run: git -C ${SITE_DIR} push -u origin ${site_branch}${RESET}" >&2
    return 1
  fi
  ahead="$(git rev-list --count '@{u}..HEAD')" || return 1
  if [[ "$ahead" -gt 0 ]]; then
    git push origin "$site_branch" || return 1
  fi

  npx wrangler deploy || return 1
}

SITE_RESULT="skipped"
if [[ "$DO_SITE" == "true" ]]; then
  echo -e "\n${CYAN}Deploying sshs3-site from ${SITE_DIR}...${RESET}"
  # Subshell so the `cd` above does not move the rest of this script.
  if (deploy_site); then
    SITE_RESULT="deployed"
    echo -e "${GREEN}✓ sshs3-site deployed.${RESET}"
  else
    SITE_RESULT="FAILED"
    echo -e "${YELLOW}⚠ sshs3-site deploy failed. The release itself is unaffected. Fix the cause above, then retry manually:${RESET}"
    echo "    cd ${SITE_DIR} && git push && npx wrangler deploy"
  fi
fi

# 11. Prune old GitHub releases (never fatal).
prune_releases apply

# 12. Summary
echo -e "\n${BOLD}${GREEN}===============================================${RESET}"
echo -e "${BOLD}${GREEN}🚀 Release ${TAG} successfully pushed!${RESET}"
echo -e "${BOLD}${GREEN}===============================================${RESET}"
echo -e "• Version:        ${OLD_VERSION} -> ${BOLD}${NEW_VERSION}${RESET}"
echo -e "• Git Tag:        ${BOLD}${TAG}${RESET}"
echo -e "• Branch:         ${BOLD}${CURRENT_BRANCH}${RESET}"
echo -e "• Commit:         ${FINAL_COMMIT_MSG}"
echo -e "• sshs3-site:     ${SITE_RESULT}"
echo -e "• Old releases:   ${PRUNE_RESULT}"
echo ""
echo -e "GitHub Actions will now build and publish the release artifacts:"
echo -e "${CYAN}https://github.com/alun-hub/sshs3/actions${RESET}"
echo ""
