import { execFile } from 'node:child_process';
import path from 'node:path';
import type { IStorageProvider } from '../../shared/types/storage';
import { isMissingPathError } from '../ipc/ipcHelpers';
import { LocalStorageProvider } from '../storage/LocalStorageProvider';
import { SFTPStorageProvider } from '../storage/SFTPStorageProvider';
import { detectArchiveKind, stripArchiveExtension } from '../../shared/archiveNames';
import {
  archiveExtension,
  buildCompressCommand,
  buildExtractCommand,
  defaultArchiveBaseName,
  isSafeSegment,
  pickFreeName,
  summarizeExecError,
  toShellCommand,
  type ArchiveCommand,
  type ArchiveFormat,
} from './archiveCommands';

/** Where archive commands run: this machine (spawned directly) or an SFTP host (one quoted shell line over ssh). */
interface ArchiveTarget {
  /** Absolute path in the target's own syntax. */
  resolve(p: string): Promise<string>;
  join(dir: string, name: string): string;
  dirname(p: string): string;
  basename(p: string): string;
  run(command: ArchiveCommand): Promise<void>;
  platform: NodeJS.Platform;
}

function execLocal(command: ArchiveCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command.file, command.args, { cwd: command.cwd, maxBuffer: 1024 * 1024, windowsHide: true }, (err, _stdout, stderr) => {
      if (!err) return resolve();
      // stderr is what tar/zip/unzip complain about; ENOENT (tool missing) has none, so fall back to the error text.
      reject(new Error(stderr.trim() || summarizeExecError(err, `${command.file} failed`)));
    });
  });
}

function targetFor(provider: IStorageProvider): ArchiveTarget {
  if (provider instanceof LocalStorageProvider) {
    return {
      resolve: async (p) => provider.resolvePath(p),
      join: (dir, name) => path.join(dir, name),
      dirname: (p) => path.dirname(p),
      basename: (p) => path.basename(p),
      run: execLocal,
      platform: process.platform,
    };
  }
  if (provider instanceof SFTPStorageProvider) {
    return {
      resolve: (p) => provider.resolveRemotePath(p),
      join: (dir, name) => path.posix.join(dir, name),
      dirname: (p) => path.posix.dirname(p),
      basename: (p) => path.posix.basename(p),
      run: async (command) => {
        try {
          await provider.exec(toShellCommand(command));
        } catch (err) {
          throw new Error(summarizeExecError(err, `${command.file} failed on the remote host`), { cause: err });
        }
      },
      // Remote hosts are POSIX; only the zip tool differs from the local default.
      platform: 'linux',
    };
  }
  throw new Error('Archives are only supported on local disks and SFTP connections');
}

async function pathExists(provider: IStorageProvider, absPath: string): Promise<boolean> {
  try {
    await provider.stat(absPath);
    return true;
  } catch (err) {
    if (isMissingPathError(err)) return false;
    throw err;
  }
}

/** Packs `names` (children of `parentDir`) into a new archive next to them; returns the archive's file name. */
export async function compressEntries(
  provider: IStorageProvider,
  parentDir: string,
  names: string[],
  format: ArchiveFormat
): Promise<string> {
  if (names.length === 0 || !names.every(isSafeSegment)) throw new Error('Invalid file names');
  const target = targetFor(provider);
  const dir = await target.resolve(parentDir);
  const archiveName = await pickFreeName(defaultArchiveBaseName(names), archiveExtension(format), (candidate) =>
    pathExists(provider, target.join(dir, candidate))
  );
  const command = buildCompressCommand(format, dir, names, target.join(dir, archiveName), target.platform);
  await target.run(command);
  return archiveName;
}

/** Unpacks an archive into a new folder named after it, beside it; returns the folder's name. */
export async function extractArchive(provider: IStorageProvider, archivePath: string): Promise<string> {
  const target = targetFor(provider);
  const absArchive = await target.resolve(archivePath);
  const archiveFile = target.basename(absArchive);
  const kind = detectArchiveKind(archiveFile);
  if (!kind) throw new Error('Not a supported archive (.zip, .tar, .tar.gz, .tgz, .tar.bz2, .tar.xz)');
  const parent = target.dirname(absArchive);
  const folderName = await pickFreeName(stripArchiveExtension(archiveFile), '', (candidate) =>
    pathExists(provider, target.join(parent, candidate))
  );
  const destDir = target.join(parent, folderName);
  await provider.createFolder(destDir);
  await target.run(buildExtractCommand(kind, absArchive, destDir, target.platform));
  return folderName;
}
