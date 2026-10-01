import { describe, expect, it } from 'vitest';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';
import {
  resolveProxyJumpTarget,
  withResolvedProxyJump,
} from '../../src/main/ssh/resolveProxyJump';

describe('resolveProxyJump', () => {
  const profiles: Record<string, SSHConnectionConfig> = {
    bastion1: {
      id: 'bastion1',
      name: 'Bastion 1',
      host: 'bastion.example.com',
      port: 22,
      username: 'jumpuser',
      authType: 'password',
    } as SSHConnectionConfig,
    bastionCustomPort: {
      id: 'bastionCustomPort',
      name: 'Bastion Custom Port',
      host: 'jump.example.com',
      port: 2222,
      username: 'admin',
      authType: 'password',
    } as SSHConnectionConfig,
    bastionNoPort: {
      id: 'bastionNoPort',
      name: 'Bastion No Port',
      host: 'noport.example.com',
      username: 'root',
      authType: 'password',
    } as SSHConnectionConfig,
  };

  const getProfile = (id: string) => profiles[id];

  describe('resolveProxyJumpTarget', () => {
    it('resolves jump host with standard port 22 without appending port', () => {
      const target = resolveProxyJumpTarget({ proxyJumpProfileId: 'bastion1' }, getProfile);
      expect(target).toBe('jumpuser@bastion.example.com');
    });

    it('resolves jump host with custom port by appending :port', () => {
      const target = resolveProxyJumpTarget({ proxyJumpProfileId: 'bastionCustomPort' }, getProfile);
      expect(target).toBe('admin@jump.example.com:2222');
    });

    it('resolves jump host with undefined port without appending port', () => {
      const target = resolveProxyJumpTarget({ proxyJumpProfileId: 'bastionNoPort' }, getProfile);
      expect(target).toBe('root@noport.example.com');
    });

    it('falls back to raw proxyJump string if profileId is not found', () => {
      const target = resolveProxyJumpTarget(
        { proxyJumpProfileId: 'nonexistent', proxyJump: '  backup.jump.net:2220  ' },
        getProfile
      );
      expect(target).toBe('backup.jump.net:2220');
    });

    it('returns raw proxyJump string when no profileId is provided', () => {
      const target = resolveProxyJumpTarget({ proxyJump: ' direct-jump.org ' }, getProfile);
      expect(target).toBe('direct-jump.org');
    });

    it('returns undefined if proxyJump string is empty or only whitespace', () => {
      expect(resolveProxyJumpTarget({ proxyJump: '' }, getProfile)).toBeUndefined();
      expect(resolveProxyJumpTarget({ proxyJump: '   ' }, getProfile)).toBeUndefined();
      expect(resolveProxyJumpTarget({}, getProfile)).toBeUndefined();
    });
  });

  describe('withResolvedProxyJump', () => {
    it('returns original config untouched if no proxyJump settings exist', () => {
      const config = { host: 'target.com', username: 'app', proxyJump: undefined };
      const result = withResolvedProxyJump(config, getProfile);
      expect(result).toBe(config);
    });

    it('resolves proxyJumpProfileId and strips proxyJumpProfileId from result', () => {
      const config = {
        host: 'internal.corp',
        username: 'dev',
        proxyJumpProfileId: 'bastionCustomPort',
      };
      const result = withResolvedProxyJump(config, getProfile);
      expect(result).toEqual({
        host: 'internal.corp',
        username: 'dev',
        proxyJump: 'admin@jump.example.com:2222',
        proxyJumpProfileId: undefined,
      });
      expect(result).not.toBe(config);
    });

    it('preserves and trims raw proxyJump and sets proxyJumpProfileId to undefined', () => {
      const config = {
        host: 'internal.corp',
        username: 'dev',
        proxyJump: '  gate.corp.net:2222  ',
      };
      const result = withResolvedProxyJump(config, getProfile);
      expect(result).toEqual({
        host: 'internal.corp',
        username: 'dev',
        proxyJump: 'gate.corp.net:2222',
        proxyJumpProfileId: undefined,
      });
    });
  });
});
