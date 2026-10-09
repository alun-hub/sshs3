/** A small, copy-paste-friendly blob a new Team Vault member sends to their admin, carrying the
 * one piece of information that must originate from their own machine (the `age1yubikey1...`
 * recipient string from "Generate my Team Vault ID") alongside their own suggested label. Plain text
 * rather than JSON, so it survives being pasted through chat apps that mangle quotes. */
export interface TeamVaultJoinInfo {
  recipientId: string;
  ageRecipient: string;
}

export function buildTeamVaultJoinInfo(recipientId: string, ageRecipient: string): string {
  return `sshs3 Team Vault join request\nrecipientId: ${recipientId}\nageRecipient: ${ageRecipient}`;
}

/** Tolerant on purpose: admins paste this alongside whatever chat message wrapped it, so this
 * looks for the two fields anywhere in the text rather than requiring an exact match of the
 * whole blob. Returns null if either field can't be found. */
export function parseTeamVaultJoinInfo(text: string): TeamVaultJoinInfo | null {
  const recipientIdMatch = text.match(/recipientid:\s*(\S+)/i);
  const ageRecipientMatch = text.match(/age1[a-z0-9]{20,}/i);
  if (!recipientIdMatch || !ageRecipientMatch) return null;
  return { recipientId: recipientIdMatch[1], ageRecipient: ageRecipientMatch[0] };
}
