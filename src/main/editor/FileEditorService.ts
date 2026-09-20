import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { shell as electronShell } from 'electron';
import type { StorageRegistry } from '../storage/StorageRegistry';
import { LocalStorageProvider } from '../storage/LocalStorageProvider';
import { formatDate } from '../storage/StorageProvider';
import type { FileReadResult, ExternalFileStatusEvent } from '../../shared/types/ipc';

export interface ExternalEditorSession {
  sessionToken: string;
  providerId: string;
  remotePath: string;
  tempDir?: string;
  tempFilePath: string;
  watcher?: fs.FSWatcher;
  debounceTimer?: NodeJS.Timeout;
}

export interface ShellOpener {
  openPath(path: string): Promise<string> | any;
}

export interface FileEditorServiceOptions {
  shell?: ShellOpener;
  baseTempDir?: string;
}

export class FileEditorService {
  private shell: ShellOpener;
  private baseTempDir: string;
  private sessions = new Map<string, ExternalEditorSession>();

  constructor(options: FileEditorServiceOptions = {}) {
    this.shell = options.shell ?? electronShell;
    this.baseTempDir = options.baseTempDir ?? path.join(os.tmpdir(), 'sshs3-editor');
  }

  /**
   * Reads up to maxBytes from the specified storage provider.
   * Detects binary content (null bytes in first 8KB) and reports truncation.
   */
  public async readFile(
    storageRegistry: StorageRegistry,
    providerId: string,
    remotePath: string,
    maxBytes: number = 5 * 1024 * 1024
  ): Promise<FileReadResult> {
    const provider = storageRegistry.get(providerId);
    if (!provider) {
      throw new Error(`Storage provider not found: ${providerId}`);
    }

    const stream = await provider.createReadStream(remotePath);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        if (totalBytes + chunk.length > maxBytes) {
          const remaining = maxBytes - totalBytes;
          if (remaining > 0) {
            chunks.push(chunk.subarray(0, remaining));
            totalBytes += remaining;
          }
          truncated = true;
          if ('destroy' in stream && typeof (stream as any).destroy === 'function') {
            (stream as any).destroy();
          }
          resolve();
        } else {
          chunks.push(chunk);
          totalBytes += chunk.length;
        }
      });
      stream.on('end', () => resolve());
      stream.on('error', (err) => {
        if (truncated) {
          resolve();
        } else {
          reject(err);
        }
      });
    });

    const fullBuffer = Buffer.concat(chunks);
    const checkLength = Math.min(fullBuffer.length, 8000);
    let isBinary = false;
    for (let i = 0; i < checkLength; i++) {
      if (fullBuffer[i] === 0) {
        isBinary = true;
        break;
      }
    }

    return {
      content: isBinary ? '' : fullBuffer.toString('utf-8'),
      size: totalBytes,
      isBinary,
      truncated,
    };
  }

  /**
   * Writes utf-8 text content to the specified storage provider.
   */
  public async saveFile(
    storageRegistry: StorageRegistry,
    providerId: string,
    remotePath: string,
    content: string
  ): Promise<void> {
    const provider = storageRegistry.get(providerId);
    if (!provider) {
      throw new Error(`Storage provider not found: ${providerId}`);
    }

    const stream = await provider.createWriteStream(remotePath);
    const buffer = Buffer.from(content, 'utf-8');

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const fail = (err: any) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      stream.once('finish', finish);
      stream.once('close', finish);
      stream.once('error', fail);
      stream.end(buffer);
    });
  }

  /**
   * Opens the file in the OS default application (VS Code, Notepad, etc.).
   * For remote files (SFTP/S3), downloads to a temp folder, launches OS default app,
   * watches for changes via fs.watch, and automatically re-uploads on save.
   */
  public async openInExternalEditor(
    storageRegistry: StorageRegistry,
    providerId: string,
    remotePath: string,
    onStatus?: (event: ExternalFileStatusEvent) => void
  ): Promise<{ sessionToken: string; localPath: string }> {
    const provider = storageRegistry.get(providerId);
    if (!provider) {
      throw new Error(`Storage provider not found: ${providerId}`);
    }

    // Local filesystem: open directly in OS default application
    if (provider.type === 'local' && provider instanceof LocalStorageProvider) {
      const fullPath = provider.resolvePath(remotePath);
      const err = await this.shell.openPath(fullPath);
      if (err) {
        throw new Error(err);
      }
      const sessionToken = crypto.randomUUID();
      const session: ExternalEditorSession = {
        sessionToken,
        providerId,
        remotePath,
        tempFilePath: fullPath,
      };
      this.sessions.set(sessionToken, session);
      return { sessionToken, localPath: fullPath };
    }

    // Remote storage: download to temporary file and watch
    const sessionToken = crypto.randomUUID();
    const tempDir = path.join(this.baseTempDir, sessionToken);
    // mode: 0o700 restricts this to the owning user. On a shared/multi-user
    // machine, the default (umask-derived, typically 0o755) would let any
    // other local user list this directory — defeating the random UUID as a
    // guard, since they could just read the directory name — and then read
    // the downloaded file itself, which may hold sensitive remote content.
    await fsp.mkdir(tempDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      // `mode` on a recursive mkdir isn't guaranteed to tighten a
      // pre-existing baseTempDir (e.g. left over from before this fix, or a
      // shared OS temp dir), so enforce it explicitly on both directories.
      await fsp.chmod(this.baseTempDir, 0o700).catch(() => {});
      await fsp.chmod(tempDir, 0o700).catch(() => {});
    }

    const baseName = path.posix.basename(remotePath) || 'file.txt';
    const tempFilePath = path.join(tempDir, baseName);

    const readStream = await provider.createReadStream(remotePath);
    // mode: 0o600 keeps the downloaded content itself owner-only, matching
    // the containing directory (belt-and-suspenders: directory permissions
    // alone would already block other users, but the file's own mode
    // shouldn't rely on that).
    const writeStream = fs.createWriteStream(tempFilePath, { mode: 0o600 });

    await new Promise<void>((resolve, reject) => {
      readStream.pipe(writeStream);
      writeStream.once('finish', () => resolve());
      writeStream.once('error', reject);
      readStream.once('error', reject);
    });

    const openError = await this.shell.openPath(tempFilePath);
    if (openError) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(openError);
    }

    let debounceTimer: NodeJS.Timeout | undefined;
    let lastMtime = 0;
    try {
      const stats = await fsp.stat(tempFilePath);
      lastMtime = stats.mtimeMs;
    } catch {
      // ignore
    }

    let watcher: fs.FSWatcher | undefined;
    try {
      watcher = fs.watch(tempFilePath, (eventType) => {
        if (eventType === 'change') {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            try {
              const stats = await fsp.stat(tempFilePath);
              if (stats.mtimeMs <= lastMtime) return;
              lastMtime = stats.mtimeMs;

              const content = await fsp.readFile(tempFilePath);
              const uploadStream = await provider.createWriteStream(remotePath);

              await new Promise<void>((resolve, reject) => {
                let settled = false;
                const finish = () => {
                  if (!settled) {
                    settled = true;
                    resolve();
                  }
                };
                const fail = (err: any) => {
                  if (!settled) {
                    settled = true;
                    reject(err);
                  }
                };
                uploadStream.once('finish', finish);
                uploadStream.once('close', finish);
                uploadStream.once('error', fail);
                uploadStream.end(content);
              });

              onStatus?.({
                sessionToken,
                remotePath,
                status: 'uploaded',
                timestamp: formatDate(new Date()),
              });
            } catch (uploadErr) {
              onStatus?.({
                sessionToken,
                remotePath,
                status: 'error',
                error: uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
                timestamp: formatDate(new Date()),
              });
            }
          }, 500);
        }
      });
    } catch {
      // Watcher could not be attached; external editing still succeeds
    }

    const session: ExternalEditorSession = {
      sessionToken,
      providerId,
      remotePath,
      tempDir,
      tempFilePath,
      watcher,
      debounceTimer,
    };
    this.sessions.set(sessionToken, session);

    return { sessionToken, localPath: tempFilePath };
  }

  /**
   * Closes an active external editor session and cleans up temporary files.
   */
  public async closeExternalEditor(sessionToken: string): Promise<void> {
    const session = this.sessions.get(sessionToken);
    if (!session) return;

    if (session.debounceTimer) {
      clearTimeout(session.debounceTimer);
    }
    session.watcher?.close();

    if (session.tempDir) {
      try {
        await fsp.rm(session.tempDir, { recursive: true, force: true });
      } catch {
        // Ignore deletion errors
      }
    }

    this.sessions.delete(sessionToken);
  }

  public getSession(sessionToken: string): ExternalEditorSession | undefined {
    return this.sessions.get(sessionToken);
  }

  public getActiveSessions(): ExternalEditorSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Disposes all active watchers and temporary directories.
   */
  public async dispose(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.debounceTimer) {
        clearTimeout(session.debounceTimer);
      }
      session.watcher?.close();
      if (session.tempDir) {
        try {
          await fsp.rm(session.tempDir, { recursive: true, force: true });
        } catch {
          // Ignore
        }
      }
    }
    this.sessions.clear();
  }
}
