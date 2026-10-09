import { describe, it, expect } from 'vitest';
import { buildTeamVaultJoinInfo, parseTeamVaultJoinInfo } from '../../src/renderer/src/lib/teamVaultJoinInfo';

describe('buildTeamVaultJoinInfo / parseTeamVaultJoinInfo', () => {
  const RECIPIENT = 'age1yubikey1qtcxzz6mxwnfxnf20a73grajw82psjfam6q3w68tentulrhcp3lwkcxxy7t';

  it('round-trips a built join string', () => {
    const joinInfo = buildTeamVaultJoinInfo('alice@piv:yubikey-1', RECIPIENT);
    expect(parseTeamVaultJoinInfo(joinInfo)).toEqual({
      recipientId: 'alice@piv:yubikey-1',
      ageRecipient: RECIPIENT,
    });
  });

  it('tolerates being pasted alongside extra chat text and whitespace', () => {
    const pasted = `Hey! Here's my join info, let me know if you need anything else:\n\n   ${buildTeamVaultJoinInfo('bob@piv:x', RECIPIENT)}\n\nThanks!`;
    expect(parseTeamVaultJoinInfo(pasted)).toEqual({ recipientId: 'bob@piv:x', ageRecipient: RECIPIENT });
  });

  it('is case-insensitive on the field labels', () => {
    const pasted = `RecipientID: carol@piv:y\nAGERECIPIENT: ${RECIPIENT}`;
    expect(parseTeamVaultJoinInfo(pasted)).toEqual({ recipientId: 'carol@piv:y', ageRecipient: RECIPIENT });
  });

  it('returns null when no age1yubikey1... recipient can be found', () => {
    expect(parseTeamVaultJoinInfo('recipientId: alice@piv:x\nageRecipient: not-a-real-recipient')).toBeNull();
  });

  it('returns null when no recipientId can be found', () => {
    expect(parseTeamVaultJoinInfo(`just this: ${RECIPIENT}`)).toBeNull();
  });

  it('returns null for empty or unrelated input', () => {
    expect(parseTeamVaultJoinInfo('')).toBeNull();
    expect(parseTeamVaultJoinInfo('hello world')).toBeNull();
  });
});
