// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SshSsmFields } from '../../src/renderer/src/components/ConnectionModal/SshSsmFields';
import { AwsEnabledContext } from '../../src/renderer/src/lib/awsEnabled';

beforeEach(() => {
  window.multissh = {
    awsSsmCheckTools: vi.fn(async () => ({ aws: { found: true }, plugin: { found: true, ok: true } })),
    awsSsoStatus: vi.fn(async () => ({ status: 'missing' })),
    policyGet: vi.fn(async () => ({ managed: [], features: {}, warnings: [] })),
  } as never;
});
afterEach(() => cleanup());

const show = (enabled: boolean, ssm?: { enabled: true }) =>
  render(<AwsEnabledContext.Provider value={enabled}><SshSsmFields ssm={ssm} host="" onChange={vi.fn()} /></AwsEnabledContext.Provider>);

describe('SSM section gating by the AWS switch', () => {
  it('is hidden for a new profile while AWS features are off', () => {
    const { container } = show(false);
    expect(container).toBeEmptyDOMElement();
  });
  it('is shown when AWS features are on', () => {
    show(true);
    expect(screen.getByLabelText(/Connect via AWS Systems Manager/)).toBeInTheDocument();
    expect(screen.queryByText(/AWS features are off/)).toBeNull();
  });
  it('keeps an existing SSM profile editable and says where to turn the feature on', () => {
    show(false, { enabled: true });
    expect(screen.getByLabelText(/Connect via AWS Systems Manager/)).toBeChecked();
    expect(screen.getByRole('note')).toHaveTextContent('Settings → AWS');
  });
});
