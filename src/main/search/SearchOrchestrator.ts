import type { StorageRegistry } from '../storage/StorageRegistry';
import { RemoteSearchService } from './RemoteSearchService';
import { S3ContentSearchService } from './S3ContentSearchService';
import { LocalContentSearchService } from './LocalContentSearchService';
import { S3StorageProvider } from '../storage/S3StorageProvider';
import { LocalStorageProvider } from '../storage/LocalStorageProvider';
import type {
  SearchDoneEvent,
  SearchErrorEvent,
  SearchPreviewResult,
  SearchProgressEvent,
  SearchResultEvent,
  SearchStartOptions,
} from '../../shared/types/search';

/**
 * Picks the right backend for a search by `sourceType` and gives every caller
 * (IpcBridge) a single entry point, regardless of which storage backend a given
 * search actually runs against.
 */
export class SearchOrchestrator {
  private remoteSearchService = new RemoteSearchService();
  private s3ContentSearchService = new S3ContentSearchService();
  private localContentSearchService = new LocalContentSearchService();

  public async startSearch(
    storageRegistry: StorageRegistry,
    options: SearchStartOptions,
    onResult: (event: SearchResultEvent) => void,
    onError: (event: SearchErrorEvent) => void,
    onDone: (event: SearchDoneEvent) => void,
    onProgress?: (event: SearchProgressEvent) => void
  ): Promise<{ searchId: string }> {
    switch (options.sourceType) {
      case 'sftp':
        return this.remoteSearchService.startSearch(storageRegistry, options, onResult, onError, onDone, onProgress);
      case 's3':
        return this.s3ContentSearchService.startSearch(storageRegistry, options, onResult, onError, onDone, onProgress);
      case 'local':
        return this.localContentSearchService.startSearch(storageRegistry, options, onResult, onError, onDone, onProgress);
      default:
        throw new Error(`Unsupported search source type: ${(options as SearchStartOptions).sourceType}`);
    }
  }

  public cancelSearch(searchId: string): void {
    this.remoteSearchService.cancelSearch(searchId);
    this.s3ContentSearchService.cancelSearch(searchId);
    this.localContentSearchService.cancelSearch(searchId);
  }

  public async previewLines(
    storageRegistry: StorageRegistry,
    providerId: string,
    remotePath: string,
    lineNumber: number,
    contextLines: number
  ): Promise<SearchPreviewResult> {
    const provider = storageRegistry.get(providerId);
    if (provider instanceof S3StorageProvider) {
      return this.s3ContentSearchService.previewLines(storageRegistry, providerId, remotePath, lineNumber, contextLines);
    }
    if (provider instanceof LocalStorageProvider) {
      return this.localContentSearchService.previewLines(storageRegistry, providerId, remotePath, lineNumber, contextLines);
    }
    return this.remoteSearchService.previewLines(storageRegistry, providerId, remotePath, lineNumber, contextLines);
  }

  public dispose(): void {
    this.remoteSearchService.dispose();
    this.s3ContentSearchService.dispose();
    this.localContentSearchService.dispose();
  }
}
