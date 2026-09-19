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

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Default Tab Type')).toBeInTheDocument();

    // Click on Terminal category tab
    fireEvent.click(screen.getByRole('button', { name: /Terminal/ }));
    expect(screen.getByText('Terminal Font Size')).toBeInTheDocument();
    expect(screen.getByText('13 px')).toBeInTheDocument();
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

    // Click "Light"
    fireEvent.click(screen.getByText('Light'));

    // Select default tab "File Manager"
    fireEvent.click(screen.getByText('File Manager'));

    // Switch to Terminal tab to change font size
    fireEvent.click(screen.getByRole('button', { name: /Terminal/ }));
    const numInput = screen.getAllByRole('spinbutton')[0];
    fireEvent.change(numInput, { target: { value: '16' } });
    expect(screen.getByText('16 px')).toBeInTheDocument();

    // Submit
    fireEvent.click(screen.getByText('Save Settings'));

    expect(onSave).toHaveBeenCalledWith<[AppSettings]>(
      expect.objectContaining({
        theme: 'light',
        terminalFontSize: 16,
        defaultNewTabType: 'filemanager',
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
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

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders Keyboard Shortcuts tab and allows recording and resetting shortcuts', () => {
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

    // Click "Keyboard Shortcuts" tab
    fireEvent.click(screen.getByText('Keyboard Shortcuts'));
    expect(screen.getByText('New Terminal')).toBeInTheDocument();
    expect(screen.getByText('Close Tab')).toBeInTheDocument();
    expect(screen.getByText('Split Terminal Vertically')).toBeInTheDocument();

    // Click on shortcut button for "New Terminal" (default "Ctrl+Shift+T")
    const newTabBtn = screen.getByText('Ctrl+Shift+T');
    fireEvent.click(newTabBtn);

    // It should now prompt for recording
    expect(screen.getByText('Press keys (Esc to cancel)...')).toBeInTheDocument();

    // Send keydown Ctrl+Shift+N
    const recordingBtn = screen.getByText('Press keys (Esc to cancel)...');
    fireEvent.keyDown(recordingBtn, {
      key: 'n',
      ctrlKey: true,
      shiftKey: true,
    });

    // It should update to Ctrl+Shift+N
    expect(screen.getByText('Ctrl+Shift+N')).toBeInTheDocument();

    // Click reset to restore defaults
    fireEvent.click(screen.getByText('Reset Defaults'));
    expect(screen.getByText('Ctrl+Shift+T')).toBeInTheDocument();
  });

  it('renders session exit action options in Terminal tab and saves selected action', () => {
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

    // Click on Terminal category tab
    fireEvent.click(screen.getByRole('button', { name: /Terminal/ }));

    expect(screen.getByText('On Logout / Session End')).toBeInTheDocument();
    expect(screen.getByText('Reconnect (Default)')).toBeInTheDocument();
    expect(screen.getByText('Close Tab Immediately')).toBeInTheDocument();
    expect(screen.getByText('Keep Open')).toBeInTheDocument();

    // Select "Close Tab Immediately"
    fireEvent.click(screen.getByText('Close Tab Immediately'));

    // Save
    fireEvent.click(screen.getByText('Save Settings'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionExitAction: 'close',
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('renders X11 server controls in Terminal tab and saves mode and path', () => {
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

    // Click on Terminal category tab
    fireEvent.click(screen.getByRole('button', { name: /Terminal/ }));

    expect(screen.getByText('Local X11 Server (GUI Forwarding)')).toBeInTheDocument();
    expect(screen.getByText('Auto-start (Default)')).toBeInTheDocument();
    expect(screen.getByText('Always Running')).toBeInTheDocument();
    expect(screen.getByText('Manual / External')).toBeInTheDocument();

    // Select "Always Running"
    fireEvent.click(screen.getByText('Always Running'));

    // Type custom path into server binary path
    const pathInput = screen.getByPlaceholderText(/Auto-detect/);
    fireEvent.change(pathInput, { target: { value: 'C:\\custom\\vcxsrv.exe' } });

    // Save
    fireEvent.click(screen.getByText('Save Settings'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        x11ServerMode: 'always',
        x11ServerPath: 'C:\\custom\\vcxsrv.exe',
      })
    );
    expect(onClose).toHaveBeenCalled();
  });
});
