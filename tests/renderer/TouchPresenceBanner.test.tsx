// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TouchPresenceBanner } from '../../src/renderer/src/components/TouchPresenceBanner';
import type { PresencePromptEvent, PresenceClearEvent } from '../../src/shared/types/ipc';

describe('TouchPresenceBanner Component', () => {
  let promptCallback: ((event: PresencePromptEvent) => void) | null = null;
  let clearCallback: ((event: PresenceClearEvent) => void) | null = null;
  const mockUnsubscribePrompt = vi.fn();
  const mockUnsubscribeClear = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    promptCallback = null;
    clearCallback = null;
    mockUnsubscribePrompt.mockClear();
    mockUnsubscribeClear.mockClear();

    window.multissh = {
      ...(window.multissh || {}),
      onPresencePrompt: vi.fn((cb) => {
        promptCallback = cb;
        return mockUnsubscribePrompt;
      }),
      onPresenceClear: vi.fn((cb) => {
        clearCallback = cb;
        return mockUnsubscribeClear;
      }),
    } as any;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing when there are no active prompts', () => {
    render(<TouchPresenceBanner />);
    expect(screen.queryByTestId('touch-presence-banner')).not.toBeInTheDocument();
  });

  it('displays banner when onPresencePrompt is received', () => {
    render(<TouchPresenceBanner />);

    act(() => {
      promptCallback!({
        id: 'presence-1',
        sessionId: 'session-123',
        message: 'Touch your security key to connect',
      });
    });

    expect(screen.getByTestId('touch-presence-banner')).toBeInTheDocument();
    expect(screen.getByText('Touch your security key to connect')).toBeInTheDocument();
  });

  it('clears banner when onPresenceClear is received with matching id', () => {
    render(<TouchPresenceBanner />);

    act(() => {
      promptCallback!({
        id: 'presence-1',
        sessionId: 'session-123',
        message: 'Touch your security key to connect',
      });
    });
    expect(screen.getByTestId('touch-presence-banner')).toBeInTheDocument();

    act(() => {
      clearCallback!({ id: 'presence-1' });
    });
    expect(screen.queryByTestId('touch-presence-banner')).not.toBeInTheDocument();
  });

  it('clears banner when onPresenceClear is received with matching sessionId', () => {
    render(<TouchPresenceBanner />);

    act(() => {
      promptCallback!({
        id: 'presence-1',
        sessionId: 'session-123',
        message: 'Touch your security key to connect',
      });
    });
    expect(screen.getByTestId('touch-presence-banner')).toBeInTheDocument();

    // PTY data arrives or session ends, emitting clear with only sessionId
    act(() => {
      clearCallback!({ sessionId: 'session-123' });
    });
    expect(screen.queryByTestId('touch-presence-banner')).not.toBeInTheDocument();
  });

  it('does not clear prompt if neither id nor sessionId match', () => {
    render(<TouchPresenceBanner />);

    act(() => {
      promptCallback!({
        id: 'presence-1',
        sessionId: 'session-123',
        message: 'Touch your security key to connect',
      });
    });

    act(() => {
      clearCallback!({ sessionId: 'other-session' });
    });
    expect(screen.getByTestId('touch-presence-banner')).toBeInTheDocument();
  });

  it('auto-clears banner after fallback timeout of 4000ms', () => {
    render(<TouchPresenceBanner />);

    act(() => {
      promptCallback!({
        id: 'presence-1',
        message: 'Touch your security key to connect',
      });
    });
    expect(screen.getByTestId('touch-presence-banner')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getByTestId('touch-presence-banner')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('touch-presence-banner')).not.toBeInTheDocument();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<TouchPresenceBanner />);
    unmount();
    expect(mockUnsubscribePrompt).toHaveBeenCalled();
    expect(mockUnsubscribeClear).toHaveBeenCalled();
  });
});
