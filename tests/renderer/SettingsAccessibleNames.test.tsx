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

  it('General page: the color theme is a named radio group that exposes the selected theme', () => {
    openTab(/General/);

    const group = screen.getByRole('radiogroup', { name: 'Color Theme' });
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(4);
    // The selected state is exposed to assistive technology, not only drawn as a border and tint.
    const checked = radios.filter((r) => r.checked);
    expect(checked).toHaveLength(1);

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).not.toBeChecked();
  });

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

  it('Terminal page: the X server mode radios stay in the tab order (sr-only, never display:none)', () => {
    openTab(/Terminal/);

    const group = screen.getAllByRole('radiogroup', { name: 'X server mode' })[0];
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(3);
    for (const radio of radios) {
      // Tailwind's `hidden` is display:none: the radio would leave the tab order and the accessibility tree.
      expect(radio.classList.contains('hidden')).toBe(false);
      expect(radio.classList.contains('sr-only')).toBe(true);
    }
  });

  it('Terminal page: the live preview heading is not a label for nothing', () => {
    openTab(/Terminal/);

    const heading = screen.getByText('Terminal Live Preview');
    expect(heading.tagName).not.toBe('LABEL');
  });

  // A group of radio cards needs a name of its own: without a radiogroup a screen reader announces each card as
  // a lone radio button, with no hint that it is one of several choices or what the choice is about.
  it('General page: the default tab choice is a named radio group', () => {
    openTab(/General/);

    const group = screen.getByRole('radiogroup', { name: 'Default Tab Type' });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    // The title names the group; it is no longer a <label> that belongs to no control.
    expect(screen.getByText('Default Tab Type').tagName).not.toBe('LABEL');
  });

  it('Files page: the conflict resolution choice is a named radio group', () => {
    openTab(/Files/);

    const group = screen.getByRole('radiogroup', { name: 'Default Conflict Resolution for File Transfers' });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(4);
    expect(screen.getByText('Default Conflict Resolution for File Transfers').tagName).not.toBe('LABEL');
  });

  it('Security page: the PIN caching choice is a named radio group, described by its hint', () => {
    openTab(/Security/);

    const group = screen.getByRole('radiogroup', { name: /PIN Caching$/ });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(group).toHaveAccessibleDescription(/Applies to every Smartcard/);
  });

  it('Security page: the detected driver list is a named radio group', async () => {
    window.multissh = {
      smartcardDetect: vi.fn().mockResolvedValue([
        { name: 'OpenSC', path: '/usr/lib/opensc-pkcs11.so', platform: 'linux', exists: true },
      ]),
    } as unknown as typeof window.multissh;
    try {
      openTab(/Security/);

      const group = await screen.findByRole('radiogroup', { name: 'Detected PKCS#11 Hardware Token Libraries' });
      // "Auto-detect" is always offered next to what was found.
      expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
      expect(screen.getByText('Detected PKCS#11 Hardware Token Libraries').tagName).not.toBe('LABEL');
    } finally {
      delete (window as { multissh?: unknown }).multissh;
    }
  });
});
