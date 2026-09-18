// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SmartcardPinModal } from '../../src/renderer/src/components/SmartcardPinModal';

describe('SmartcardPinModal Component', () => {
  let promptCallback: ((event: { id: string; prompt: string; sessionId?: string }) => void) | null = null;
  const mockUnsubscribe = vi.fn();
  const mockSubmitAskpassPin = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    promptCallback = null;
    mockUnsubscribe.mockClear();
    mockSubmitAskpassPin.mockClear();

    // Mock window.multissh
    window.multissh = {
      ...(window.multissh || {}),
      onAskpassPrompt: vi.fn((cb) => {
        promptCallback = cb;
        return mockUnsubscribe;
      }),
      submitAskpassPin: mockSubmitAskpassPin,
    } as any;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when there is no active prompt', () => {
    render(<SmartcardPinModal />);
    expect(screen.queryByTestId('smartcard-pin-modal')).not.toBeInTheDocument();
  });

  it('renders modal with prompt text and password field when prompt is received', () => {
    render(<SmartcardPinModal />);

    expect(window.multissh.onAskpassPrompt).toHaveBeenCalled();

    // Trigger prompt
    act(() => {
      promptCallback!({
        id: 'askpass-1',
        prompt: "Enter PIN for 'Net iD PKCS#11':",
      });
    });

    expect(screen.getByTestId('smartcard-pin-modal')).toBeInTheDocument();
    expect(screen.getByText("Enter PIN for 'Net iD PKCS#11':")).toBeInTheDocument();

    const input = screen.getByTestId('smartcard-pin-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('password');
  });

  it('submits PIN and closes modal when OK button is clicked or Enter is pressed', async () => {
    render(<SmartcardPinModal />);

    act(() => {
      promptCallback!({
        id: 'askpass-2',
        prompt: 'Enter PIN for smartcard:',
      });
    });

    const input = screen.getByTestId('smartcard-pin-input');
    fireEvent.change(input, { target: { value: '123456' } });

    const submitBtn = screen.getByTestId('smartcard-pin-submit');
    fireEvent.click(submitBtn);

    expect(mockSubmitAskpassPin).toHaveBeenCalledTimes(1);
    expect(mockSubmitAskpassPin).toHaveBeenCalledWith('askpass-2', '123456');

    // Modal should close
    expect(screen.queryByTestId('smartcard-pin-modal')).not.toBeInTheDocument();
  });

  it('submits PIN when Enter key is pressed in the input field', async () => {
    render(<SmartcardPinModal />);

    act(() => {
      promptCallback!({
        id: 'askpass-enter',
        prompt: 'Enter PIN for key:',
      });
    });

    const input = screen.getByTestId('smartcard-pin-input');
    fireEvent.change(input, { target: { value: '9876' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(mockSubmitAskpassPin).toHaveBeenCalledWith('askpass-enter', '9876');
    expect(screen.queryByTestId('smartcard-pin-modal')).not.toBeInTheDocument();
  });

  it('cancels and submits empty PIN when Cancel button or Escape key is pressed', () => {
    render(<SmartcardPinModal />);

    act(() => {
      promptCallback!({
        id: 'askpass-cancel',
        prompt: 'Enter PIN:',
      });
    });

    const cancelBtn = screen.getByTestId('smartcard-pin-cancel');
    fireEvent.click(cancelBtn);

    expect(mockSubmitAskpassPin).toHaveBeenCalledTimes(1);
    expect(mockSubmitAskpassPin).toHaveBeenCalledWith('askpass-cancel', '');
    expect(screen.queryByTestId('smartcard-pin-modal')).not.toBeInTheDocument();

    // Trigger another prompt and test Escape key
    act(() => {
      promptCallback!({
        id: 'askpass-esc',
        prompt: 'Enter PIN 2:',
      });
    });

    const input = screen.getByTestId('smartcard-pin-input');
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(mockSubmitAskpassPin).toHaveBeenCalledWith('askpass-esc', '');
    expect(screen.queryByTestId('smartcard-pin-modal')).not.toBeInTheDocument();
  });

  it('cleans up askpass listener on unmount', () => {
    const { unmount } = render(<SmartcardPinModal />);
    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
