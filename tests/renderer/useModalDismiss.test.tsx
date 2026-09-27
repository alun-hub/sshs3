// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useModalDismiss } from '../../src/renderer/src/lib/useModalDismiss';

const TestModal: React.FC<{ active: boolean; onClose: () => void }> = ({ active, onClose }) => {
  const handleBackdropClick = useModalDismiss(onClose, active);
  if (!active) return null;
  return (
    <div data-testid="backdrop" onClick={handleBackdropClick}>
      <div data-testid="content">content</div>
    </div>
  );
};

describe('useModalDismiss (M12)', () => {
  afterEach(() => cleanup());

  it('calls onClose on Escape, even when dispatched on document.body', () => {
    const onClose = vi.fn();
    render(<TestModal active onClose={onClose} />);

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on a click on the backdrop itself', () => {
    const onClose = vi.fn();
    render(<TestModal active onClose={onClose} />);

    fireEvent.click(screen.getByTestId('backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on a click on the modal content (bubbled, not the backdrop)', () => {
    const onClose = vi.fn();
    render(<TestModal active onClose={onClose} />);

    fireEvent.click(screen.getByTestId('content'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not attach the Escape listener while inactive', () => {
    const onClose = vi.fn();
    render(<TestModal active={false} onClose={onClose} />);

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not call onClose on a backdrop click while inactive', () => {
    const onClose = vi.fn();
    const active = { current: true };
    const Wrapper: React.FC = () => {
      const handleBackdropClick = useModalDismiss(onClose, active.current);
      return (
        <div data-testid="backdrop" onClick={handleBackdropClick}>
          <div data-testid="content">content</div>
        </div>
      );
    };
    const { rerender } = render(<Wrapper />);

    active.current = false;
    rerender(<Wrapper />);
    fireEvent.click(screen.getByTestId('backdrop'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops responding to Escape after becoming inactive', () => {
    const onClose = vi.fn();
    const { rerender } = render(<TestModal active onClose={onClose} />);

    rerender(<TestModal active={false} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});
