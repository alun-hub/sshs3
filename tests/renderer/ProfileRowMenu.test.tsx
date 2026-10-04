// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProfileRowMenu } from '../../src/renderer/src/components/ConnectionModal/ProfileRowMenu';

const setup = () => {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onOuterKey = vi.fn();
  document.addEventListener('keydown', onOuterKey);
  render(
    <ProfileRowMenu
      items={[
        { label: 'Duplicate profile', icon: <span />, onSelect: onEdit },
        { label: 'Delete profile', icon: <span />, onSelect: onDelete, danger: true, separated: true },
      ]}
    />
  );
  return { onEdit, onDelete, onOuterKey, cleanup: () => document.removeEventListener('keydown', onOuterKey) };
};

describe('ProfileRowMenu', () => {
  afterEach(() => cleanup());

  it('opens on click, runs the chosen item and closes', () => {
    const { onDelete, cleanup } = setup();
    const trigger = screen.getByTitle('More actions');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete profile' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    cleanup();
  });

  it('closes on Escape without letting the key reach the surrounding modal', () => {
    const { onOuterKey, cleanup } = setup();
    fireEvent.click(screen.getByTitle('More actions'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onOuterKey).not.toHaveBeenCalled();
    cleanup();
  });

  it('closes when clicking outside', () => {
    const { cleanup } = setup();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    cleanup();
  });
});
