import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractJson, markdownToPlain, MAX_RELEASE_NOTES, patchSubmission, releaseNotesFor } from '../../scripts/store-submission.mjs';

const CHANGELOG = `# Changelog

## [0.98.2] - 2026-11-21

### Added
- **Pick bucket…** in the S3 profile form. It needs \`s3:ListAllMyBuckets\`; see [the guide](https://docs.sshs3.com/x/).
- Second item.

### Fixed
- A profile added in \`~/.aws/config\` is found.

## [0.98.1] - 2026-11-21

### Fixed
- Old entry.
`;

describe('markdownToPlain', () => {
  it('turns headings into lines, bullets into bullets and drops emphasis, code ticks and link targets', () => {
    expect(markdownToPlain('### Added\n- **Bold** and `code` and [a link](https://x.y)\n- *italic*\n')).toBe('Added\n• Bold and code and a link\n• italic');
  });
});

describe('releaseNotesFor', () => {
  it('takes the section of the version only', () => {
    const notes = releaseNotesFor(CHANGELOG, '0.98.2');
    expect(notes).toContain('• Pick bucket… in the S3 profile form.');
    expect(notes).toContain('Fixed\n• A profile added in ~/.aws/config is found.');
    expect(notes).not.toContain('Old entry');
    expect(notes).not.toContain('**');
    expect(notes).not.toContain('https://');
  });

  it('works for the last section and a CRLF file', () => {
    expect(releaseNotesFor(CHANGELOG.replace(/\n/g, '\r\n'), '0.98.1')).toBe('Fixed\n• Old entry.');
  });

  it('throws when there is no section or it is empty', () => {
    expect(() => releaseNotesFor(CHANGELOG, '9.9.9')).toThrow('No "## [9.9.9]" section');
    expect(() => releaseNotesFor('## [1.0.0] - 2026-01-01\n\n## [0.9.0] - x\n- a\n', '1.0.0')).toThrow('empty');
  });

  it('does not match a version that only starts the same, and treats dots literally', () => {
    expect(() => releaseNotesFor('## [0.98.20] - x\n- a\n', '0.98.2')).toThrow('No "## [0.98.2]"');
    expect(() => releaseNotesFor('## [0x98x2] - x\n- a\n', '0.98.2')).toThrow('No "## [0.98.2]"');
  });

  it('cuts at a line break to fit the limit and says so with an ellipsis', () => {
    const long = `## [1.0.0] - x\n${Array.from({ length: 60 }, (_, i) => `- Item number ${i} with some words to fill the line`).join('\n')}\n`;
    const notes = releaseNotesFor(long, '1.0.0');
    expect(notes.length).toBeLessThanOrEqual(MAX_RELEASE_NOTES);
    expect(notes.endsWith('…')).toBe(true);
    expect(notes.split('\n').every((l) => l.startsWith('•') || l.endsWith('…'))).toBe(true);
  });

  it('can read the real changelog of this repository', () => {
    const real = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
    const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;
    const notes = releaseNotesFor(real, version);
    expect(notes.length).toBeGreaterThan(20);
    expect(notes.length).toBeLessThanOrEqual(MAX_RELEASE_NOTES);
  });
});

// The shape `msstore submission get` prints: property names capitalised.
const submission = () => ({
  Id: '1152921505702472195',
  TargetPublishMode: 'Immediate',
  Pricing: { PriceId: 'Free' },
  Listings: { 'en-us': { BaseListing: { Title: 'sshs3', ReleaseNotes: 'old text' } }, 'sv-se': { BaseListing: { Title: 'sshs3' } } },
  ApplicationPackages: [
    { FileName: 'sshs3-0.98.1.appx', FileStatus: 'Uploaded', Version: '0.98.1.0' },
    { FileName: 'sshs3-0.98.2.msix', FileStatus: 'Uploaded', Version: '0.98.2.0' },
  ],
});
const pkgs = (s: { ApplicationPackages?: { FileName: string; FileStatus: string }[] }) => (s.ApplicationPackages ?? []).map((p) => [p.FileName, p.FileStatus]);

describe('patchSubmission', () => {
  it('sets the release notes in every listing and marks only the OTHER uploaded package for deletion', () => {
    const { submission: out, markedForDeletion, listingsUpdated } = patchSubmission(submission() as never, { releaseNotes: 'new notes', newPackageFileName: 'sshs3-0.98.2.msix' });
    const o = out as unknown as ReturnType<typeof submission>;
    expect(markedForDeletion).toEqual(['sshs3-0.98.1.appx']);
    expect(listingsUpdated).toBe(2);
    expect(pkgs(o)).toEqual([
      ['sshs3-0.98.1.appx', 'PendingDelete'],
      ['sshs3-0.98.2.msix', 'Uploaded'],
    ]);
    expect(o.Listings['en-us'].BaseListing.ReleaseNotes).toBe('new notes');
    expect((o.Listings['sv-se'].BaseListing as { ReleaseNotes?: string }).ReleaseNotes).toBe('new notes');
    // everything else is kept as it was
    expect(o.TargetPublishMode).toBe('Immediate');
    expect(o.Pricing).toEqual({ PriceId: 'Free' });
    expect(o.Id).toBe('1152921505702472195');
  });

  it('finds the names whatever their casing is, and keeps the casing it found', () => {
    const camel = { applicationPackages: [{ fileName: 'old.appx', fileStatus: 'Uploaded' }, { fileName: 'new.msix', fileStatus: 'Uploaded' }], listings: { 'en-us': { baseListing: { releaseNotes: 'x' } } } };
    const { submission: out } = patchSubmission(camel as never, { releaseNotes: 'n', newPackageFileName: 'new.msix' });
    const o = out as unknown as typeof camel;
    expect(o.applicationPackages[0]).toEqual({ fileName: 'old.appx', fileStatus: 'PendingDelete' });
    expect(o.listings['en-us'].baseListing.releaseNotes).toBe('n');
  });

  it('does not change its input, and leaves a package that is already PendingDelete or still PendingUpload alone', () => {
    const input = submission();
    input.ApplicationPackages.unshift({ FileName: 'sshs3-0.97.8.appx', FileStatus: 'PendingDelete', Version: '0.97.8.0' });
    const copy = structuredClone(input);
    const { markedForDeletion } = patchSubmission(input as never, { releaseNotes: 'x', newPackageFileName: 'sshs3-0.98.2.msix' });
    expect(input).toEqual(copy);
    expect(markedForDeletion).toEqual(['sshs3-0.98.1.appx']);
    const pending = { ApplicationPackages: [{ FileName: 'a.msix', FileStatus: 'PendingUpload' }, { FileName: 'b.msix', FileStatus: 'PendingUpload' }] };
    expect(patchSubmission(pending as never, { releaseNotes: 'x', newPackageFileName: 'b.msix' }).markedForDeletion).toEqual([]);
  });

  it('refuses to touch anything when the new package is not in the submission', () => {
    expect(() => patchSubmission(submission() as never, { releaseNotes: 'x', newPackageFileName: 'sshs3-9.9.9.msix' })).toThrow('no package named sshs3-9.9.9.msix');
    expect(() => patchSubmission({} as never, { releaseNotes: 'x', newPackageFileName: 'a.msix' })).toThrow('no package named');
  });

  it('copes with a submission without listings', () => {
    const input = submission() as Record<string, unknown>;
    delete input.Listings;
    expect(patchSubmission(input as never, { releaseNotes: 'x', newPackageFileName: 'sshs3-0.98.2.msix' }).listingsUpdated).toBe(0);
  });
});

describe('extractJson', () => {
  it('reads the JSON object out of output that has other text around it', () => {
    expect(extractJson('Retrieving Submission...\n{"id":"1","applicationPackages":[]}\ndone')).toEqual({ id: '1', applicationPackages: [] });
  });
  it('throws without JSON', () => {
    expect(() => extractJson('nothing here')).toThrow('No JSON');
  });
});
