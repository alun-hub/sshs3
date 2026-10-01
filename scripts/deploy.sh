#!/usr/bin/env bash
#
# deploy.sh
#
# Bumps the patch version (e.g. 0.96.2 -> 0.96.3), drafts a CHANGELOG entry
# (unless one already exists), commits all code changes,
# creates an annotated git tag (e.g. v0.96.3), and pushes both the branch
# and tag to GitHub to trigger the release workflow in GitHub Actions.
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
      echo "  --minor               Bump minor version instead of patch"
      echo "  --major               Bump major version instead of patch"
      echo "  -h, --help            Show this help message"
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

# 10. Summary
echo -e "\n${BOLD}${GREEN}===============================================${RESET}"
echo -e "${BOLD}${GREEN}🚀 Release ${TAG} successfully pushed!${RESET}"
echo -e "${BOLD}${GREEN}===============================================${RESET}"
echo -e "• Version:        ${OLD_VERSION} -> ${BOLD}${NEW_VERSION}${RESET}"
echo -e "• Git Tag:        ${BOLD}${TAG}${RESET}"
echo -e "• Branch:         ${BOLD}${CURRENT_BRANCH}${RESET}"
echo -e "• Commit:         ${FINAL_COMMIT_MSG}"
echo ""
echo -e "GitHub Actions will now build and publish the release artifacts:"
echo -e "${CYAN}https://github.com/alun-hub/sshs3/actions${RESET}"
echo ""
