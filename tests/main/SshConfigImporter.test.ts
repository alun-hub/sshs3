import { describe, it, expect } from 'vitest';
import { parseSshConfigContent } from '../../src/main/services/SshConfigImporter';

describe('SshConfigImporter', () => {
  it('parses typical host entries correctly', () => {
    const config = `
# Global config
Host *
  ServerAliveInterval 30

Host web-prod
  HostName 10.0.0.1
  User ubuntu
  Port 2222
  IdentityFile ~/.ssh/id_rsa
  ForwardAgent yes
  Compression yes
  ProxyJump bastion

Host db-staging
  HostName db.staging.internal
  User postgres
  PKCS11Provider /usr/lib/opensc-pkcs11.so
  LocalForward 5432 localhost:5432
`;

    const profiles = parseSshConfigContent(config);
    expect(profiles).toHaveLength(2);

    const web = profiles.find((p) => p.name === 'web-prod');
    expect(web).toBeDefined();
    expect(web?.host).toBe('10.0.0.1');
    expect(web?.username).toBe('ubuntu');
    expect(web?.port).toBe(2222);
    expect(web?.authType).toBe('privateKey');
    expect(web?.privateKeyPath).toContain('.ssh/id_rsa');
    expect(web?.forwardAgent).toBe(true);
    expect(web?.compression).toBe(true);
    expect(web?.proxyJump).toBe('bastion');
    expect(web?.group).toBe('Imported');

    const db = profiles.find((p) => p.name === 'db-staging');
    expect(db).toBeDefined();
    expect(db?.host).toBe('db.staging.internal');
    expect(db?.username).toBe('postgres');
    expect(db?.authType).toBe('smartcard');
    expect(db?.pkcs11LibPath).toBe('/usr/lib/opensc-pkcs11.so');
    expect(db?.tunnels).toHaveLength(1);
    expect(db?.tunnels?.[0].localPort).toBe(5432);
    expect(db?.tunnels?.[0].remotePort).toBe(5432);
  });

  it('skips wildcard host entries', () => {
    const config = `
Host *.example.com
  User test

Host specific.example.com
  HostName specific.example.com
  User dev
`;
    const profiles = parseSshConfigContent(config);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('specific.example.com');
    expect(profiles[0].username).toBe('dev');
  });
});
