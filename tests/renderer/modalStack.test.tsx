// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useEscapeToClose, useModalDismiss } from '../../src/renderer/src/lib/useModalDismiss';

const Modal: React.FC<{
  onClose: () => void;
  active?: boolean;
  enabled?: boolean;
  children?: React.ReactNode;
}> = ({ onClose, active = true, enabled = true, children }) => {
  const onBackdrop = useModalDismiss(onClose, active, enabled);
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

const esc = () => fireEvent.keyDown(window, { key: 'Escape' });

describe('modal stack (useModalDismiss / useEscapeToClose)', () => {
  afterEach(() => cleanup());

  it('closes on Escape and on a backdrop click, but not on a click inside the panel', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Modal onClose={onClose} />);

    fireEvent.click(getByTestId('panel'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(getByTestId('backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);

    esc();
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

    esc();
    expect(child).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();

    rerender(<Tree showChild={false} />);
    esc();
    expect(parent).toHaveBeenCalledTimes(1);
  });

  it('ranks a child above its parent even when both mount in the same commit', () => {
    const parent = vi.fn();
    const child = vi.fn();
    render(
      <Modal onClose={parent}>
        <Modal onClose={child} />
      </Modal>
    );

    esc();
    expect(child).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  });

  it('keeps its place while disabled: Escape is swallowed, not passed to the modal underneath', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    const Tree: React.FC<{ enabled: boolean }> = ({ enabled }) => (
      <Modal onClose={lower}>
        <Modal onClose={upper} enabled={enabled} />
      </Modal>
    );
    const { rerender, getAllByTestId } = render(<Tree enabled={false} />);

    esc();
    fireEvent.click(getAllByTestId('backdrop')[1]);
    expect(upper).not.toHaveBeenCalled();
    expect(lower).not.toHaveBeenCalled();

    rerender(<Tree enabled />);
    esc();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it('puts a re-activated modal above one that was opened while it was closed', () => {
    const first = vi.fn();
    const second = vi.fn();
    const App: React.FC<{ firstActive: boolean; secondActive: boolean }> = ({ firstActive, secondActive }) => (
      <>
        <Modal onClose={first} active={firstActive} />
        <Modal onClose={second} active={secondActive} />
      </>
    );
    const { rerender } = render(<App firstActive secondActive={false} />);
    rerender(<App firstActive={false} secondActive />);
    rerender(<App firstActive secondActive />);

    esc();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('ignores an inactive modal and other keys, and always calls the latest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const inactive = vi.fn();
    render(<Modal onClose={inactive} active={false} />);
    esc();
    expect(inactive).not.toHaveBeenCalled();

    const view = render(<EscapeOnly onEscape={first} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(first).not.toHaveBeenCalled();

    view.rerender(<EscapeOnly onEscape={second} />);
    esc();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('ranks correctly under React.StrictMode (double-invoked render and effects)', () => {
    const parent = vi.fn();
    const child = vi.fn();
    const Tree: React.FC<{ showChild: boolean }> = ({ showChild }) => (
      <React.StrictMode>
        <Modal onClose={parent}>{showChild && <Modal onClose={child} />}</Modal>
      </React.StrictMode>
    );
    const { rerender } = render(<Tree showChild={false} />);
    rerender(<Tree showChild />);

    esc();
    expect(child).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();

    rerender(<Tree showChild={false} />);
    esc();
    expect(parent).toHaveBeenCalledTimes(1);
  });

  it('ranks a child above its parent when both mount together under StrictMode', () => {
    const parent = vi.fn();
    const child = vi.fn();
    render(
      <React.StrictMode>
        <Modal onClose={parent}>
          <Modal onClose={child} />
        </Modal>
      </React.StrictMode>
    );

    esc();
    expect(child).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  });

  it('a modal that mounts closed and opens later ranks above one that was already open', () => {
    const early = vi.fn();
    const late = vi.fn();
    const App: React.FC<{ lateActive: boolean }> = ({ lateActive }) => (
      <>
        <Modal onClose={late} active={lateActive} />
        <Modal onClose={early} />
      </>
    );
    // `late` mounts first (lower mount rank) but is closed; opening it afterwards must put it on top.
    const { rerender } = render(<App lateActive={false} />);
    rerender(<App lateActive />);

    esc();
    expect(late).toHaveBeenCalledTimes(1);
    expect(early).not.toHaveBeenCalled();
  });
});
