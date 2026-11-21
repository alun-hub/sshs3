// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { S3ProfileForm } from '../../src/renderer/src/components/ConnectionModal/S3ProfileForm';
import type { S3Config } from '../../src/shared/types/storage';

const sso = { startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1', accountId: '123456789012', roleName: 'Dev' };
const base = (extra: Partial<S3Config> = {}): S3Config =>
  ({ id: 's3-1', name: '', region: 'us-east-1', authMode: 'sso', accessKeyId: '', secretAccessKey: '', forcePathStyle: false, ssl: true, rejectUnauthorized: true, sso, ...extra }) as S3Config;
const api = {
  awsSsoStatus: vi.fn(async () => ({ status: 'valid', expiresAt: '2030-01-01T00:00:00' })),
  awsSsoListAccountsCached: vi.fn(async () => [{ accountId: '123456789012', accountName: 'Prod' }]),
  awsSsoListRolesCached: vi.fn(async () => [{ roleName: 'Dev' }]),
  awsS3ListBuckets: vi.fn(async () => [{ name: 'alpha-bucket' }]),
  awsS3BucketRegion: vi.fn(async () => 'eu-north-1' as string | undefined),
};

beforeEach(() => { Object.values(api).forEach((f) => f.mockClear()); window.multissh = { ...api } as never; });
afterEach(() => cleanup());

const renderForm = (initial: S3Config) => render(<S3ProfileForm initial={initial} onSave={vi.fn()} onCancel={vi.fn()} />);

describe('S3ProfileForm: Pick bucket', () => {
  it('is disabled until an account and a role are chosen', () => {
    renderForm(base({ sso: { startUrl: sso.startUrl, region: sso.region } }));
    expect(screen.getByTestId('s3-pick-bucket')).toBeDisabled();
  });

  it('fills in Initial Path, the Region of the bucket and an empty Profile Name from the chosen bucket', async () => {
    renderForm(base());
    fireEvent.click(screen.getByTestId('s3-pick-bucket'));
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-bucket' }));
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. bucket-name or bucket-name/folder (default: /)')).toHaveValue('alpha-bucket'));
    expect(screen.getAllByPlaceholderText('us-east-1')[0]).toHaveValue('eu-north-1');
    expect(screen.getByPlaceholderText('e.g. Backup Bucket')).toHaveValue('alpha-bucket');
    expect(screen.getByText('Region set to eu-north-1.')).toBeInTheDocument();
    expect(api.awsS3ListBuckets).toHaveBeenCalledWith(expect.objectContaining({ accountId: '123456789012', roleName: 'Dev', s3ProfileId: 's3-1' }));
  });

  it('keeps a name the user typed, and the region when the bucket has none to tell', async () => {
    api.awsS3BucketRegion.mockResolvedValueOnce(undefined);
    renderForm(base({ name: 'My backups', region: 'eu-west-1' }));
    fireEvent.click(screen.getByTestId('s3-pick-bucket'));
    fireEvent.click(await screen.findByRole('button', { name: 'alpha-bucket' }));
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. bucket-name or bucket-name/folder (default: /)')).toHaveValue('alpha-bucket'));
    expect(screen.getByPlaceholderText('e.g. Backup Bucket')).toHaveValue('My backups');
    expect(screen.getAllByPlaceholderText('us-east-1')[0]).toHaveValue('eu-west-1');
    expect(screen.getByText(/could not be told/)).toBeInTheDocument();
  });

  it('is not offered for access keys', () => {
    renderForm(base({ authMode: 'static' }));
    expect(screen.queryByTestId('s3-pick-bucket')).toBeNull();
  });
});
