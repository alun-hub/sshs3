// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SegmentedChoice } from '../../src/renderer/src/components/ui/SegmentedChoice';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
] as const;

const Harness: React.FC<{ autoFocus?: boolean }> = ({ autoFocus }) => {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a');
  return <SegmentedChoice label="Letter" options={OPTIONS} value={v} onChange={setV} autoFocus={autoFocus} />;
};

afterEach(() => cleanup());

describe('SegmentedChoice', () => {
  it('is a named radiogroup with one real radio per choice', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Letter' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Beta' })).not.toBeChecked();
  });

  it('selects a choice when it is clicked', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: 'Gamma' }));
    expect(screen.getByRole('radio', { name: 'Gamma' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Alpha' })).not.toBeChecked();
  });

  it('shows a check mark on the selected choice only, so the state is not colour alone', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Beta' }));
    expect(screen.getByRole('radio', { name: 'Beta' }).closest('label')?.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'Alpha' }).closest('label')?.querySelector('svg')).toBeNull();
  });

  it('shares one radio group name, so the browser gives one Tab stop and the arrow keys', () => {
    render(<Harness />);
    const names = new Set(screen.getAllByRole('radio').map((r) => r.getAttribute('name')));
    expect(names.size).toBe(1);
    expect([...names][0]).toBeTruthy();
  });

  it('marks only the selected choice as the dialog autofocus target', () => {
    render(<Harness autoFocus />);
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('data-autofocus');
    expect(screen.getByRole('radio', { name: 'Beta' })).not.toHaveAttribute('data-autofocus');
  });

  it('marks nothing as autofocus by default', () => {
    render(<Harness />);
    expect(document.querySelector('[data-autofocus]')).toBeNull();
  });
});
