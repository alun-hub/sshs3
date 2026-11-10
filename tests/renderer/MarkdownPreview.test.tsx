// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MarkdownPreview from '../../src/renderer/src/components/FileManager/MarkdownPreview';
import { highlightCode } from '../../src/renderer/src/lib/markdownCodeHighlight';
import { setCopyOnSelectEnabled } from '../../src/renderer/src/lib/copyOnSelectSetting';

vi.mock('../../src/renderer/src/lib/markdownCodeHighlight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/src/lib/markdownCodeHighlight')>();
  return { ...actual, highlightCode: vi.fn(actual.highlightCode) };
});

const DOC = [
  '# Title',
  '',
  'Some `inline` text.',
  '',
  '```bash',
  'ssh user@host -p 22',
  'echo "hej"',
  '```',
  '',
  '- [x] done',
  '- [ ] todo',
].join('\n');

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { multissh?: unknown }).multissh;
  setCopyOnSelectEnabled(false);
  window.getSelection()?.removeAllRanges();
});

describe('MarkdownPreview', () => {
  it('makes its text selectable although the app body is select-none', () => {
    const { container } = render(<MarkdownPreview content={DOC} />);
    expect(container.querySelector('.markdown-preview-root')).toHaveClass('select-text');
  });

  it('renders headings, a fenced code block with its text intact and task list checkboxes', () => {
    const { container } = render(<MarkdownPreview content={DOC} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    const code = container.querySelector('pre code') as HTMLElement;
    expect(code).toHaveClass('language-bash');
    expect(code.textContent).toBe('ssh user@host -p 22\necho "hej"');
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it('colours the code of a known language', () => {
    const { container } = render(<MarkdownPreview content={DOC} />);
    expect(container.querySelector('pre code [class*="tok-"]')).not.toBeNull();
  });

  it('leaves code of an unknown language as plain text', () => {
    const { container } = render(<MarkdownPreview content={'```\nplain text\n```'} />);
    const code = container.querySelector('pre code') as HTMLElement;
    expect(code.textContent).toBe('plain text');
    expect(code.querySelector('span')).toBeNull();
  });

  it('copies exactly the code, without the fence and the final newline', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MarkdownPreview content={DOC} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    expect(writeText).toHaveBeenCalledWith('ssh user@host -p 22\necho "hej"');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
  });

  it('does not parse the code again when the copy button changes state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MarkdownPreview content={DOC} />);
    const parsedOnRender = vi.mocked(highlightCode).mock.calls.length;
    expect(parsedOnRender).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());

    expect(vi.mocked(highlightCode).mock.calls.length).toBe(parsedOnRender);
  });

  it('does not break when the clipboard refuses', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MarkdownPreview content={DOC} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
  });

  describe('copying the selection', () => {
    const clipboard = () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      return writeText;
    };
    /** Select the text of the first paragraph the way a drag does: the selection changes, then the button comes up. */
    const dragSelect = (root: HTMLElement) => {
      window.getSelection()!.selectAllChildren(root.querySelector('p')!);
      fireEvent.mouseUp(document.body);
    };

    it('copies the selection on Ctrl+Shift+C and says how much was copied', async () => {
      const writeText = clipboard();
      const { container } = render(<MarkdownPreview content={DOC} />);
      window.getSelection()!.selectAllChildren(container.querySelector('p')!);

      const notPrevented = fireEvent.keyDown(document, { key: 'C', ctrlKey: true, shiftKey: true });

      expect(writeText).toHaveBeenCalledWith('Some inline text.');
      expect(notPrevented).toBe(false); // preventDefault was called
      await waitFor(() => expect(screen.getByTestId('copy-notice')).toHaveTextContent('Copied 17 characters'));
    });

    it('does nothing on Ctrl+Shift+C without a selection in the preview', () => {
      const writeText = clipboard();
      render(<MarkdownPreview content={DOC} />);

      const notPrevented = fireEvent.keyDown(document, { key: 'C', ctrlKey: true, shiftKey: true });

      expect(writeText).not.toHaveBeenCalled();
      expect(notPrevented).toBe(true);
    });

    describe('copy on select', () => {
      it('copies when a drag-select ends, if the setting is on', async () => {
        const writeText = clipboard();
        setCopyOnSelectEnabled(true);
        const { container } = render(<MarkdownPreview content={DOC} />);

        dragSelect(container);

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('Some inline text.'));
      });

      it('does not copy when the setting is off', () => {
        const writeText = clipboard();
        const { container } = render(<MarkdownPreview content={DOC} />);

        dragSelect(container);

        expect(writeText).not.toHaveBeenCalled();
      });

      it('follows the setting while the preview is open', async () => {
        const writeText = clipboard();
        const { container } = render(<MarkdownPreview content={DOC} />);

        dragSelect(container);
        expect(writeText).not.toHaveBeenCalled();

        setCopyOnSelectEnabled(true);
        dragSelect(container);
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      });

      it('does not copy again on a click that leaves the selection as it was (it would overwrite what was copied since)', async () => {
        const writeText = clipboard();
        setCopyOnSelectEnabled(true);
        const { container } = render(<MarkdownPreview content={DOC} />);
        dragSelect(container);
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

        fireEvent.mouseUp(document.body); // a click on a button: the old selection is still there, nothing was selected
        fireEvent.mouseUp(document.body);

        expect(writeText).toHaveBeenCalledTimes(1);
      });

      it('copies a new selection of the same text elsewhere, and the same span again once the selection was cleared', async () => {
        const writeText = clipboard();
        setCopyOnSelectEnabled(true);
        const { container } = render(<MarkdownPreview content={'same\n\nsame'} />);
        const [first, second] = Array.from(container.querySelectorAll('p'));

        window.getSelection()!.selectAllChildren(first);
        fireEvent.mouseUp(document.body);
        window.getSelection()!.selectAllChildren(second); // the same text, another place
        fireEvent.mouseUp(document.body);
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

        window.getSelection()!.removeAllRanges(); // clicked elsewhere
        fireEvent.mouseUp(document.body);
        window.getSelection()!.selectAllChildren(second);
        fireEvent.mouseUp(document.body);
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
      });

      it('copies again after the next selection', async () => {
        const writeText = clipboard();
        setCopyOnSelectEnabled(true);
        const { container } = render(<MarkdownPreview content={DOC} />);
        dragSelect(container);
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

        window.getSelection()!.selectAllChildren(container.querySelector('h1')!);
        fireEvent.mouseUp(document.body);

        await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('Title'));
      });

      it('copies the part inside the preview when the drag ends outside it', async () => {
        const writeText = clipboard();
        setCopyOnSelectEnabled(true);
        const { container } = render(<MarkdownPreview content={DOC} />);
        const outside = document.createElement('div'); // after the preview in the document, like the pane next to it
        outside.textContent = 'another pane';
        document.body.append(outside);
        const range = document.createRange();
        range.setStart(container.querySelector('p')!.firstChild!, 5); // "inline text." from "Some "
        range.setEnd(outside.firstChild!, 7);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);

        fireEvent.mouseUp(document.body);

        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(writeText.mock.calls[0][0]).toContain('inline');
        expect(writeText.mock.calls[0][0]).not.toContain('another');
        outside.remove();
      });
    });

    it('shows the "Copied" notice outside the preview, so a search cannot highlight it or count it as a match', async () => {
      clipboard();
      const onCount = vi.fn();
      const { container, rerender } = render(<MarkdownPreview content={DOC} searchQuery="copied" onMatchesCountChange={onCount} currentMatchIdx={0} />);
      expect(onCount).toHaveBeenLastCalledWith(0);
      window.getSelection()!.selectAllChildren(container.querySelector('p')!);
      fireEvent.keyDown(document, { key: 'C', ctrlKey: true, shiftKey: true });
      const notice = await screen.findByTestId('copy-notice');

      rerender(<MarkdownPreview content={DOC} searchQuery="copied" onMatchesCountChange={onCount} currentMatchIdx={1} />);

      expect(container.querySelector('.markdown-preview-root')!.contains(notice)).toBe(false);
      expect(notice.querySelector('mark')).toBeNull();
      expect(onCount).toHaveBeenLastCalledWith(0);
    });

    it('does not ask the main process for the setting (it is published by App, not read per preview)', () => {
      const settingsGet = vi.fn().mockResolvedValue({ copyOnSelect: true });
      (window as unknown as { multissh: unknown }).multissh = { settingsGet };
      render(<MarkdownPreview content={DOC} />);
      expect(settingsGet).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('finds a phrase that runs across several syntax tokens of a code block', () => {
      const onCount = vi.fn();
      render(<MarkdownPreview content={DOC} searchQuery="ssh user@host" onMatchesCountChange={onCount} />);
      expect(onCount).toHaveBeenLastCalledWith(1);
    });

    it('goes back to coloured code when the search is cleared, without errors', () => {
      const onCount = vi.fn();
      const { container, rerender } = render(
        <MarkdownPreview content={DOC} searchQuery="echo" onMatchesCountChange={onCount} />
      );
      expect(onCount).toHaveBeenLastCalledWith(1);
      expect(container.querySelector('pre code [class*="tok-"]')).toBeNull();

      rerender(<MarkdownPreview content={DOC} searchQuery="" onMatchesCountChange={onCount} />);
      expect(container.querySelector('pre code [class*="tok-"]')).not.toBeNull();
      expect(container.querySelector('mark.md-search-hit')).toBeNull();
      expect((container.querySelector('pre code') as HTMLElement).textContent).toBe('ssh user@host -p 22\necho "hej"');
    });
  });

  describe('links', () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const withApi = () => {
      openExternal.mockClear();
      (window as unknown as { multissh: unknown }).multissh = { openExternal };
    };

    it('opens a web link in the system browser instead of navigating the window', () => {
      withApi();
      render(<MarkdownPreview content="See [the docs](https://example.com/docs) now." />);
      const link = screen.getByRole('link', { name: 'the docs' });

      const notPrevented = fireEvent.click(link);

      expect(openExternal).toHaveBeenCalledTimes(1);
      expect(openExternal).toHaveBeenCalledWith('https://example.com/docs');
      expect(notPrevented).toBe(false); // preventDefault was called
    });

    it('shows where a link really goes, whatever its text says', () => {
      withApi();
      render(<MarkdownPreview content="[https://github.com](https://evil.example/login)" />);
      expect(screen.getByRole('link')).toHaveAttribute('title', 'https://evil.example/login');
    });

    it('does not turn relative links, anchors, mailto and script links into clickable links', () => {
      withApi();
      render(
        <MarkdownPreview
          content={[
            '[rel](./other.md)',
            '[anchor](#section)',
            '[mail](mailto:a@example.com)',
            '[script](javascript:alert(1))',
            '[file](file:///etc/passwd)',
            '[creds](https://github.com@evil.example/)',
          ].join('\n\n')}
        />
      );
      expect(screen.queryByRole('link')).toBeNull();
      for (const text of ['rel', 'anchor', 'mail', 'script', 'file', 'creds']) {
        expect(screen.getByText(text)).toBeInTheDocument();
      }
      expect(openExternal).not.toHaveBeenCalled();
    });

    it('keeps the title the author gave a link and adds where it goes', () => {
      withApi();
      render(<MarkdownPreview content={'[docs](https://example.com/d "Open the docs")'} />);
      expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute(
        'title',
        'Open the docs (https://example.com/d)'
      );
    });

    it('attaches a handler to a failed open, so it cannot become an unhandled rejection', () => {
      const failed = Promise.reject(new Error('no handler for this scheme'));
      failed.catch(() => {}); // keeps this test itself clean
      const then = vi.spyOn(failed, 'then');
      // A plain function: vi.fn() would attach a handler of its own to the promise it returns.
      (window as unknown as { multissh: unknown }).multissh = { openExternal: () => failed };
      render(<MarkdownPreview content="[x](https://example.com)" />);

      fireEvent.click(screen.getByRole('link', { name: 'x' }));

      expect(then).toHaveBeenCalled();
    });

    it('does nothing, and does not throw, when the app API is missing', () => {
      render(<MarkdownPreview content="[x](https://example.com)" />);
      expect(() => fireEvent.click(screen.getByRole('link', { name: 'x' }))).not.toThrow();
    });
  });
});
