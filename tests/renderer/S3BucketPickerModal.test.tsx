// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { S3BucketPickerModal } from '../../src/renderer/src/components/S3BucketPickerModal';

const REQUEST = { startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1', accountId: '123456789012', roleName: 'Dev', s3ProfileId: 's3-1' };
const api = {
  awsS3ListBuckets: vi.fn(async () => [{ name: 'alpha-bucket' }, { name: 'beta-bucket' }]),
  awsS3BucketRegion: vi.fn(async () => 'eu-north-1' as string | undefined),
};

beforeEach(() => {
  api.awsS3ListBuckets.mockClear();
  api.awsS3BucketRegion.mockClear();
  window.multissh = { ...api } as never;
});
afterEach(() => cleanup());

describe('S3BucketPickerModal', () => {
  it('lists the buckets of the account and role, and the request carries no token', async () => {
    render(<S3BucketPickerModal request={REQUEST} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'alpha-bucket' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'beta-bucket' })).toBeInTheDocument();
    expect(api.awsS3ListBuckets).toHaveBeenCalledWith(REQUEST);
    expect(JSON.stringify(api.awsS3ListBuckets.mock.calls)).not.toMatch(/token/i);
  });

  it('filters by name', async () => {
    render(<S3BucketPickerModal request={REQUEST} onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'alpha-bucket' });
    fireEvent.change(screen.getByLabelText('Filter buckets'), { target: { value: 'BET' } });
    expect(screen.queryByRole('button', { name: 'alpha-bucket' })).toBeNull();
    expect(screen.getByRole('button', { name: 'beta-bucket' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter buckets'), { target: { value: 'zzz' } });
    expect(screen.getByText('No bucket matches the filter.')).toBeInTheDocument();
  });

  it('looks up the region of the chosen bucket only and hands both back', async () => {
    const onPick = vi.fn();
    render(<S3BucketPickerModal request={REQUEST} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'beta-bucket' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('beta-bucket', 'eu-north-1'));
    expect(api.awsS3BucketRegion).toHaveBeenCalledTimes(1);
    expect(api.awsS3BucketRegion).toHaveBeenCalledWith({ ...REQUEST, bucket: 'beta-bucket' });
  });

  it('still picks a bucket whose region cannot be told', async () => {
    api.awsS3BucketRegion.mockRejectedValueOnce(new Error('denied'));
    const onPick = vi.fn();
    render(<S3BucketPickerModal request={REQUEST} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-bucket' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('alpha-bucket', undefined));
  });

  it('says what went wrong and points at typing the name when the listing is denied', async () => {
    api.awsS3ListBuckets.mockRejectedValueOnce(new Error('Access denied: not allowed to s3:ListAllMyBuckets.'));
    render(<S3BucketPickerModal request={REQUEST} onPick={vi.fn()} onClose={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ListAllMyBuckets');
    expect(alert).toHaveTextContent('Initial Path');
  });

  it('says so when there are no buckets, and closes with Escape', async () => {
    api.awsS3ListBuckets.mockResolvedValueOnce([]);
    const onClose = vi.fn();
    render(<S3BucketPickerModal request={REQUEST} onPick={vi.fn()} onClose={onClose} />);
    expect(await screen.findByText(/No buckets in this account/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
