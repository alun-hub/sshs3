import type { SSHConnectionConfig } from './types/ssh';
import type { SFTPConfig } from './types/storage';

/** Fields every SFTP connection copies from its SSH profile. */
const MAPPED = [
  'id', 'name', 'host', 'port', 'username', 'authType', 'password', 'privateKeyPath', 'passphrase',
  'agentPath', 'useSshCa', 'pkcs11LibPath', 'fido2Resident', 'initialPath', 'proxy', 'proxyJump', 'proxyJumpProfileId', 'ssm',
] as const;

/**
 * Fields both types have that are deliberately NOT copied (today's behaviour: runtime-only values filled in by the
 * main process, UI metadata, or transport tuning the SFTP path never received). Listed so that adding a field to
 * both types fails the exhaustiveness check below until someone decides which list it belongs to.
 */
const NOT_COPIED = [
  'teamVaultProfileRef', 'pin', 'certificateFile', 'agentIdentityFiles', 'group', 'lastUsedAt',
  'compression', 'serverAliveInterval', 'ciphers', 'kexAlgorithms', 'macs', 'forwardAgent',
] as const;

type Shared = keyof SSHConnectionConfig & keyof SFTPConfig;
type Decided = (typeof MAPPED)[number] | (typeof NOT_COPIED)[number];
// Compile-time parity: a field present in both types that is in neither list above makes this a type error.
export const SFTP_NOT_COPIED_FIELDS: readonly string[] = NOT_COPIED;
export const SFTP_FIELD_PARITY: Exclude<Shared, Decided> extends never ? true : never = true;

export const SFTP_MAPPED_FIELDS: readonly string[] = MAPPED;

/** The SFTP connection config for an SSH profile (one mapping for every caller), with optional overrides. */
export function toSftpConfig(profile: SSHConnectionConfig, overrides: Partial<SFTPConfig> = {}): SFTPConfig {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    port: profile.port ?? 22,
    username: profile.username,
    authType: profile.authType,
    password: profile.password,
    privateKeyPath: profile.privateKeyPath,
    passphrase: profile.passphrase,
    agentPath: profile.agentPath,
    useSshCa: profile.useSshCa,
    pkcs11LibPath: profile.pkcs11LibPath,
    fido2Resident: profile.fido2Resident,
    initialPath: profile.initialPath,
    proxy: profile.proxy,
    proxyJump: profile.proxyJump,
    proxyJumpProfileId: profile.proxyJumpProfileId,
    ssm: profile.ssm,
    ...overrides,
  };
}
