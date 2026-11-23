// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { S3ProfileForm } from '../../src/renderer/src/components/ConnectionModal/S3ProfileForm';
import { SyncTargetForm, emptySyncTargetDraft } from '../../src/renderer/src/components/SettingsModal/SyncTargetForm';
import { AwsEnabledContext } from '../../src/renderer/src/lib/awsEnabled';
import type { S3Config } from '../../src/shared/types/storage';

beforeEach(() => {
  window.multissh = {
    awsSsoStatus: vi.fn(async () => ({ status: 'missing' })),
    awsSsoListSignIns: vi.fn(async () => []),
    awsSsoListAccountsCached: vi.fn(async () => []),
    awsSsoListRolesCached: vi.fn(async () => []),
    profilesGet: vi.fn(async () => ({ ssh: [], s3: [] })),
    policyGet: vi.fn(async () => ({ managed: [], features: {}, warnings: [] })),
  } as never;
});
afterEach(() => cleanup());

const s3 = (authMode: 'static' | 'sso'): S3Config =>
  ({ id: 's3-1', name: '', region: 'us-east-1', authMode, accessKeyId: '', secretAccessKey: '', forcePathStyle: false, ssl: true, rejectUnauthorized: true, sso: { startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1' } }) as S3Config;

const renderS3 = (enabled: boolean, initial?: S3Config) =>
  render(<AwsEnabledContext.Provider value={enabled}><S3ProfileForm initial={initial} onSave={vi.fn()} onCancel={vi.fn()} /></AwsEnabledContext.Provider>);

describe('S3 profile form: AWS SSO toggle gated by the AWS switch', () => {
  it('is hidden for a new profile while AWS features are off', () => {
    renderS3(false);
    expect(screen.queryByRole('button', { name: 'AWS SSO' })).toBeNull();
    expect(screen.getByText('Access Key ID')).toBeInTheDocument();
  });
  it('is shown when AWS features are on', () => {
    renderS3(true);
    expect(screen.getByRole('button', { name: 'AWS SSO' })).toBeInTheDocument();
  });
  it('keeps an SSO profile editable and says AWS is off', () => {
    renderS3(false, s3('sso'));
    expect(screen.getByRole('button', { name: 'AWS SSO' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Settings → AWS');
  });
});

describe('Sync target form: AWS SSO toggle gated by the AWS switch', () => {
  const renderSync = (enabled: boolean, authMode: 'static' | 'sso') => {
    const draft = { ...emptySyncTargetDraft(), type: 's3' as const, authMode };
    return render(<AwsEnabledContext.Provider value={enabled}><SyncTargetForm draft={draft} onChange={vi.fn()} /></AwsEnabledContext.Provider>);
  };
  it('is hidden for a static target while AWS features are off', () => {
    renderSync(false, 'static');
    expect(screen.queryByRole('button', { name: /^AWS SSO \(Identity Center\)$/ })).toBeNull();
  });
  it('is shown when AWS features are on', () => {
    renderSync(true, 'static');
    expect(screen.getByRole('button', { name: /^AWS SSO \(Identity Center\)$/ })).toBeInTheDocument();
  });
  it('is kept for an SSO target while AWS features are off', () => {
    renderSync(false, 'sso');
    expect(screen.getByRole('button', { name: /^AWS SSO \(Identity Center\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Settings → AWS');
  });
});
