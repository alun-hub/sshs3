// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MarkdownPreview from '../../src/renderer/src/components/FileManager/MarkdownPreview';

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

  it('does not break when the clipboard refuses', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MarkdownPreview content={DOC} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
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
});
