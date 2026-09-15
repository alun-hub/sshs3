import { LocalStorageProvider } from './LocalStorageProvider';
import { SFTPStorageProvider } from './SFTPStorageProvider';
import { S3StorageProvider } from './S3StorageProvider';
import type { IStorageProvider } from '../../shared/types/storage';
import type { StorageConnectConfig } from '../../shared/types/ipc';

export class StorageRegistry {
  private providers: Map<string, IStorageProvider> = new Map();

  /**
   * Returns an existing provider or instantiates and stores a new one.
   */
  public async getOrCreate(config: StorageConnectConfig): Promise<IStorageProvider> {
    if (!config || !config.id) {
      throw new Error('Storage config must have an id');
    }

    const existing = this.providers.get(config.id);
    if (existing) {
      return existing;
    }

    let provider: IStorageProvider;

    switch (config.type) {
      case 'local': {
        provider = new LocalStorageProvider({
          id: config.id,
          name: config.name || 'Local Storage',
          basePath: config.localBasePath,
        });
        break;
      }
      case 'sftp': {
        if (!config.sftpConfig) {
          throw new Error(`SFTP config is required for provider "${config.id}"`);
        }
        provider = new SFTPStorageProvider({
          ...config.sftpConfig,
          id: config.id,
          name: config.name || config.sftpConfig.name,
        });
        break;
      }
      case 's3': {
        if (!config.s3Config) {
          throw new Error(`S3 config is required for provider "${config.id}"`);
        }
        provider = new S3StorageProvider({
          ...config.s3Config,
          id: config.id,
          name: config.name || config.s3Config.name,
        });
        break;
      }
      default: {
        throw new Error(`Unsupported storage type: ${(config as any).type}`);
      }
    }

    this.providers.set(config.id, provider);
    return provider;
  }

  /**
   * Retrieves a provider by id.
   */
  public get(id: string): IStorageProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Checks if a provider exists.
   */
  public has(id: string): boolean {
    return this.providers.has(id);
  }

  /**
   * Registers a provider directly (useful for tests or custom providers).
   */
  public register(provider: IStorageProvider): void {
    if (!provider || !provider.id) {
      throw new Error('Provider must have an id');
    }
    this.providers.set(provider.id, provider);
  }

  /**
   * Returns all active providers.
   */
  public getAll(): IStorageProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Disconnects and removes a single provider.
   */
  public async disconnect(id: string): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) return;

    if (typeof provider.disconnect === 'function') {
      try {
        await provider.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      }
    }

    this.providers.delete(id);
  }

  /**
   * Disconnects and cleans up all active providers.
   */
  public async disconnectAll(): Promise<void> {
    const allProviders = Array.from(this.providers.values());
    for (const provider of allProviders) {
      if (typeof provider.disconnect === 'function') {
        try {
          await provider.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
    }
    this.providers.clear();
  }
}
