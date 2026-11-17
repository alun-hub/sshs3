import { describe, it, expect } from 'vitest';
import { resolveProxyJumpTarget } from '../../../src/main/ssh/resolveProxyJump';
import type { SSHConnectionConfig } from '../../../src/shared/types/ssh';

describe('resolveProxyJumpTarget with SSM profiles', () => {
  it('refuses an SSM profile as jump host instead of emitting an unresolvable -J', () => {
    const jump = { id: 'j', name: 'cloud', host: 'i-0123456789abcdef0', username: 'u', ssm: { enabled: true } } as SSHConnectionConfig;
    expect(() => resolveProxyJumpTarget({ proxyJumpProfileId: 'j' }, () => jump)).toThrow(/AWS SSM/);
    expect(resolveProxyJumpTarget({ proxyJumpProfileId: 'j' }, () => ({ ...jump, ssm: undefined, host: 'h' }))).toBe('u@h');
  });
});
