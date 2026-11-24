// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ConnectionTabs } from '../../src/renderer/src/components/ConnectionModal/ConnectionTabs';
import { protocolPanelId, protocolTabId } from '../../src/renderer/src/components/ConnectionModal/connectionTabIds';
import type { Tab } from '../../src/renderer/src/components/ConnectionModal/types';

function Harness({ initial = 'ssh', onSelect }: { initial?: Tab; onSelect?: (tab: Tab) => void }) {
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <ConnectionTabs
      tab={tab}
      idPrefix="p"
      onSelect={(next) => {
        onSelect?.(next);
        setTab(next);
      }}
    />
  );
}

const tabByName = (name: RegExp) => screen.getByRole('tab', { name });

describe('ConnectionTabs', () => {
  afterEach(cleanup);

  it('is a named tablist of three tabs that exposes the chosen one', () => {
    render(<Harness initial="s3" />);

    expect(screen.getByRole('tablist', { name: 'Connection type' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(tabByName(/SSH/)).toHaveAttribute('aria-selected', 'false');
    expect(tabByName(/S3/)).toHaveAttribute('aria-selected', 'true');
    expect(tabByName(/Kubernetes/)).toHaveAttribute('aria-selected', 'false');
  });

  it('links each tab to the panel it controls, under its own id', () => {
    render(<Harness />);

    for (const [name, key] of [[/SSH/, 'ssh'], [/S3/, 's3'], [/Kubernetes/, 'k8s']] as const) {
      expect(tabByName(name)).toHaveAttribute('id', protocolTabId('p', key));
      expect(tabByName(name)).toHaveAttribute('aria-controls', protocolPanelId('p'));
    }
  });

  it('puts only the chosen tab in the Tab order', () => {
    render(<Harness initial="s3" />);

    expect(tabByName(/SSH/)).toHaveAttribute('tabindex', '-1');
    expect(tabByName(/S3/)).toHaveAttribute('tabindex', '0');
    expect(tabByName(/Kubernetes/)).toHaveAttribute('tabindex', '-1');
  });

  it('chooses a tab on click, and only then moves the Tab stop', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    fireEvent.click(tabByName(/Kubernetes/));

    expect(onSelect).toHaveBeenCalledWith('k8s');
    expect(tabByName(/Kubernetes/)).toHaveAttribute('aria-selected', 'true');
    expect(tabByName(/Kubernetes/)).toHaveAttribute('tabindex', '0');
    expect(tabByName(/SSH/)).toHaveAttribute('tabindex', '-1');
  });

  describe('arrow keys', () => {
    function press(key: string, from: RegExp, init: KeyboardEventInit = {}) {
      const el = tabByName(from);
      el.focus();
      fireEvent.keyDown(el, { key, ...init });
    }

    it('move focus to the next and previous tab and wrap around, without choosing one', () => {
      const onSelect = vi.fn();
      render(<Harness onSelect={onSelect} />);

      press('ArrowRight', /SSH/);
      expect(tabByName(/S3/)).toHaveFocus();
      press('ArrowRight', /S3/);
      expect(tabByName(/Kubernetes/)).toHaveFocus();
      press('ArrowRight', /Kubernetes/);
      expect(tabByName(/SSH/)).toHaveFocus();
      press('ArrowLeft', /SSH/);
      expect(tabByName(/Kubernetes/)).toHaveFocus();

      // Moving focus around chose nothing: SSH is still the chosen tab.
      expect(onSelect).not.toHaveBeenCalled();
      expect(tabByName(/SSH/)).toHaveAttribute('aria-selected', 'true');
    });

    it('jump to the first and last tab with Home and End', () => {
      render(<Harness />);

      press('End', /SSH/);
      expect(tabByName(/Kubernetes/)).toHaveFocus();
      press('Home', /Kubernetes/);
      expect(tabByName(/SSH/)).toHaveFocus();
    });

    it('are left alone with a modifier (Ctrl+Shift+Arrow is spatial navigation)', () => {
      render(<Harness />);

      press('ArrowRight', /SSH/, { ctrlKey: true, shiftKey: true });
      expect(tabByName(/SSH/)).toHaveFocus();
      press('ArrowRight', /SSH/, { altKey: true });
      expect(tabByName(/SSH/)).toHaveFocus();
      press('ArrowRight', /SSH/, { metaKey: true });
      expect(tabByName(/SSH/)).toHaveFocus();
    });

    it('do not prevent the default of a key that is not for the tabs', () => {
      render(<Harness />);

      const el = tabByName(/SSH/);
      el.focus();
      // fireEvent returns false when the event was cancelled.
      expect(fireEvent.keyDown(el, { key: 'a' })).toBe(true);
      expect(fireEvent.keyDown(el, { key: 'Tab' })).toBe(true);
      expect(fireEvent.keyDown(el, { key: 'ArrowRight' })).toBe(false);
    });

    it('ignore a key that bubbles up from somewhere in the list that is not a tab', () => {
      render(<Harness />);

      const list = screen.getByRole('tablist');
      expect(fireEvent.keyDown(list, { key: 'ArrowRight' })).toBe(true);
      expect(tabByName(/SSH/)).not.toHaveFocus();
    });
  });
});
