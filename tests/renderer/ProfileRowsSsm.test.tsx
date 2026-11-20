// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SsmBadge } from '../../src/renderer/src/components/ConnectionModal/SsmBadge';
import { authSuffix, profileTarget } from '../../src/renderer/src/lib/ssmProfile';

afterEach(() => cleanup());

describe('SsmBadge', () => {
  it('shows SSM, SSM shell, or nothing', () => {
    const { container, rerender } = render(<SsmBadge profile={{}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SsmBadge profile={{ ssm: { enabled: true } }} />);
    expect(screen.getByText('SSM')).toBeInTheDocument();
    rerender(<SsmBadge profile={{ ssm: { enabled: true, mode: 'shell' } }} />);
    expect(screen.getByText('SSM shell')).toBeInTheDocument();
  });
});

describe('profileTarget (row subtitle, also used by Team Vault rows)', () => {
  const p = { username: 'ec2-user', host: 'i-0ad31346f0f634f39', port: 22, authType: 'password' as const };
  it('does not show a login or "password" for a Session Manager shell, but keeps them for SSH over SSM and plain profiles', () => {
    const shell = { ...p, ssm: { enabled: true as const, mode: 'shell' as const } };
    expect(profileTarget(shell, authSuffix(shell))).toBe('Session Manager shell · i-0ad31346f0f634f39');
    const overSsh = { ...p, ssm: { enabled: true as const } };
    expect(profileTarget(overSsh, authSuffix(overSsh))).toBe('ec2-user@i-0ad31346f0f634f39:22 · password');
    expect(profileTarget(p, authSuffix(p))).toBe('ec2-user@i-0ad31346f0f634f39:22 · password');
  });
});
