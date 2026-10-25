import { describe, it, expect } from 'vitest';
import { parsePolicyObject, parseRegQueryOutput, registryValuesToRaw } from '../../src/main/policy/policyParse';
import { POLICY_DEFINITIONS, policyRegistryName } from '../../src/shared/types/policy';

describe('parsePolicyObject', () => {
  it('accepts valid settings and features', () => {
    const { policy, warnings } = parsePolicyObject({
      autoCheckUpdates: false,
      smartcardAuthMode: 'always-prompt',
      x11ServerArgs: ':0 -multiwindow',
      gitKeyFetch: false,
    });
    expect(warnings).toEqual([]);
    expect(policy.settings).toEqual({
      autoCheckUpdates: false,
      smartcardAuthMode: 'always-prompt',
      x11ServerArgs: ':0 -multiwindow',
    });
    expect(policy.features).toEqual({ gitKeyFetch: false });
  });

  it('drops unknown keys and wrong types but keeps the rest', () => {
    const { policy, warnings } = parsePolicyObject({
      autoCheckUpdates: 'no',
      smartcardAuthMode: 'forever',
      enableOpenShift: true,
      theme: 'dark',
    });
    expect(policy.settings).toEqual({ enableOpenShift: true });
    expect(warnings).toHaveLength(3);
    expect(warnings.join(' ')).toContain('Unknown policy "theme"');
  });

  it('rejects strings with control characters or over the length limit', () => {
    expect(parsePolicyObject({ x11ServerArgs: 'a\nb' }).policy.settings).toEqual({});
    expect(parsePolicyObject({ x11ServerArgs: 'a'.repeat(1025) }).policy.settings).toEqual({});
  });

  it.each([null, 'text', 5, [1, 2]])('rejects a non-object policy (%j)', (raw) => {
    const { policy, warnings } = parsePolicyObject(raw);
    expect(policy).toEqual({ settings: {}, features: {} });
    expect(warnings).toHaveLength(1);
  });

  it('does not let __proto__ keys reach the policy', () => {
    const { policy } = parsePolicyObject(JSON.parse('{"__proto__":{"autoCheckUpdates":false}}'));
    expect(policy.settings).toEqual({});
    expect(({} as Record<string, unknown>).autoCheckUpdates).toBeUndefined();
  });
});

describe('registry parsing', () => {
  const output = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\sshs3',
    '    AutoCheckUpdates    REG_DWORD    0x0',
    '    SmartcardAuthMode    REG_SZ    always-prompt',
    '    X11ServerArgs    REG_SZ    :0 -multiwindow -clipboard',
    '    Other    REG_BINARY    00',
    '',
  ].join('\r\n');

  it('reads DWORD and string values and skips other types', () => {
    expect(parseRegQueryOutput(output)).toEqual({
      AutoCheckUpdates: 0,
      SmartcardAuthMode: 'always-prompt',
      X11ServerArgs: ':0 -multiwindow -clipboard',
    });
  });

  it('maps registry names to ids, DWORD to boolean, and passes unknown names through', () => {
    const raw = registryValuesToRaw({ AutoCheckUpdates: 0, EnableOpenShift: 1, smartcardauthmode: 'agent-global', Bogus: 1 });
    expect(raw).toEqual({ autoCheckUpdates: false, enableOpenShift: true, smartcardAuthMode: 'agent-global', Bogus: 1 });
    const { policy, warnings } = parsePolicyObject(raw);
    expect(policy.settings.autoCheckUpdates).toBe(false);
    expect(warnings).toEqual(['Unknown policy "Bogus" ignored.']);
  });

  it('derives registry names from ids', () => {
    expect(policyRegistryName('autoCheckUpdates')).toBe('AutoCheckUpdates');
    expect(new Set(POLICY_DEFINITIONS.map((d) => policyRegistryName(d.id))).size).toBe(POLICY_DEFINITIONS.length);
  });
});
