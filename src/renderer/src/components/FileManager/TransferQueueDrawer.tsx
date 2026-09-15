import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Trash2, X } from 'lucide-react';
import type { TransferProgress } from '@shared/types/storage';
import { classNames, formatBytes, formatSpeed } from '../../lib/format';

const STATUS_LABEL: Record<TransferProgress['status'], string> = {
  pending: 'Väntar',
  running: 'Pågår',
  paused: 'Pausad',
  completed: 'Klar',
  failed: 'Misslyckades',
  cancelled: 'Avbruten',
};

const STATUS_COLOR: Record<TransferProgress['status'], string> = {
  pending: 'bg-slate-500',
  running: 'bg-sky-500',
  paused: 'bg-amber-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  cancelled: 'bg-slate-600',
};

export const TransferQueueDrawer: React.FC = () => {
  const [jobs, setJobs] = useState<TransferProgress[]>([]);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let mounted = true;
    void window.multissh.transferGetJobs().then((initial) => {
      if (mounted) setJobs(initial);
    });

    const unsubscribe = window.multissh.onTransferProgress((progress) => {
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.jobId === progress.jobId);
        if (idx === -1) return [...prev, progress];
        const next = [...prev];
        next[idx] = progress;
        return next;
      });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const activeCount = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;

  return (
    <div className="flex flex-col border-t border-slate-700 bg-slate-800">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
      >
        <span>
          Överföringar {activeCount > 0 ? `(${activeCount} aktiva)` : ''}
        </span>
        <span className="flex items-center gap-2">
          {jobs.some((j) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') && (
            <button
              type="button"
              title="Rensa klara"
              onClick={(e) => {
                e.stopPropagation();
                void window.multissh.transferClearCompleted().then(() =>
                  setJobs((prev) => prev.filter((j) => j.status === 'running' || j.status === 'pending' || j.status === 'paused'))
                );
              }}
              className="rounded p-0.5 hover:bg-slate-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="max-h-48 overflow-y-auto px-3 pb-2">
          {jobs.length === 0 && <div className="py-3 text-center text-xs text-slate-500">Inga överföringar</div>}
          {jobs.map((job) => (
            <div key={job.jobId} className="flex items-center gap-2 border-b border-slate-700/50 py-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-200">{job.fileName}</span>
                  <span className="shrink-0 text-slate-400">
                    {formatBytes(job.transferredBytes)} / {formatBytes(job.totalBytes)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
                  <div
                    className={classNames('h-full rounded-full transition-all', STATUS_COLOR[job.status])}
                    style={{ width: `${Math.min(100, Math.max(0, job.percentage))}%` }}
                  />
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{STATUS_LABEL[job.status]}{job.error ? `: ${job.error}` : ''}</span>
                  {job.status === 'running' && <span>{formatSpeed(job.bytesPerSecond)}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {job.status === 'running' && (
                  <button
                    type="button"
                    title="Pausa"
                    onClick={() => void window.multissh.transferPause(job.jobId)}
                    className="rounded p-1 text-slate-300 hover:bg-slate-600"
                  >
                    <Pause className="h-3.5 w-3.5" />
                  </button>
                )}
                {job.status === 'paused' && (
                  <button
                    type="button"
                    title="Återuppta"
                    onClick={() => void window.multissh.transferResume(job.jobId)}
                    className="rounded p-1 text-slate-300 hover:bg-slate-600"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                )}
                {(job.status === 'running' || job.status === 'pending' || job.status === 'paused') && (
                  <button
                    type="button"
                    title="Avbryt"
                    onClick={() => void window.multissh.transferCancel(job.jobId)}
                    className="rounded p-1 text-red-400 hover:bg-slate-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TransferQueueDrawer;
