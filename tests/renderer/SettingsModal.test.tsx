// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SettingsModal } from '../../src/renderer/src/components/SettingsModal/SettingsModal';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/shared/types/settings';

describe('SettingsModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not render when open is false', () => {
    const { container } = render(
      <SettingsModal
        open={false}
        currentSettings={DEFAULT_SETTINGS}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders settings fields when open is true', () => {
    render(
      <SettingsModal
        open={true}
        currentSettings={DEFAULT_SETTINGS}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Inställningar')).toBeInTheDocument();
    expect(screen.getByText('Mörkt')).toBeInTheDocument();
    expect(screen.getByText('Ljust')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Terminal typsnittsstorlek')).toBeInTheDocument();
    expect(screen.getByText('13 px')).toBeInTheDocument();
    expect(screen.getByText('Standardflik för nya flikar')).toBeInTheDocument();
  });

  it('allows changing theme, font size, and default tab, then submits on save', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(
      <SettingsModal
        open={true}
        currentSettings={DEFAULT_SETTINGS}
        onSave={onSave}
        onClose={onClose}
      />
    );

    // Click "Ljust"
    fireEvent.click(screen.getByText('Ljust'));

    // Change font size input
    const numInput = screen.getByRole('spinbutton');
    fireEvent.change(numInput, { target: { value: '16' } });
    expect(screen.getByText('16 px')).toBeInTheDocument();

    // Select default tab "Filhanterare"
    fireEvent.click(screen.getByText('Filhanterare'));

    // Submit
    fireEvent.click(screen.getByText('Spara inställningar'));

    expect(onSave).toHaveBeenCalledWith<[AppSettings]>({
      theme: 'light',
      terminalFontSize: 16,
      terminalFontFamily: DEFAULT_SETTINGS.terminalFontFamily,
      defaultNewTabType: 'filemanager',
      shortcuts: DEFAULT_SETTINGS.shortcuts,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Avbryt is clicked', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(
      <SettingsModal
        open={true}
        currentSettings={DEFAULT_SETTINGS}
        onSave={onSave}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByText('Avbryt'));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
