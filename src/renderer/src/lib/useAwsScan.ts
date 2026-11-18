import { useCallback, useEffect, useRef, useState } from 'react';
import type { AwsScanProgress, AwsScanRequest, AwsScanResult } from '@shared/types/awsScan';
import { describeIpcError } from './format';

export type AwsScanPhase = 'idle' | 'running' | 'done' | 'error';

export interface AwsScanState {
  phase: AwsScanPhase;
  progress: AwsScanProgress;
  result?: AwsScanResult;
  error?: string;
  /** The search was stopped by the user; `result` holds what was found until then. */
  cancelled: boolean;
}

const IDLE: AwsScanState = { phase: 'idle', progress: { done: 0, total: 0 }, cancelled: false };

/** Runs a scan in the main process (`awsSsmScan`) with live progress and cancel. */
export function useAwsScan() {
  const [state, setState] = useState<AwsScanState>(IDLE);
  const activeId = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const off = window.multissh?.onAwsSsmScanProgress?.((e) => {
      if (e.scanId === activeId.current) setState((s) => (s.phase === 'running' ? { ...s, progress: { done: e.done, total: e.total } } : s));
    });
    return () => {
      off?.();
      // A scan still running when the dialog closes is stopped; nobody is waiting for it.
      if (activeId.current) void window.multissh?.awsSsmScanCancel?.(activeId.current);
    };
  }, []);

  const start = useCallback(async (request: AwsScanRequest) => {
    const scanId = crypto.randomUUID();
    activeId.current = scanId;
    cancelledRef.current = false;
    setState({ phase: 'running', progress: { done: 0, total: request.targets.length * request.regions.length }, cancelled: false });
    try {
      const result = await window.multissh.awsSsmScan({ scanId, request });
      if (activeId.current === scanId) setState({ phase: 'done', progress: { done: result.searched, total: result.searched }, result, cancelled: cancelledRef.current });
    } catch (err) {
      if (activeId.current === scanId) setState({ phase: 'error', progress: { done: 0, total: 0 }, error: describeIpcError(err, 'The AWS search failed').replace(/^Error:\s*/, ''), cancelled: false });
    } finally {
      if (activeId.current === scanId) activeId.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (!activeId.current) return;
    cancelledRef.current = true;
    void window.multissh.awsSsmScanCancel(activeId.current);
  }, []);

  const reset = useCallback(() => setState(IDLE), []);

  return { state, start, cancel, reset };
}
