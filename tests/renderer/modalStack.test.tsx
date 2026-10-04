// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useEscapeToClose, useModalDismiss } from '../../src/renderer/src/lib/useModalDismiss';

const Modal: React.FC<{ onClose: () => void; active?: boolean; children?: React.ReactNode }> = ({
  onClose,
  active = true,
  children,
}) => {
  const onBackdrop = useModalDismiss(onClose, active);
  return (
    <div data-testid="backdrop" onClick={onBackdrop}>
      <div data-testid="panel">{children}</div>
    </div>
  );
};

const EscapeOnly: React.FC<{ onEscape: () => void }> = ({ onEscape }) => {
  useEscapeToClose(onEscape, true);
  return null;
};

describe('modal stack (useModalDismiss / useEscapeToClose)', () => {
  afterEach(() => cleanup());

  it('closes on Escape and on a backdrop click, but not on a click inside the panel', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Modal onClose={onClose} />);

    fireEvent.click(getByTestId('panel'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(getByTestId('backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('delivers Escape to the topmost modal only, then to its parent once it is gone', () => {
    const parent = vi.fn();
    const child = vi.fn();
    const Tree: React.FC<{ showChild: boolean }> = ({ showChild }) => (
      <Modal onClose={parent}>{showChild && <Modal onClose={child} />}</Modal>
    );
    // The child opens after its parent is already showing, like a dialog launched from a dialog.
    const { rerender } = render(<Tree showChild={false} />);
    rerender(<Tree showChild />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(child).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();

    rerender(<Tree showChild={false} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(parent).toHaveBeenCalledTimes(1);
  });

  it('ignores an inactive modal and other keys, and always calls the latest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Modal onClose={vi.fn()} active={false} />);
    fireEvent.keyDown(window, { key: 'Escape' });

    const view = render(<EscapeOnly onEscape={first} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(first).not.toHaveBeenCalled();

    view.rerender(<EscapeOnly onEscape={second} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    rerender(<Modal onClose={vi.fn()} active={false} />);
  });
});
