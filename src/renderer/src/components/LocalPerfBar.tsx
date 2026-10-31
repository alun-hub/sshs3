import React from 'react';
import type { PerfLayout, PerfMetricId } from '@shared/types/perf';
import { usePerfSamples } from '../lib/usePerfSamples';
import { PerfBar } from './PerfBar';

/** The one perf bar shared by all local-shell panes of a tab, shown in the split-view header. */
export const LocalPerfBar: React.FC<{
  layout: PerfLayout;
  items: PerfMetricId[];
  intervalSec?: number;
  active: boolean;
}> = ({ layout, items, intervalSec, active }) => {
  const state = usePerfSamples({ local: true, intervalSec, active });
  return <PerfBar kind="ssh" state={state} layout={layout} items={items} title="Local shell" local embedded />;
};
