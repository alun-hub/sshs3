// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SettingsModal } from '../../src/renderer/src/components/SettingsModal/SettingsModal';
import { ConfirmProvider } from '../../src/renderer/src/components/ConfirmDialog';
import { DEFAULT_SETTINGS } from '../../src/shared/types/settings';

// Every control in a settings page must be reachable by its visible label, not only by placeholder or position.
describe('Settings accessible names', () => {
  afterEach(() => cleanup());

  function openTab(name: RegExp) {
    render(
      <ConfirmProvider>
        <SettingsModal open currentSettings={DEFAULT_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />
      </ConfirmProvider>
    );
    fireEvent.click(screen.getByRole('tab', { name }));
  }

  it('Terminal page: every field is bound to its label', () => {
    openTab(/Terminal/);

    expect(screen.getByRole('slider', { name: 'Terminal Font Size' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Terminal font size in pixels' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Terminal Font Family' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Cursor Style' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Scrollback Buffer (lines)' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Local Terminal SSH Agent' })).toBeInTheDocument();
  });

  it('Terminal page: the session-exit choices form a named radio group', () => {
    openTab(/Terminal/);

    const group = screen.getByRole('radiogroup', { name: 'On Logout / Session End' });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(3);
  });

  it('Terminal page: the live preview heading is not a label for nothing', () => {
    openTab(/Terminal/);

    const heading = screen.getByText('Terminal Live Preview');
    expect(heading.tagName).not.toBe('LABEL');
  });
});
