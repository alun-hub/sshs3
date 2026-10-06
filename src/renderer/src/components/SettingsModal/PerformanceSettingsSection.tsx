import React from 'react';
import { metricApplies, PERF_METRIC_LABELS } from '../../lib/perfMetrics';
import { PERF_INTERVALS_SEC, PERF_K8S_MIN_INTERVAL_SEC, PERF_METRIC_IDS, type PerfLayout } from '@shared/types/perf';
import type { SettingsForm } from './useSettingsForm';

/** The "Performance" page of the settings dialog. */
export const PerformanceSettingsSection: React.FC<{ form: SettingsForm }> = ({ form }) => {
  const {
    perfEnabled,
    setPerfEnabled,
    perfLayout,
    setPerfLayout,
    perfItems,
    setPerfItems,
    perfIntervalSec,
    setPerfIntervalSec,
  } = form;

  return (
    <div className="space-y-4" data-testid="perf-settings">
      <label className="flex items-center gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={perfEnabled}
          onChange={(e) => setPerfEnabled(e.target.checked)}
          data-testid="perf-enabled"
          className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
        />
        <span className="text-xs text-txt-primary">Show performance bar above terminals</span>
      </label>
      <p className="text-xs text-txt-muted">
        SSH: read from /proc on Linux hosts over the open connection. Local shell: this computer.
        Kubernetes: pod metrics from metrics-server (updated about every 15-60 s). Hover the bar for every
        value, click it for up to 15 minutes of history.
      </p>
      {perfEnabled && (
        <div className="space-y-4 pl-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-txt-primary" htmlFor="perf-layout">
                Layout
              </label>
              <select
                id="perf-layout"
                value={perfLayout}
                onChange={(e) => setPerfLayout(e.target.value as PerfLayout)}
                className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
              >
                <option value="text">Compact text</option>
                <option value="bars">Bars</option>
                <option value="sparklines">Sparklines</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-txt-primary" htmlFor="perf-interval">
                Update interval
              </label>
              <select
                id="perf-interval"
                value={perfIntervalSec}
                onChange={(e) => setPerfIntervalSec(Number(e.target.value))}
                className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
              >
                {PERF_INTERVALS_SEC.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec} s{sec < PERF_K8S_MIN_INTERVAL_SEC ? ' (Kubernetes: 10 s)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-txt-primary">Servers and local shell</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5">
              {PERF_METRIC_IDS.filter((id) => metricApplies('ssh', id)).map((id) => (
                <label key={id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={perfItems.includes(id)}
                    onChange={(e) =>
                      setPerfItems((prev) =>
                        e.target.checked
                          ? PERF_METRIC_IDS.filter((m) => m === id || prev.includes(m))
                          : prev.filter((m) => m !== id)
                      )
                    }
                    data-testid={`perf-item-${id}`}
                    className="h-3.5 w-3.5 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                  />
                  <span className="text-xs text-txt-primary">{PERF_METRIC_LABELS[id]}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-txt-primary">Kubernetes pods</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5">
              {PERF_METRIC_IDS.filter((id) => metricApplies('k8s', id)).map((id) => (
                <label key={id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={perfItems.includes(id)}
                    onChange={(e) =>
                      setPerfItems((prev) =>
                        e.target.checked
                          ? PERF_METRIC_IDS.filter((m) => m === id || prev.includes(m))
                          : prev.filter((m) => m !== id)
                      )
                    }
                    data-testid={`perf-k8s-item-${id}`}
                    className="h-3.5 w-3.5 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                  />
                  <span className="text-xs text-txt-primary">{PERF_METRIC_LABELS[id]}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
