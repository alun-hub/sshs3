export const MAX_RELEASE_NOTES: number;
export function markdownToPlain(md: string): string;
export function releaseNotesFor(changelog: string, version: string, max?: number): string;
export interface StoreSubmissionLike {
  applicationPackages?: { fileName: string; fileStatus: string; [key: string]: unknown }[];
  listings?: Record<string, { baseListing?: { releaseNotes?: string; [key: string]: unknown }; [key: string]: unknown }>;
  [key: string]: unknown;
}
export function patchSubmission(
  submission: StoreSubmissionLike,
  options: { releaseNotes: string; newPackageFileName: string },
): { submission: StoreSubmissionLike; markedForDeletion: string[]; listingsUpdated: number };
export function extractJson(output: string): StoreSubmissionLike;
