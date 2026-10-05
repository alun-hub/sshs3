// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  findAdjacentPane,
  findAdjacentElement,
  getTopmostOverlay,
  navigateInOverlay,
  type PaneRect,
} from '../../src/renderer/src/lib/spatialNavigation';

describe('findAdjacentPane', () => {
  it('returns to_tab_bar when navigating up in a single pane setup', () => {
    const panes: PaneRect[] = [
      { id: 'p1', rect: { left: 0, top: 50, right: 800, bottom: 600, width: 800, height: 550 } },
    ];
    expect(findAdjacentPane(panes, 'p1', 'up')).toEqual({ type: 'to_tab_bar' });
    expect(findAdjacentPane(panes, 'p1', 'down')).toBeNull();
    expect(findAdjacentPane(panes, 'p1', 'left')).toBeNull();
    expect(findAdjacentPane(panes, 'p1', 'right')).toBeNull();
  });

  it('navigates left and right in a vertical split (two columns)', () => {
    const panes: PaneRect[] = [
      { id: 'left', rect: { left: 0, top: 50, right: 400, bottom: 600, width: 400, height: 550 } },
      { id: 'right', rect: { left: 400, top: 50, right: 800, bottom: 600, width: 400, height: 550 } },
    ];

    expect(findAdjacentPane(panes, 'left', 'right')).toEqual({ type: 'pane', id: 'right' });
    expect(findAdjacentPane(panes, 'right', 'left')).toEqual({ type: 'pane', id: 'left' });
    // From either pane, navigating up goes to tab bar because they are at the top
    expect(findAdjacentPane(panes, 'left', 'up')).toEqual({ type: 'to_tab_bar' });
    expect(findAdjacentPane(panes, 'right', 'up')).toEqual({ type: 'to_tab_bar' });
  });

  it('navigates up and down in a horizontal split (two rows)', () => {
    const panes: PaneRect[] = [
      { id: 'top', rect: { left: 0, top: 50, right: 800, bottom: 300, width: 800, height: 250 } },
      { id: 'bottom', rect: { left: 0, top: 300, right: 800, bottom: 600, width: 800, height: 300 } },
    ];

    expect(findAdjacentPane(panes, 'top', 'down')).toEqual({ type: 'pane', id: 'bottom' });
    expect(findAdjacentPane(panes, 'bottom', 'up')).toEqual({ type: 'pane', id: 'top' });
    expect(findAdjacentPane(panes, 'top', 'up')).toEqual({ type: 'to_tab_bar' });
    expect(findAdjacentPane(panes, 'bottom', 'down')).toBeNull();
  });

  it('navigates correctly in a 2x2 grid', () => {
    const panes: PaneRect[] = [
      { id: 'tl', rect: { left: 0, top: 50, right: 400, bottom: 300, width: 400, height: 250 } },
      { id: 'tr', rect: { left: 400, top: 50, right: 800, bottom: 300, width: 400, height: 250 } },
      { id: 'bl', rect: { left: 0, top: 300, right: 400, bottom: 600, width: 400, height: 300 } },
      { id: 'br', rect: { left: 400, top: 300, right: 800, bottom: 600, width: 400, height: 300 } },
    ];

    // From bottom-left:
    expect(findAdjacentPane(panes, 'bl', 'up')).toEqual({ type: 'pane', id: 'tl' });
    expect(findAdjacentPane(panes, 'bl', 'right')).toEqual({ type: 'pane', id: 'br' });
    expect(findAdjacentPane(panes, 'bl', 'left')).toBeNull();

    // From top-right:
    expect(findAdjacentPane(panes, 'tr', 'left')).toEqual({ type: 'pane', id: 'tl' });
    expect(findAdjacentPane(panes, 'tr', 'down')).toEqual({ type: 'pane', id: 'br' });
    expect(findAdjacentPane(panes, 'tr', 'up')).toEqual({ type: 'to_tab_bar' });

    // From top-left:
    expect(findAdjacentPane(panes, 'tl', 'up')).toEqual({ type: 'to_tab_bar' });
  });
});

describe('overlay spatial navigation', () => {
  function makeMockElement(
    tag: string,
    id: string,
    rect: { left: number; top: number; width: number; height: number }
  ): HTMLElement {
    const el = document.createElement(tag);
    el.id = id;
    el.getBoundingClientRect = () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => {},
    });
    return el;
  }

  describe('findAdjacentElement', () => {
    it('navigates right and left between buttons on the same row', () => {
      const b1 = makeMockElement('button', 'btn1', { left: 10, top: 50, width: 80, height: 30 });
      const b2 = makeMockElement('button', 'btn2', { left: 100, top: 50, width: 80, height: 30 });
      const b3 = makeMockElement('button', 'btn3', { left: 190, top: 50, width: 40, height: 30 });
      const candidates = [b1, b2, b3];

      expect(findAdjacentElement(candidates, b1, 'right')).toBe(b2);
      expect(findAdjacentElement(candidates, b2, 'right')).toBe(b3);
      expect(findAdjacentElement(candidates, b3, 'left')).toBe(b2);
      expect(findAdjacentElement(candidates, b2, 'left')).toBe(b1);
    });

    it('navigates down and up across rows aligned in columns', () => {
      // Row 1
      const r1Connect = makeMockElement('button', 'r1-connect', { left: 400, top: 100, width: 70, height: 30 });
      const r1Edit = makeMockElement('button', 'r1-edit', { left: 480, top: 100, width: 30, height: 30 });
      // Row 2
      const r2Connect = makeMockElement('button', 'r2-connect', { left: 400, top: 150, width: 70, height: 30 });
      const r2Edit = makeMockElement('button', 'r2-edit', { left: 480, top: 150, width: 30, height: 30 });
      const candidates = [r1Connect, r1Edit, r2Connect, r2Edit];

      // Moving down from r1Connect goes directly to r2Connect (column alignment)
      expect(findAdjacentElement(candidates, r1Connect, 'down')).toBe(r2Connect);
      // Moving down from r1Edit goes directly to r2Edit
      expect(findAdjacentElement(candidates, r1Edit, 'down')).toBe(r2Edit);
      // Moving up from r2Connect goes to r1Connect
      expect(findAdjacentElement(candidates, r2Connect, 'up')).toBe(r1Connect);
    });

    it('wraps to next row when moving right from the end of a row', () => {
      const r1End = makeMockElement('button', 'r1-end', { left: 200, top: 50, width: 40, height: 30 });
      const r2Start = makeMockElement('button', 'r2-start', { left: 10, top: 100, width: 70, height: 30 });
      const candidates = [r1End, r2Start];

      expect(findAdjacentElement(candidates, r1End, 'right')).toBe(r2Start);
    });
  });

  describe('getTopmostOverlay', () => {
    it('returns null when no overlay is in the document', () => {
      document.body.innerHTML = '<div><span>Hello</span></div>';
      expect(getTopmostOverlay()).toBeNull();
    });

    it('detects dialog overlay', () => {
      document.body.innerHTML = `
        <div role="dialog" id="test-dialog" style="display: block;">
          <button id="dialog-btn">Click</button>
        </div>
      `;
      const dialog = document.getElementById('test-dialog')!;
      dialog.getBoundingClientRect = () => ({
        left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => {},
      });
      expect(getTopmostOverlay()).toBe(dialog);
    });

    it('prioritizes menu over dialog when both exist', () => {
      document.body.innerHTML = `
        <div role="dialog" id="test-dialog" style="display: block;">
          <button id="dialog-btn">Click</button>
        </div>
        <div role="menu" id="test-menu" style="display: block;">
          <button role="menuitem" id="menu-btn">Item</button>
        </div>
      `;
      const dialog = document.getElementById('test-dialog')!;
      dialog.getBoundingClientRect = () => ({
        left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => {},
      });
      const menu = document.getElementById('test-menu')!;
      menu.getBoundingClientRect = () => ({
        left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100, x: 100, y: 100, toJSON: () => {},
      });

      expect(getTopmostOverlay()).toBe(menu);
    });
  });

  describe('navigateInOverlay', () => {
    it('focuses first candidate and adds spatial-nav-active when no element has focus', () => {
      document.body.innerHTML = `
        <div role="dialog" id="my-dialog">
          <button id="btn-a">A</button>
          <button id="btn-b">B</button>
        </div>
      `;
      const dialog = document.getElementById('my-dialog')!;
      const btnA = document.getElementById('btn-a')!;
      const btnB = document.getElementById('btn-b')!;
      btnA.getBoundingClientRect = () => ({
        left: 10, top: 10, right: 60, bottom: 40, width: 50, height: 30, x: 10, y: 10, toJSON: () => {},
      });
      btnB.getBoundingClientRect = () => ({
        left: 70, top: 10, right: 120, bottom: 40, width: 50, height: 30, x: 70, y: 10, toJSON: () => {},
      });

      const handled = navigateInOverlay(dialog, 'down');
      expect(handled).toBe(true);
      expect(btnA.classList.contains('spatial-nav-active')).toBe(true);
      expect(document.activeElement).toBe(btnA);

      // Now navigating right should advance to btnB
      const handled2 = navigateInOverlay(dialog, 'right');
      expect(handled2).toBe(true);
      expect(btnB.classList.contains('spatial-nav-active')).toBe(true);
      expect(btnA.classList.contains('spatial-nav-active')).toBe(false);
      expect(document.activeElement).toBe(btnB);
    });
  });
});

