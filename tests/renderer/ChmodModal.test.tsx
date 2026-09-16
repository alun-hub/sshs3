// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChmodModal } from '../../src/renderer/src/components/FileManager/ChmodModal';
import type { FileEntry } from '../../src/shared/types/storage';

describe('ChmodModal', () => {
  const mockStorageChmod = vi.fn().mockResolvedValue(undefined);
  const mockStorageList = vi.fn().mockResolvedValue([]);

  beforeEach(() => {
    window.multissh = {
      ...(window.multissh || {}),
      storageChmod: mockStorageChmod,
      storageList: mockStorageList,
    } as any;
    mockStorageChmod.mockClear();
    mockStorageList.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  const sampleFile: FileEntry = {
    name: 'script.sh',
    path: '/home/user/script.sh',
    size: 1024,
    isDirectory: false,
    permissions: '755',
  };

  const sampleDir: FileEntry = {
    name: 'my-folder',
    path: '/home/user/my-folder',
    size: 4096,
    isDirectory: true,
    permissions: '700',
  };

  it('does not render when open is false', () => {
    const { container } = render(
      <ChmodModal
        open={false}
        providerId="local"
        entries={[sampleFile]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders target name and initial octal mode', () => {
    render(
      <ChmodModal
        open={true}
        providerId="local"
        entries={[sampleFile]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByText('Ändra rättigheter (chmod)')).toBeInTheDocument();
    expect(screen.getByText('script.sh')).toBeInTheDocument();
    const octalInput = screen.getByDisplayValue('0755') as HTMLInputElement;
    expect(octalInput).toBeInTheDocument();
  });

  it('updates octal input when checkbox is toggled', () => {
    render(
      <ChmodModal
        open={true}
        providerId="local"
        entries={[sampleFile]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    // Initial 0755 has uW=true (User Write = checkbox checked)
    // Find checkboxes
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // Uncheck User Write (index 1 in table row 1)
    fireEvent.click(checkboxes[1]);

    // Should change from 0755 to 0555 (User Write unchecked: 7 - 2 = 5)
    expect(screen.getByDisplayValue('0555')).toBeInTheDocument();
  });

  it('updates checkboxes when octal input changes', () => {
    render(
      <ChmodModal
        open={true}
        providerId="local"
        entries={[sampleFile]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const octalInput = screen.getByDisplayValue('0755');
    fireEvent.change(octalInput, { target: { value: '0644' } });

    // 0644 means user read+write, no exec; group read; other read
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true); // uR
    expect(checkboxes[1].checked).toBe(true); // uW
    expect(checkboxes[2].checked).toBe(false); // uX
    expect(checkboxes[3].checked).toBe(true); // gR
    expect(checkboxes[4].checked).toBe(false); // gW
    expect(checkboxes[5].checked).toBe(false); // gX
    expect(checkboxes[6].checked).toBe(true); // oR
    expect(checkboxes[7].checked).toBe(false); // oW
    expect(checkboxes[8].checked).toBe(false); // oX
  });

  it('shows recursive checkbox when entry is a directory', () => {
    render(
      <ChmodModal
        open={true}
        providerId="local"
        entries={[sampleDir]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByText('Tillämpa rekursivt på underliggande filer och mappar')).toBeInTheDocument();
  });

  it('calls storageChmod and onSaved when Spara is clicked', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <ChmodModal
        open={true}
        providerId="sftp-1"
        entries={[sampleFile]}
        onClose={onClose}
        onSaved={onSaved}
      />
    );

    fireEvent.click(screen.getByText('Spara'));

    await vi.waitFor(() => {
      expect(mockStorageChmod).toHaveBeenCalledWith('sftp-1', '/home/user/script.sh', '0755');
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('calls onClose when Avbryt is clicked', () => {
    const onClose = vi.fn();
    render(
      <ChmodModal
        open={true}
        providerId="local"
        entries={[sampleFile]}
        onClose={onClose}
        onSaved={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Avbryt'));
    expect(onClose).toHaveBeenCalled();
  });
});
