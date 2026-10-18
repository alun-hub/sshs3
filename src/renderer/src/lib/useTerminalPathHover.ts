import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Terminal } from 'xterm';
import type { FileEntry } from '@shared/types/storage';
import type { TerminalLinkHandlers } from './terminalLinks';
import { isKnownFilename } from './terminalLinks';
import { resolvePathDetails } from './terminalPathPreview';
import { extractCwdFromPrompt } from './terminalOutput';
import { wslToWindowsPath } from './wslPaths';
import { pathBasename, terminalProviderId, terminalStorageConnectConfig, type TerminalStorageTarget } from './terminalStorage';

const STAT_CACHE_TTL_MS = 5000;
const CONNECT_RETRY_BACKOFF_MS = 30_000;

interface HoverCardData {
  path: string;
  x: number;
  y: number;
}

export interface UseTerminalPathHoverOptions {
  target: TerminalStorageTarget;
  initialCwd?: string;
  /** A WSL shell reports Linux paths that the Windows side must translate before opening them. */
  wsl?: boolean;
  wslDistro?: string;
  pathHoverPreview: boolean;
  onOpenPath?: (path: string) => void;
  termRef: RefObject<Terminal | null>;
  sessionIdRef: RefObject<string | null>;
  notify: (message: string, durationMs?: number) => void;
}

function guessHome(username?: string): string {
  if (username === 'root') return '/root';
  return username ? `/home/${username}` : '';
}

/**
 * Terminal-side file path handling: cwd tracking, the hover preview card and the in-terminal editor.
 * The storage provider for remote hosts is connected lazily, the first time a path is actually
 * inspected, so merely opening a terminal never triggers a second authentication.
 */
export function useTerminalPathHover({
  target,
  initialCwd,
  wsl = false,
  wslDistro,
  pathHoverPreview,
  onOpenPath,
  termRef,
  sessionIdRef,
  notify,
}: UseTerminalPathHoverOptions) {
  const { local, config } = target;
  const targetRef = useRef(target);
  targetRef.current = target;
  const providerId = terminalProviderId(target);
  const toStoragePath = useCallback((p: string) => (wsl ? wslToWindowsPath(p, wslDistro) : p), [wsl, wslDistro]);
  const toStoragePathRef = useRef(toStoragePath);
  toStoragePathRef.current = toStoragePath;
  const onOpenPathRef = useRef(onOpenPath);
  onOpenPathRef.current = onOpenPath;
  const pathHoverPreviewRef = useRef(pathHoverPreview);
  pathHoverPreviewRef.current = pathHoverPreview;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const [hoverCardData, setHoverCardData] = useState<HoverCardData | null>(null);
  const hoverCardDataRef = useRef<HoverCardData | null>(null);
  hoverCardDataRef.current = hoverCardData;
  const hoverDwellTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isMouseOverCardRef = useRef(false);

  const [userHomeDir, setUserHomeDir] = useState<string>(() => guessHome(config?.username) || '/home/user');
  const userHomeDirRef = useRef(userHomeDir);
  userHomeDirRef.current = userHomeDir;
  const [currentCwd, setCurrentCwd] = useState<string>(initialCwd || guessHome(config?.username));
  const currentCwdRef = useRef(currentCwd);
  currentCwdRef.current = currentCwd;

  const [editingFile, setEditingFile] = useState<string | null>(null);
  const editingFileRef = useRef(editingFile);
  editingFileRef.current = editingFile;
  const editorEntry = useMemo<FileEntry | null>(
    () =>
      editingFile
        ? { name: pathBasename(editingFile), path: toStoragePath(editingFile), size: 0, isDirectory: false }
        : null,
    [editingFile, toStoragePath]
  );

  const setCwd = useCallback((dir: string) => {
    currentCwdRef.current = dir;
    setCurrentCwd(dir);
  }, []);

  const applyHome = useCallback((home: string) => {
    userHomeDirRef.current = home;
    setUserHomeDir(home);
    setCurrentCwd((prev) => prev || home);
  }, []);

  /** Updates the cwd from prompt-like text (a title, PTY output). */
  const detectCwdFromText = useCallback(
    (text: string) => {
      const detected = extractCwdFromPrompt(text, userHomeDirRef.current);
      if (detected) setCwd(detected);
    },
    [setCwd]
  );

  const handleOsc7 = useCallback(
    (data: string): boolean => {
      try {
        let p = data;
        if (p.startsWith('file://')) {
          const slashIdx = p.indexOf('/', 7);
          if (slashIdx >= 0) p = p.slice(slashIdx);
        }
        // Windows shells report `file:///C:/Users/me` — drop the slash before the drive letter.
        if (/^\/[A-Za-z]:[\\/]/.test(p)) {
          setCwd(decodeURIComponent(p.slice(1)).replace(/\//g, '\\'));
        } else if (p.startsWith('/')) {
          setCwd(decodeURIComponent(p));
        }
      } catch {
        // Safe to ignore malformed OSC 7
      }
      return true;
    },
    [setCwd]
  );

  // Local shells: the home directory is known immediately.
  useEffect(() => {
    // A WSL shell's home is a Linux path; the Windows home directory would be wrong for it.
    if (!local || wsl) return;
    window.multissh
      ?.getHomeDir?.()
      .then((h) => {
        if (h) applyHome(h);
      })
      .catch(() => {});
  }, [local, wsl, applyHome]);

  // Remote hosts: connect the storage provider on first use and share the in-flight attempt.
  const providerPromiseRef = useRef<{ id: string; promise: Promise<void> } | null>(null);
  // A failed connect (auth, network) is not retried on every hover.
  const connectFailureRef = useRef<{ id: string; at: number; error: unknown } | null>(null);
  const statCacheRef = useRef(new Map<string, { exists: boolean; at: number }>());
  const ensureProvider = useCallback((): Promise<void> => {
    const t = targetRef.current;
    const connectConfig = terminalStorageConnectConfig({ ...t, sessionId: sessionIdRef.current });
    if (!connectConfig || !window.multissh?.connectStorage) return Promise.resolve();
    if (providerPromiseRef.current?.id === connectConfig.id) return providerPromiseRef.current.promise;
    const failure = connectFailureRef.current;
    if (failure?.id === connectConfig.id && Date.now() - failure.at < CONNECT_RETRY_BACKOFF_MS) {
      return Promise.reject(failure.error);
    }
    const promise = window.multissh
      .connectStorage(connectConfig)
      .then(async () => {
        if (!t.local && !t.k8sTarget && window.multissh?.storageGetHomeDir) {
          const home = await window.multissh.storageGetHomeDir(connectConfig.id).catch(() => '');
          if (home) applyHome(home);
        }
      })
      .catch((err) => {
        providerPromiseRef.current = null;
        connectFailureRef.current = { id: connectConfig.id, at: Date.now(), error: err };
        throw err;
      });
    providerPromiseRef.current = { id: connectConfig.id, promise };
    return promise;
  }, [applyHome, sessionIdRef]);

  // A different host/pod means a different provider.
  useEffect(() => {
    providerPromiseRef.current = null;
    statCacheRef.current.clear();
    connectFailureRef.current = null;
  }, [providerId]);

  const refreshCwd = useCallback(async () => {
    let detectedFromPrompt = false;
    const term = termRef.current;
    if (term) {
      const buf = term.buffer.active;
      const cursorLine = buf.baseY + buf.cursorY;
      for (let i = cursorLine; i >= Math.max(0, cursorLine - 8); i--) {
        const text = buf.getLine(i)?.translateToString(true).trim();
        if (!text) continue;
        const detected = extractCwdFromPrompt(text, userHomeDirRef.current);
        if (detected) {
          detectedFromPrompt = true;
          setCwd(detected);
          break;
        }
      }
    }
    const sid = sessionIdRef.current;
    if (sid && local && !detectedFromPrompt && window.multissh?.terminalGetCwd) {
      try {
        const dir = await window.multissh.terminalGetCwd(sid);
        if (dir) setCwd(dir);
      } catch {
        // Safe to ignore
      }
    }
  }, [local, termRef, sessionIdRef, setCwd]);

  /** Local shells report their cwd as soon as the session exists. */
  const onSessionStarted = useCallback(
    (sessionId: string, isDisposed: () => boolean) => {
      if (!local || !window.multissh?.terminalGetCwd) return;
      window.multissh
        .terminalGetCwd(sessionId)
        .then((dir) => {
          if (!isDisposed() && dir) setCwd(dir);
        })
        .catch(() => {});
    },
    [local, setCwd]
  );

  const clearHoverTimers = useCallback(() => {
    clearTimeout(hoverDwellTimerRef.current);
    clearTimeout(hoverLeaveTimerRef.current);
  }, []);

  const dismissCard = useCallback(() => {
    clearHoverTimers();
    isMouseOverCardRef.current = false;
    setHoverCardData(null);
  }, [clearHoverTimers]);

  useEffect(() => {
    if (!pathHoverPreview) dismissCard();
  }, [pathHoverPreview, dismissCard]);

  useEffect(() => clearHoverTimers, [clearHoverTimers]);

  /** Escape closes an open card; returns whether it was consumed. */
  const dismissCardOnEscape = useCallback((): boolean => {
    if (!hoverCardDataRef.current) return false;
    dismissCard();
    return true;
  }, [dismissCard]);

  /** Handlers handed to `registerTerminalLinks`; stable because everything goes through refs. */
  // Hovering sweeps over many bare words; remember recent existence checks instead of stat-ing each time.
  const pathExists = useCallback(async (fullPath: string): Promise<boolean> => {
    const id = terminalProviderId(targetRef.current);
    if (!id || !window.multissh?.storageStat) return true;
    const key = `${id}\0${fullPath}`;
    const cached = statCacheRef.current.get(key);
    if (cached && Date.now() - cached.at < STAT_CACHE_TTL_MS) return cached.exists;
    let exists = true;
    try {
      await window.multissh.storageStat(id, toStoragePathRef.current(fullPath));
    } catch {
      exists = false;
    }
    // A miss caused by a failed connection says nothing about the file.
    if (!exists && connectFailureRef.current) return false;
    if (statCacheRef.current.size > 200) statCacheRef.current.clear();
    statCacheRef.current.set(key, { exists, at: Date.now() });
    return exists;
  }, []);

  const createLinkHandlers = useCallback((): Pick<TerminalLinkHandlers, 'openPath' | 'hoverPath' | 'leavePath'> => {
    const prepare = async (): Promise<void> => {
      // Connect first so the real home directory is known before prompts are parsed against it.
      if (!targetRef.current.local) await ensureProvider().catch(() => {});
      await refreshCwd();
    };
    return {
      openPath: onOpenPathRef.current
        ? async (path) => {
            dismissCard();
            await prepare();
            const details = resolvePathDetails(path, userHomeDirRef.current, currentCwdRef.current);
            onOpenPathRef.current?.(toStoragePathRef.current(details.fullPath));
          }
        : undefined,
      hoverPath: (e, path) => {
        if (!pathHoverPreviewRef.current || isMouseOverCardRef.current) return;
        if (hoverCardDataRef.current?.path === path) return;
        clearHoverTimers();
        const delay = hoverCardDataRef.current ? 500 : 150;
        hoverDwellTimerRef.current = setTimeout(async () => {
          if (!pathHoverPreviewRef.current || isMouseOverCardRef.current) return;
          await prepare();
          const details = resolvePathDetails(path, userHomeDirRef.current, currentCwdRef.current);
          const hasSlash = path.includes('/') || path.includes('\\');
          // Bare tokens without an extension are only previewed when the file really exists.
          if (!hasSlash && !details.extension && !isKnownFilename(details.basename)) {
            if (!(await pathExists(details.fullPath))) return;
          }
          if (!pathHoverPreviewRef.current || isMouseOverCardRef.current) return;
          setHoverCardData({ path, x: e.clientX, y: e.clientY });
        }, delay);
      },
      leavePath: () => {
        clearTimeout(hoverDwellTimerRef.current);
        if (!pathHoverPreviewRef.current || isMouseOverCardRef.current) return;
        hoverLeaveTimerRef.current = setTimeout(() => {
          if (!isMouseOverCardRef.current) setHoverCardData(null);
        }, 400);
      },
    };
  }, [refreshCwd, ensureProvider, dismissCard, clearHoverTimers, pathExists]);

  const openInEditor = useCallback(
    async (p: string) => {
      const id = terminalProviderId(targetRef.current);
      if (!id) return;
      try {
        await ensureProvider();
      } catch (err: any) {
        notifyRef.current(`Failed to open storage: ${err?.message || String(err)}`, 3000);
        return;
      }
      if (window.multissh?.storageStat) {
        try {
          const stat = await window.multissh.storageStat(id, toStoragePathRef.current(p));
          if (stat?.isDirectory) {
            onOpenPathRef.current?.(toStoragePathRef.current(p));
            dismissCard();
            return;
          }
        } catch {
          // Proceed if stat fails
        }
      }
      termRef.current?.blur();
      setEditingFile(p);
      dismissCard();
    },
    [ensureProvider, dismissCard, termRef]
  );

  const [dragOutPath, setDragOutPath] = useState<string | null>(null);
  const requestDragOut = useCallback(
    async (p: string) => {
      try {
        await ensureProvider();
      } catch (err: any) {
        notifyRef.current(`Failed to open storage: ${err?.message || String(err)}`, 3000);
        return;
      }
      termRef.current?.blur();
      setDragOutPath(p);
      dismissCard();
    },
    [ensureProvider, dismissCard, termRef]
  );
  const closeDragOut = useCallback(() => {
    setDragOutPath(null);
    termRef.current?.focus();
  }, [termRef]);

  const closeEditor = useCallback(() => {
    setEditingFile(null);
    termRef.current?.focus();
  }, [termRef]);

  const cardProps = {
    onMouseEnter: () => {
      isMouseOverCardRef.current = true;
      clearHoverTimers();
    },
    onMouseLeave: () => {
      isMouseOverCardRef.current = false;
      hoverLeaveTimerRef.current = setTimeout(() => {
        if (!isMouseOverCardRef.current) setHoverCardData(null);
      }, 300);
    },
    onClose: dismissCard,
    onCopyPath: (p: string) => {
      navigator.clipboard?.writeText(p);
      notifyRef.current(`Copied path: ${p}`, 2000);
      dismissCard();
    },
    onOpenPath: onOpenPath
      ? (p: string) => {
          onOpenPathRef.current?.(toStoragePathRef.current(p));
          dismissCard();
        }
      : undefined,
    onOpenEditor: openInEditor,
    onDragOut: providerId && providerId !== 'local' ? requestDragOut : undefined,
  };

  return {
    hoverCardData: pathHoverPreview ? hoverCardData : null,
    cardProps,
    cardCwd: currentCwdRef.current || currentCwd || initialCwd || userHomeDir,
    userHomeDir,
    providerId,
    toStoragePath,
    editingFile,
    editorEntry,
    isEditorOpen: () => editingFileRef.current !== null,
    closeEditor,
    dragOutPath,
    closeDragOut,
    createLinkHandlers,
    detectCwdFromText,
    handleOsc7,
    onSessionStarted,
    dismissCardOnEscape,
  };
}
