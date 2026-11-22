#!/usr/bin/env node
// Helpers for the Microsoft Store submission that .github/workflows/store-build.yml creates with msstore.
//
//   node scripts/store-submission.mjs notes <CHANGELOG.md> <version> <out.txt>
//       writes the "What's new" text for a version (plain text, at most 1500 characters)
//   node scripts/store-submission.mjs patch <submission.json> <release-notes.txt> <new-package-file-name> <out.json>
//       reads the submission JSON that `msstore submission get` printed and writes the JSON to send back with
//       `msstore submission update`: the release notes in every listing and every OLD uploaded package marked for deletion
//
// Files in and out, not stdout: the text has characters outside ASCII (bullets, an ellipsis) and a PowerShell pipe would
// re-encode them. msstore prints its JSON with the property names capitalised (ApplicationPackages, FileName, ...) and reads
// any casing, so the code below finds a name whatever its casing is.

// The logic is in pure functions (unit tested in tests/scripts/storeSubmission.test.ts); the CLI only reads and writes files.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Partner Center allows at most 1500 characters of release notes ("What's new in this version"). */
export const MAX_RELEASE_NOTES = 1500;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Markdown of a changelog entry as plain text: headings as lines, bullets as "•", no emphasis, code ticks or link targets. */
export function markdownToPlain(md) {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*(.+)$/gm, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The "What's new" text for `version`: the body of its "## [version] - date" section of the changelog, as plain text, cut at a
 * line break to fit `max` characters (with "…" when something was left out). Throws when the version has no section.
 */
export function releaseNotesFor(changelog, version, max = MAX_RELEASE_NOTES) {
  const text = changelog.replace(/\r\n/g, '\n');
  const start = new RegExp(`^## \\[${escapeRegExp(version)}\\][^\\n]*\\n`, 'm').exec(text);
  if (!start) throw new Error(`No "## [${version}]" section in the changelog`);
  const rest = text.slice(start.index + start[0].length);
  const next = rest.search(/^## \[/m);
  const plain = markdownToPlain(next === -1 ? rest : rest.slice(0, next));
  if (!plain) throw new Error(`The "## [${version}]" section of the changelog is empty`);
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max - 1);
  const atLine = cut.lastIndexOf('\n');
  return `${(atLine > max / 2 ? cut.slice(0, atLine) : cut).trimEnd()}…`;
}

const keyOf = (obj, name) => Object.keys(obj).find((k) => k.toLowerCase() === name.toLowerCase());
const get = (obj, name) => (obj && typeof obj === 'object' ? obj[keyOf(obj, name) ?? ''] : undefined);
const set = (obj, name, value) => {
  obj[keyOf(obj, name) ?? name[0].toUpperCase() + name.slice(1)] = value;
};

/**
 * The submission to send back: the release notes in every listing, and every OTHER package that is already uploaded marked
 * `PendingDelete` (msstore only replaces a package with the same file extension, so an old `.appx` stays next to a new `.msix`).
 * This assumes a product with one package; it throws when the new package is not in the submission, so a wrong file name cannot
 * delete everything. The input is not changed.
 */
export function patchSubmission(submission, { releaseNotes, newPackageFileName }) {
  const out = structuredClone(submission);
  const found = get(out, 'applicationPackages');
  const packages = Array.isArray(found) ? found : [];
  if (!packages.some((p) => get(p, 'fileName') === newPackageFileName)) {
    throw new Error(`The submission has no package named ${newPackageFileName}`);
  }
  const markedForDeletion = [];
  for (const p of packages) {
    if (get(p, 'fileName') !== newPackageFileName && get(p, 'fileStatus') === 'Uploaded') {
      set(p, 'fileStatus', 'PendingDelete');
      markedForDeletion.push(get(p, 'fileName'));
    }
  }
  let listingsUpdated = 0;
  for (const listing of Object.values(get(out, 'listings') ?? {})) {
    const base = get(listing, 'baseListing');
    if (base && typeof base === 'object') {
      set(base, 'releaseNotes', releaseNotes);
      listingsUpdated++;
    }
  }
  return { submission: out, markedForDeletion, listingsUpdated };
}

/** The JSON object in `msstore submission get` output (anything before the first "{" or after the last "}" is dropped). */
export function extractJson(output) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in the msstore output');
  return JSON.parse(output.slice(start, end + 1));
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'notes' && args.length === 3) {
    writeFileSync(args[2], `${releaseNotesFor(readFileSync(args[0], 'utf8'), args[1])}\n`, 'utf8');
    return;
  }
  if (command === 'patch' && args.length === 4) {
    const releaseNotes = readFileSync(args[1], 'utf8').trim();
    const { submission, markedForDeletion, listingsUpdated } = patchSubmission(extractJson(readFileSync(args[0], 'utf8')), {
      releaseNotes,
      newPackageFileName: args[2],
    });
    process.stderr.write(`release notes (${releaseNotes.length} characters) set in ${listingsUpdated} listing(s); old packages marked for deletion: ${markedForDeletion.join(', ') || 'none'}\n`);
    writeFileSync(args[3], JSON.stringify(submission), 'utf8');
    return;
  }
  process.stderr.write('Usage: store-submission.mjs notes <CHANGELOG.md> <version> <out.txt> | patch <submission.json> <release-notes.txt> <new-package-file-name> <out.json>\n');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
