// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ConfirmProvider, useConfirm } from '../../src/renderer/src/components/ConfirmDialog';

// LOW finding (code review): replaces window.confirm() for destructive
// actions, which is trivially dismissed by a stray Enter/Space press.
const TestButton: React.FC<{ onResult: (result: boolean) => void; danger?: boolean }> = ({ onResult, danger }) => {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () => {
        const result = await confirm({ title: 'Delete thing', message: 'Are you sure?', danger });
        onResult(result);
      }}
    >
      Trigger
    </button>
  );
};

describe('ConfirmDialog', () => {
  afterEach(() => cleanup());

  it('resolves true when the confirm button is clicked', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <TestButton onResult={onResult} />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('resolves false when Cancel is clicked', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <TestButton onResult={onResult} />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('resolves false on Escape', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <TestButton onResult={onResult} />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('resolves false on a backdrop click', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <TestButton onResult={onResult} />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    fireEvent.click(screen.getByTestId('confirm-dialog'));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  // The core fix: Cancel is the button that receives autofocus, not the
  // destructive action, so a stray Enter/Space press is safe.
  it('autofocuses Cancel, not the destructive confirm button', () => {
    render(
      <ConfirmProvider>
        <TestButton onResult={vi.fn()} />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('uses a neutral (non-red) confirm button and different default label when danger is false', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <TestButton onResult={onResult} danger={false} />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    const confirmButton = screen.getByRole('button', { name: 'OK' });
    expect(confirmButton.className).not.toContain('bg-red-600');

    fireEvent.click(confirmButton);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it('throws if useConfirm is used outside a ConfirmProvider', () => {
    const BareComponent: React.FC = () => {
      useConfirm();
      return null;
    };
    // Suppress React's expected console.error for the thrown render error.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<BareComponent />)).toThrow(/must be used within a ConfirmProvider/);
    spy.mockRestore();
  });
});
