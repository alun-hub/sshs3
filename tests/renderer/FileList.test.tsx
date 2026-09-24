// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FileList } from '../../src/renderer/src/components/FileManager/FileList';
import type { FileEntry } from '../../src/shared/types/storage';

const mockEntries: FileEntry[] = [
  { name: 'config.json', path: '/config.json', size: 120, isDirectory: false, mtime: '2026-09-15 10:00' },
  { name: 'documents', path: '/documents', size: 0, isDirectory: true, mtime: '2026-09-15 11:00' },
  { name: 'image.png', path: '/image.png', size: 2048, isDirectory: false, mtime: '2026-09-15 12:00' },
  { name: 'backup.tar.gz', path: '/backup.tar.gz', size: 1048576, isDirectory: false, mtime: '2026-09-15 09:00' },
];

describe('FileList Component', () => {
  it('renders all entries when no filter is provided', () => {
    render(
      <FileList
        entries={mockEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByText('documents')).toBeInTheDocument();
    expect(screen.getByText('config.json')).toBeInTheDocument();
    expect(screen.getByText('image.png')).toBeInTheDocument();
    expect(screen.getByText('backup.tar.gz')).toBeInTheDocument();
  });

  it('filters entries case-insensitively based on filterText', () => {
    render(
      <FileList
        entries={mockEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        filterText="DOC"
      />
    );

    expect(screen.getByText('documents')).toBeInTheDocument();
    expect(screen.queryByText('config.json')).not.toBeInTheDocument();
    expect(screen.queryByText('image.png')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 4')).toBeInTheDocument();
  });

  it('shows no match message when filter yields zero results', () => {
    render(
      <FileList
        entries={mockEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        filterText="nonexistent"
      />
    );

    expect(screen.getByText('No files match "nonexistent"')).toBeInTheDocument();
  });

  it('renders permissions header and file permissions', () => {
    const permEntries: FileEntry[] = [
      { name: 'app.sh', path: '/app.sh', size: 100, isDirectory: false, permissions: '755' },
    ];

    render(
      <FileList
        entries={permEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByText('Permissions')).toBeInTheDocument();
    expect(screen.getByText('755')).toBeInTheDocument();
  });

  it('virtualizes large collections of files efficiently', () => {
    const largeEntries: FileEntry[] = Array.from({ length: 1000 }, (_, i) => ({
      name: `file_${i}.txt`,
      path: `/file_${i}.txt`,
      size: 1024 * i,
      isDirectory: false,
      mtime: '2026-09-17 12:00',
    }));

    render(
      <FileList
        entries={largeEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    // Initial window items should render
    expect(screen.getByText('file_0.txt')).toBeInTheDocument();
  });

  it('sets dropEffect to copy on dragOver for both files and directories', () => {
    const onEntryDragOver = vi.fn();
    render(
      <FileList
        entries={mockEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        isDropTarget={(entry) => entry.isDirectory}
        onEntryDragOver={onEntryDragOver}
      />
    );

    const docRow = screen.getByText('documents').closest('[role="row"]')!;
    const fileRow = screen.getByText('config.json').closest('[role="row"]')!;

    const docDataTransfer = { dropEffect: 'none' };
    const preventDefaultDoc = vi.fn();
    fireEvent.dragOver(docRow, {
      dataTransfer: docDataTransfer,
      preventDefault: preventDefaultDoc,
    });
    expect(docDataTransfer.dropEffect).toBe('copy');
    expect(onEntryDragOver).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'documents' }),
      expect.anything()
    );

    const fileDataTransfer = { dropEffect: 'none' };
    const preventDefaultFile = vi.fn();
    fireEvent.dragOver(fileRow, {
      dataTransfer: fileDataTransfer,
      preventDefault: preventDefaultFile,
    });
    expect(fileDataTransfer.dropEffect).toBe('copy');
  });

  it('delegates drop on files or container to onPaneDrop, and directory drop to onEntryDrop', () => {
    const onEntryDrop = vi.fn();
    const onPaneDrop = vi.fn();

    render(
      <FileList
        entries={mockEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        isDropTarget={(entry) => entry.isDirectory}
        onEntryDrop={onEntryDrop}
        onPaneDrop={onPaneDrop}
      />
    );

    const docRow = screen.getByText('documents').closest('[role="row"]')!;
    const fileRow = screen.getByText('config.json').closest('[role="row"]')!;

    // Dropping on folder calls onEntryDrop
    fireEvent.drop(docRow, { dataTransfer: {} });
    expect(onEntryDrop).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'documents' }),
      expect.anything()
    );

    // Dropping on file calls onPaneDrop
    fireEvent.drop(fileRow, { dataTransfer: {} });
    expect(onPaneDrop).toHaveBeenCalled();
  });

  describe('Type-ahead search', () => {
    it('selects entry and displays badge when typing a single character', () => {
      const onSelectionChange = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;
      fireEvent.keyDown(listContainer, { key: 'd' });

      expect(onSelectionChange).toHaveBeenCalledWith(new Set(['/documents']));
      expect(screen.getByTestId('typeahead-badge')).toHaveTextContent('d');
    });

    it('accumulates characters when typing multiple letters', () => {
      const onSelectionChange = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;
      fireEvent.keyDown(listContainer, { key: 'c' });
      expect(onSelectionChange).toHaveBeenCalledWith(new Set(['/config.json']));

      fireEvent.keyDown(listContainer, { key: 'o' });
      expect(screen.getByTestId('typeahead-badge')).toHaveTextContent('co');
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['/config.json']));
    });

    it('cycles through entries with the same initial letter when repeating that letter', () => {
      const entriesWithSameLetter: FileEntry[] = [
        { name: 'apple.txt', path: '/apple.txt', size: 10, isDirectory: false },
        { name: 'avocado.txt', path: '/avocado.txt', size: 20, isDirectory: false },
        { name: 'banana.txt', path: '/banana.txt', size: 30, isDirectory: false },
      ];

      const onSelectionChange = vi.fn();
      const { container, rerender } = render(
        <FileList
          entries={entriesWithSameLetter}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;

      // First 'a' -> apple.txt
      fireEvent.keyDown(listContainer, { key: 'a' });
      expect(onSelectionChange).toHaveBeenCalledWith(new Set(['/apple.txt']));

      // Rerender with selected apple.txt
      rerender(
        <FileList
          entries={entriesWithSameLetter}
          loading={false}
          selectedPaths={new Set(['/apple.txt'])}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      // Second 'a' -> avocado.txt
      fireEvent.keyDown(listContainer, { key: 'a' });
      expect(onSelectionChange).toHaveBeenCalledWith(new Set(['/avocado.txt']));
    });

    it('handles Backspace to shorten search and Escape to clear badge', () => {
      const onSelectionChange = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;

      fireEvent.keyDown(listContainer, { key: 'i' });
      fireEvent.keyDown(listContainer, { key: 'm' });
      expect(screen.getByTestId('typeahead-badge')).toHaveTextContent('im');

      // Backspace removes 'm'
      fireEvent.keyDown(listContainer, { key: 'Backspace' });
      expect(screen.getByTestId('typeahead-badge')).toHaveTextContent('i');

      // Escape clears typeahead badge
      fireEvent.keyDown(listContainer, { key: 'Escape' });
      expect(screen.queryByTestId('typeahead-badge')).not.toBeInTheDocument();
    });

    it('falls back to substring matching when no prefix matches', () => {
      const onSelectionChange = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;

      // "tar" does not start any file, but backup.tar.gz contains "tar"
      fireEvent.keyDown(listContainer, { key: 't' });
      fireEvent.keyDown(listContainer, { key: 'a' });
      fireEvent.keyDown(listContainer, { key: 'r' });

      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['/backup.tar.gz']));
      expect(screen.getByTestId('typeahead-badge')).toHaveTextContent('tar');
    });

    it('shows "(no match)" when no file matches typed characters', () => {
      const onSelectionChange = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;

      fireEvent.keyDown(listContainer, { key: 'z' });
      fireEvent.keyDown(listContainer, { key: 'z' });

      expect(screen.getByTestId('typeahead-badge')).toHaveTextContent('zz');
      expect(screen.getByTestId('typeahead-badge')).toHaveTextContent('no match');
    });

    it('ignores modifier keys like Ctrl and Meta', () => {
      const onSelectionChange = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;

      // Ctrl+C should not trigger typeahead
      fireEvent.keyDown(listContainer, { key: 'c', ctrlKey: true });
      expect(screen.queryByTestId('typeahead-badge')).not.toBeInTheDocument();
    });

    it('works with Swedish characters (å, ä, ö)', () => {
      const swedishEntries: FileEntry[] = [
        { name: 'arkiv.zip', path: '/arkiv.zip', size: 10, isDirectory: false },
        { name: 'översikt.pdf', path: '/översikt.pdf', size: 20, isDirectory: false },
        { name: 'ärenden', path: '/ärenden', size: 0, isDirectory: true },
        { name: 'årsredovisning.xlsx', path: '/årsredovisning.xlsx', size: 30, isDirectory: false },
      ];

      const onSelectionChange = vi.fn();
      const { container } = render(
        <FileList
          entries={swedishEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;

      fireEvent.keyDown(listContainer, { key: 'ö' });
      expect(onSelectionChange).toHaveBeenCalledWith(new Set(['/översikt.pdf']));
      expect(screen.getByTestId('typeahead-badge')).toHaveTextContent('ö');

      fireEvent.keyDown(listContainer, { key: 'Escape' });

      fireEvent.keyDown(listContainer, { key: 'ä' });
      expect(onSelectionChange).toHaveBeenCalledWith(new Set(['/ärenden']));
      expect(screen.getByTestId('typeahead-badge')).toHaveTextContent('ä');
    });

    it('moves row focus (data-focused) to matched item and subsequent arrows continue from there', () => {
      const onSelectionChange = vi.fn();
      const { container, rerender } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set(['/backup.tar.gz'])}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;

      // Type 'i' -> should match image.png
      fireEvent.keyDown(listContainer, { key: 'i' });
      expect(onSelectionChange).toHaveBeenCalledWith(new Set(['/image.png']));

      // Rerender with selected image.png
      rerender(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set(['/image.png'])}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      // image.png row should have data-focused="true" and ring styling
      const imageRow = container.querySelector('[data-entry-path="/image.png"]')!;
      expect(imageRow).toHaveAttribute('data-focused', 'true');
      expect(imageRow).toHaveAttribute('tabindex', '-1');
      expect(imageRow.className).toContain('ring-sky-400');

      // Now pressing ArrowDown should continue from image.png to next entry
      // In sorted mockEntries: directories first (documents), then backup.tar.gz, config.json, image.png
      // sorted order:
      // 0: documents (dir)
      // 1: backup.tar.gz
      // 2: config.json
      // 3: image.png
      // Since image.png is at index 3 (last), ArrowDown wraps around to 0 (documents)
      fireEvent.keyDown(listContainer, { key: 'ArrowDown' });
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['/documents']));

      // Rerender with documents
      rerender(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set(['/documents'])}
          onSelectionChange={onSelectionChange}
          onOpen={vi.fn()}
        />
      );

      const docRow = container.querySelector('[data-entry-path="/documents"]')!;
      expect(docRow).toHaveAttribute('data-focused', 'true');
    });
  });

  describe('Keyboard navigation shortcuts (F2, F5, Alt+ArrowUp)', () => {
    it('triggers onRenameStart when F2 is pressed on a single selected item', () => {
      const onRenameStart = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set(['/config.json'])}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          onRenameStart={onRenameStart}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;
      fireEvent.keyDown(listContainer, { key: 'F2' });
      expect(onRenameStart).toHaveBeenCalledTimes(1);
    });

    it('does not trigger onRenameStart when F2 is pressed with multiple or zero items selected', () => {
      const onRenameStart = vi.fn();
      const { container, rerender } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          onRenameStart={onRenameStart}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;
      fireEvent.keyDown(listContainer, { key: 'F2' });
      expect(onRenameStart).not.toHaveBeenCalled();

      rerender(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set(['/config.json', '/image.png'])}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          onRenameStart={onRenameStart}
        />
      );

      fireEvent.keyDown(listContainer, { key: 'F2' });
      expect(onRenameStart).not.toHaveBeenCalled();
    });

    it('triggers onRefresh when F5 is pressed', () => {
      const onRefresh = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          onRefresh={onRefresh}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;
      fireEvent.keyDown(listContainer, { key: 'F5' });
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('triggers onNavigateParent when Alt+ArrowUp is pressed', () => {
      const onNavigateParent = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set(['/documents'])}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          onNavigateParent={onNavigateParent}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;
      fireEvent.keyDown(listContainer, { key: 'ArrowUp', altKey: true });
      expect(onNavigateParent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Drag & drop enhancements', () => {
    it('provides a neutral drop zone below the list that triggers onPaneDrop', () => {
      const onPaneDrop = vi.fn();
      render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          onPaneDrop={onPaneDrop}
        />
      );

      const dropZone = screen.getByTestId('neutral-drop-zone');
      expect(dropZone).toBeInTheDocument();

      const dropEvent = { dataTransfer: { dropEffect: 'none' } };
      fireEvent.drop(dropZone, dropEvent);
      expect(onPaneDrop).toHaveBeenCalled();
    });

    it('updates auto-scroll on dragOver near top and bottom boundaries', () => {
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]') as HTMLElement;
      vi.spyOn(listContainer, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 500,
        height: 400,
        left: 0,
        right: 400,
        width: 400,
        x: 0,
        y: 100,
        toJSON: () => {},
      });

      // Hover near top (< 50px from rect.top: clientY = 110)
      fireEvent.dragOver(listContainer, { clientY: 110, dataTransfer: { dropEffect: 'none' } });

      // Hover near bottom (> 400 - 50: clientY = 480)
      fireEvent.dragOver(listContainer, { clientY: 480, dataTransfer: { dropEffect: 'none' } });

      // Moving away stops auto-scroll
      fireEvent.dragLeave(listContainer);
    });

    it('spring-loads (auto-opens) a folder when hovered for 900ms during drag', () => {
      vi.useFakeTimers();
      const onOpen = vi.fn();
      render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={vi.fn()}
          onOpen={onOpen}
          isDropTarget={(entry) => entry.isDirectory}
        />
      );

      const docRow = screen.getByText('documents').closest('[role="row"]')!;

      // Drag over directory
      fireEvent.dragOver(docRow, { dataTransfer: { dropEffect: 'none' } });

      // Before timer finishes, onOpen not called
      vi.advanceTimersByTime(500);
      expect(onOpen).not.toHaveBeenCalled();

      // Advance past 900ms
      vi.advanceTimersByTime(450);
      expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'documents', isDirectory: true }));

      vi.useRealTimers();
    });

    it('cancels spring-loaded timer if drag leaves directory before delay', () => {
      vi.useFakeTimers();
      const onOpen = vi.fn();
      render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={vi.fn()}
          onOpen={onOpen}
          isDropTarget={(entry) => entry.isDirectory}
        />
      );

      const docRow = screen.getByText('documents').closest('[role="row"]')!;

      // Drag over directory
      fireEvent.dragOver(docRow, { dataTransfer: { dropEffect: 'none' } });
      vi.advanceTimersByTime(500);

      // Leave directory before 900ms
      fireEvent.dragLeave(docRow);

      // Advance past 900ms
      vi.advanceTimersByTime(600);
      expect(onOpen).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('triggers onCopySelected on Ctrl+C', () => {
      const onCopySelected = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set(['/config.json'])}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          onCopySelected={onCopySelected}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;
      fireEvent.keyDown(listContainer, { key: 'c', ctrlKey: true });
      expect(onCopySelected).toHaveBeenCalledTimes(1);
    });

    it('triggers onCutSelected on Ctrl+X', () => {
      const onCutSelected = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set(['/config.json'])}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          onCutSelected={onCutSelected}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;
      fireEvent.keyDown(listContainer, { key: 'x', ctrlKey: true });
      expect(onCutSelected).toHaveBeenCalledTimes(1);
    });

    it('triggers onPaste on Ctrl+V', () => {
      const onPaste = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          onPaste={onPaste}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;
      fireEvent.keyDown(listContainer, { key: 'v', ctrlKey: true });
      expect(onPaste).toHaveBeenCalledTimes(1);
    });

    it('triggers onNavigateBack on Alt+Left and onNavigateForward on Alt+Right', () => {
      const onNavigateBack = vi.fn();
      const onNavigateForward = vi.fn();
      const { container } = render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          onNavigateBack={onNavigateBack}
          onNavigateForward={onNavigateForward}
        />
      );

      const listContainer = container.querySelector('[tabindex="0"]')!;
      fireEvent.keyDown(listContainer, { key: 'ArrowLeft', altKey: true });
      expect(onNavigateBack).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(listContainer, { key: 'ArrowRight', altKey: true });
      expect(onNavigateForward).toHaveBeenCalledTimes(1);
    });

    it('applies opacity-40 styling to cutPaths entries', () => {
      render(
        <FileList
          entries={mockEntries}
          loading={false}
          selectedPaths={new Set()}
          onSelectionChange={vi.fn()}
          onOpen={vi.fn()}
          cutPaths={new Set(['/config.json'])}
        />
      );

      const row = screen.getByText('config.json').closest('[role="row"]')!;
      expect(row.className).toContain('opacity-40');

      const uncutRow = screen.getByText('documents').closest('[role="row"]')!;
      expect(uncutRow.className).not.toContain('opacity-40');
    });
  });
});

