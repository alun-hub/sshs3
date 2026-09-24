// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DragDropProvider } from '../../src/renderer/src/components/FileManager/DragDropLayer';
import { useDragDrop } from '../../src/renderer/src/components/FileManager/DragDropContext';
import type { DragPayload } from '../../src/renderer/src/components/FileManager/types';

const TestConsumer: React.FC = () => {
  const { activeDrag, beginDrag } = useDragDrop();
  return (
    <div>
      <span data-testid="status">{activeDrag ? 'dragging' : 'idle'}</span>
      <button
        onClick={() => {
          const payload: DragPayload = {
            fromPane: 'left',
            providerId: 'local',
            basePath: '/test',
            entries: [{ name: 'file.txt', path: '/test/file.txt', size: 10, isDirectory: false }],
          };
          beginDrag(payload, {
            effectAllowed: 'none',
            setData: () => {},
          } as unknown as DataTransfer);
        }}
      >
        Start Drag
      </button>
    </div>
  );
};

const ClipboardConsumer: React.FC = () => {
  const { clipboard, copyFiles, cutFiles, clearClipboard } = useDragDrop();
  return (
    <div>
      <span data-testid="clipboard-mode">{clipboard?.mode ?? 'none'}</span>
      <span data-testid="clipboard-count">{clipboard?.sourcePaths.length ?? 0}</span>
      <button onClick={() => copyFiles('left', 'prov-1', ['/a.txt', '/b.txt'])}>Copy</button>
      <button onClick={() => cutFiles('right', 'prov-2', ['/c.txt'])}>Cut</button>
      <button onClick={() => clearClipboard()}>Clear</button>
    </div>
  );
};

describe('DragDropLayer', () => {
  it('cancels active drag when Escape is pressed on the window', () => {
    render(
      <DragDropProvider>
        <TestConsumer />
      </DragDropProvider>
    );

    expect(screen.getByTestId('status')).toHaveTextContent('idle');

    fireEvent.click(screen.getByRole('button', { name: 'Start Drag' }));
    expect(screen.getByTestId('status')).toHaveTextContent('dragging');

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
  });

  it('manages copy and cut file clipboard operations', () => {
    render(
      <DragDropProvider>
        <ClipboardConsumer />
      </DragDropProvider>
    );

    expect(screen.getByTestId('clipboard-mode')).toHaveTextContent('none');
    expect(screen.getByTestId('clipboard-count')).toHaveTextContent('0');

    // Copy
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByTestId('clipboard-mode')).toHaveTextContent('copy');
    expect(screen.getByTestId('clipboard-count')).toHaveTextContent('2');

    // Cut
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    expect(screen.getByTestId('clipboard-mode')).toHaveTextContent('cut');
    expect(screen.getByTestId('clipboard-count')).toHaveTextContent('1');

    // Clear
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('clipboard-mode')).toHaveTextContent('none');
    expect(screen.getByTestId('clipboard-count')).toHaveTextContent('0');
  });
});

