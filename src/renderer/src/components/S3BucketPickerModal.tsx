import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, Loader2, X } from 'lucide-react';
import type { AwsS3Bucket, AwsS3BucketsRequest } from '@shared/types/awsScan';
import { describeIpcError } from '../lib/format';
import { useDialogFocus } from '../lib/useDialogFocus';
import { useModalDismiss } from '../lib/useModalDismiss';

interface Props {
  /** The sign-in, account and role whose buckets are listed (the token itself stays in the main process). */
  request: AwsS3BucketsRequest;
  /** The bucket and its region (undefined when it could not be told). */
  onPick: (bucket: string, region: string | undefined) => void;
  onClose: () => void;
}

const input = 'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500';

/** Lists the S3 buckets of an IAM Identity Center account/role so one can be chosen for an S3 profile. */
export const S3BucketPickerModal: React.FC<Props> = ({ request, onPick, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, true);
  const onBackdrop = useModalDismiss(onClose, true);
  const [buckets, setBuckets] = useState<AwsS3Bucket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.multissh
      .awsS3ListBuckets(request)
      .then((list) => alive && setBuckets(list))
      .catch((err) => alive && setError(describeIpcError(err, 'Could not list the buckets')));
    return () => {
      alive = false;
    };
    // The request is fixed while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => (buckets ?? []).filter((b) => b.name.includes(filter.trim().toLowerCase())), [buckets, filter]);

  const pick = async (name: string) => {
    if (picking) return;
    setPicking(name);
    // The region is looked up for this bucket only; a bucket whose region cannot be told is still usable.
    const region = await window.multissh.awsS3BucketRegion({ ...request, bucket: name }).catch(() => undefined);
    onPick(name, region);
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" onClick={onBackdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pick an S3 bucket"
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-hidden rounded-xl border border-border-subtle bg-app-surface p-4 text-xs shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-divider pb-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-sky-400">
            <Cloud className="h-4 w-4" aria-hidden="true" />
            <span>Pick an S3 bucket</span>
          </div>
          <button type="button" aria-label="Close" title="Close" onClick={onClose} className="rounded p-1 text-txt-muted hover:text-txt-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        {buckets === null && !error && (
          <p role="status" className="flex items-center gap-2 text-txt-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Listing buckets…
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-red-300">
            {error} You can type the bucket name in <strong>Initial Path</strong> instead.
          </p>
        )}

        {buckets !== null && (
          <>
            <input
              data-autofocus
              aria-label="Filter buckets"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter buckets"
              className={input}
            />
            {buckets.length === 0 ? (
              <p className="text-txt-muted">No buckets in this account that this role may list. Type the bucket name in Initial Path instead.</p>
            ) : visible.length === 0 ? (
              <p className="text-txt-muted">No bucket matches the filter.</p>
            ) : (
              <ul aria-label="Buckets" className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {visible.map((b) => (
                  <li key={b.name}>
                    <button
                      type="button"
                      disabled={picking !== null}
                      onClick={() => void pick(b.name)}
                      className="flex min-h-[28px] w-full items-center justify-between gap-2 rounded-lg border border-border-subtle px-2.5 py-1.5 text-left font-mono text-txt-primary hover:bg-app-surface-hover disabled:opacity-50"
                    >
                      <span className="truncate">{b.name}</span>
                      {picking === b.name && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Looking up the region" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="flex justify-end border-t border-divider pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border-subtle px-3 py-1.5 text-txt-secondary hover:bg-app-surface-hover">
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
