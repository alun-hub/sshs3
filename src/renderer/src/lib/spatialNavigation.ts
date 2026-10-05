export type NavigationDirection = 'left' | 'right' | 'up' | 'down';

export interface PaneRect {
  id: string;
  rect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

export type NavigationTarget =
  | { type: 'pane'; id: string }
  | { type: 'to_tab_bar' }
  | null;

/**
 * Given a list of pane bounding boxes, the current active pane ID, and a direction,
 * finds the best adjacent pane or signals 'to_tab_bar' when moving up with no pane above.
 */
export function findAdjacentPane(
  panes: PaneRect[],
  currentId: string,
  direction: NavigationDirection
): NavigationTarget {
  if (panes.length === 0) return null;

  const current = panes.find((p) => p.id === currentId);
  if (!current) {
    return panes[0] ? { type: 'pane', id: panes[0].id } : null;
  }

  // If only 1 pane exists:
  if (panes.length === 1) {
    if (direction === 'up') return { type: 'to_tab_bar' };
    return null;
  }

  const cRect = current.rect;
  const cx = cRect.left + cRect.width / 2;
  const cy = cRect.top + cRect.height / 2;

  let bestTarget: string | null = null;
  let bestScore = Infinity;

  for (const candidate of panes) {
    if (candidate.id === currentId) continue;
    const pRect = candidate.rect;
    const px = pRect.left + pRect.width / 2;
    const py = pRect.top + pRect.height / 2;

    if (direction === 'left') {
      if (pRect.right <= cRect.left + 5 || px < cx - 10) {
        const dx = Math.max(0, cRect.left - pRect.right);
        const dy = Math.abs(cy - py);
        const overlaps = Math.max(0, Math.min(cRect.bottom, pRect.bottom) - Math.max(cRect.top, pRect.top));
        const overlapBonus = overlaps > 0 ? 0 : 500;
        const score = dx * 2 + dy + overlapBonus;
        if (score < bestScore) {
          bestScore = score;
          bestTarget = candidate.id;
        }
      }
    } else if (direction === 'right') {
      if (pRect.left >= cRect.right - 5 || px > cx + 10) {
        const dx = Math.max(0, pRect.left - cRect.right);
        const dy = Math.abs(cy - py);
        const overlaps = Math.max(0, Math.min(cRect.bottom, pRect.bottom) - Math.max(cRect.top, pRect.top));
        const overlapBonus = overlaps > 0 ? 0 : 500;
        const score = dx * 2 + dy + overlapBonus;
        if (score < bestScore) {
          bestScore = score;
          bestTarget = candidate.id;
        }
      }
    } else if (direction === 'down') {
      if (pRect.top >= cRect.bottom - 5 || py > cy + 10) {
        const dy = Math.max(0, pRect.top - cRect.bottom);
        const dx = Math.abs(cx - px);
        const overlaps = Math.max(0, Math.min(cRect.right, pRect.right) - Math.max(cRect.left, pRect.left));
        const overlapBonus = overlaps > 0 ? 0 : 500;
        const score = dy * 2 + dx + overlapBonus;
        if (score < bestScore) {
          bestScore = score;
          bestTarget = candidate.id;
        }
      }
    } else if (direction === 'up') {
      if (pRect.bottom <= cRect.top + 5 || py < cy - 10) {
        const dy = Math.max(0, cRect.top - pRect.bottom);
        const dx = Math.abs(cx - px);
        const overlaps = Math.max(0, Math.min(cRect.right, pRect.right) - Math.max(cRect.left, pRect.left));
        const overlapBonus = overlaps > 0 ? 0 : 500;
        const score = dy * 2 + dx + overlapBonus;
        if (score < bestScore) {
          bestScore = score;
          bestTarget = candidate.id;
        }
      }
    }
  }

  if (bestTarget) {
    return { type: 'pane', id: bestTarget };
  }

  // If navigating up and no pane is above, transition to TabBar
  if (direction === 'up') {
    return { type: 'to_tab_bar' };
  }

  return null;
}

export const FOCUSABLE_OVERLAY_SELECTOR = [
  'button:not([disabled])',
  '[role="button"]:not([aria-disabled="true"])',
  '[role="tab"]:not([aria-disabled="true"])',
  '[role="menuitem"]:not([aria-disabled="true"])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
  '[data-spatial-nav="true"]',
].join(', ');

export function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if (typeof window === 'undefined') return true;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
    if (isJsdom) return true;
    return false;
  }
  return rect.width > 0 && rect.height > 0;
}

function getZIndexNumber(el: HTMLElement): number {
  if (typeof window === 'undefined') return 0;
  let curr: HTMLElement | null = el;
  while (curr && curr !== document.body) {
    const style = window.getComputedStyle(curr);
    const z = parseInt(style.zIndex, 10);
    if (!isNaN(z)) return z;
    curr = curr.parentElement;
  }
  return 0;
}

/**
 * Finds the topmost active overlay container (menu popup, modal dialog, or floating overlay).
 */
export function getTopmostOverlay(): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  // 1. Menus (e.g. context menus, dropdowns, profile row action menus) take priority
  const menus = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]')).filter(isElementVisible);
  if (menus.length > 0) {
    return menus[menus.length - 1];
  }

  // 2. Modals / Dialogs
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], [aria-modal="true"], .fixed.inset-0'
    )
  ).filter(isElementVisible);

  if (dialogs.length === 0) return null;

  const refined = dialogs.map((el) => {
    if (el.classList.contains('fixed') && el.classList.contains('inset-0')) {
      const inner = el.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"]');
      if (inner && isElementVisible(inner)) return inner;
    }
    return el;
  });

  let best = refined[0];
  let bestZ = getZIndexNumber(best);

  for (let i = 1; i < refined.length; i++) {
    const el = refined[i];
    if (best.contains(el)) {
      best = el;
      bestZ = getZIndexNumber(el);
      continue;
    }
    if (el.contains(best)) continue;
    const z = getZIndexNumber(el);
    if (z >= bestZ) {
      best = el;
      bestZ = z;
    }
  }

  return best;
}

/**
 * Finds the best adjacent element among candidates in 2D space along the given direction.
 */
export function findAdjacentElement(
  candidates: HTMLElement[],
  current: HTMLElement,
  direction: NavigationDirection
): HTMLElement | null {
  if (candidates.length <= 1) return null;

  const cRect = current.getBoundingClientRect();
  const cx = cRect.left + cRect.width / 2;
  const cy = cRect.top + cRect.height / 2;

  let bestCandidate: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of candidates) {
    if (el === current || current.contains(el) || el.contains(current)) continue;
    const pRect = el.getBoundingClientRect();
    const px = pRect.left + pRect.width / 2;
    const py = pRect.top + pRect.height / 2;

    if (direction === 'right') {
      if (pRect.left >= cRect.right - 4 || px > cx + 4) {
        const dx = Math.max(0, pRect.left - cRect.right);
        const dy = Math.abs(cy - py);
        const vOverlap = Math.max(0, Math.min(cRect.bottom, pRect.bottom) - Math.max(cRect.top, pRect.top));
        const overlapBonus = vOverlap > 0 ? 0 : 400;
        const score = dx + dy * 2.5 + overlapBonus;
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = el;
        }
      }
    } else if (direction === 'left') {
      if (pRect.right <= cRect.left + 4 || px < cx - 4) {
        const dx = Math.max(0, cRect.left - pRect.right);
        const dy = Math.abs(cy - py);
        const vOverlap = Math.max(0, Math.min(cRect.bottom, pRect.bottom) - Math.max(cRect.top, pRect.top));
        const overlapBonus = vOverlap > 0 ? 0 : 400;
        const score = dx + dy * 2.5 + overlapBonus;
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = el;
        }
      }
    } else if (direction === 'down') {
      if (pRect.top >= cRect.bottom - 4 || py > cy + 4) {
        const dy = Math.max(0, pRect.top - cRect.bottom);
        const dx = Math.abs(cx - px);
        const hOverlap = Math.max(0, Math.min(cRect.right, pRect.right) - Math.max(cRect.left, pRect.left));
        const overlapBonus = hOverlap > 0 ? 0 : 250;
        const score = dy + dx * 1.8 + overlapBonus;
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = el;
        }
      }
    } else if (direction === 'up') {
      if (pRect.bottom <= cRect.top + 4 || py < cy - 4) {
        const dy = Math.max(0, cRect.top - pRect.bottom);
        const dx = Math.abs(cx - px);
        const hOverlap = Math.max(0, Math.min(cRect.right, pRect.right) - Math.max(cRect.left, pRect.left));
        const overlapBonus = hOverlap > 0 ? 0 : 250;
        const score = dy + dx * 1.8 + overlapBonus;
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = el;
        }
      }
    }
  }

  // If no candidate in strict directional vector, wrap intuitively:
  if (!bestCandidate) {
    if (direction === 'right') {
      const below = candidates.filter(
        (el) => el !== current && el.getBoundingClientRect().top >= cRect.bottom - 4
      );
      if (below.length > 0) {
        below.sort((a, b) => {
          const aR = a.getBoundingClientRect();
          const bR = b.getBoundingClientRect();
          return aR.top === bR.top ? aR.left - bR.left : aR.top - bR.top;
        });
        bestCandidate = below[0];
      } else {
        bestCandidate = candidates[0] !== current ? candidates[0] : candidates[1] || null;
      }
    } else if (direction === 'left') {
      const above = candidates.filter(
        (el) => el !== current && el.getBoundingClientRect().bottom <= cRect.top + 4
      );
      if (above.length > 0) {
        above.sort((a, b) => {
          const aR = a.getBoundingClientRect();
          const bR = b.getBoundingClientRect();
          return aR.top === bR.top ? bR.left - aR.left : bR.top - aR.top;
        });
        bestCandidate = above[0];
      } else {
        const last = candidates[candidates.length - 1];
        bestCandidate = last !== current ? last : candidates[candidates.length - 2] || null;
      }
    } else if (direction === 'down') {
      bestCandidate = candidates[0] !== current ? candidates[0] : candidates[1] || null;
    } else if (direction === 'up') {
      const last = candidates[candidates.length - 1];
      bestCandidate = last !== current ? last : candidates[candidates.length - 2] || null;
    }
  }

  return bestCandidate;
}

/**
 * Handles spatial navigation within an overlay modal, menu, or dialog.
 * Returns true if an element was selected and focused, false otherwise.
 */
export function navigateInOverlay(
  container: HTMLElement,
  direction: NavigationDirection
): boolean {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_OVERLAY_SELECTOR)
  ).filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    return isElementVisible(el);
  });

  if (candidates.length === 0) return false;

  let current: HTMLElement | null = null;
  const active = document.activeElement as HTMLElement | null;
  if (active && container.contains(active)) {
    if (candidates.includes(active)) {
      current = active;
    } else {
      current = candidates.find((c) => c.contains(active)) || null;
    }
  }

  if (!current) {
    const marked = container.querySelector<HTMLElement>('.spatial-nav-active');
    if (marked && candidates.includes(marked)) {
      current = marked;
    }
  }

  const nextTarget = !current
    ? direction === 'up' || direction === 'left'
      ? candidates[candidates.length - 1]
      : candidates[0]
    : findAdjacentElement(candidates, current, direction);

  if (nextTarget) {
    document.querySelectorAll('.spatial-nav-active').forEach((el) => {
      el.classList.remove('spatial-nav-active');
    });

    nextTarget.focus({ preventScroll: true });
    nextTarget.classList.add('spatial-nav-active');
    if (typeof nextTarget.scrollIntoView === 'function') {
      try {
        nextTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      } catch {
        nextTarget.scrollIntoView(false);
      }
    }
    return true;
  }

  return false;
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    () => {
      document.querySelectorAll('.spatial-nav-active').forEach((el) => {
        el.classList.remove('spatial-nav-active');
      });
    },
    { passive: true }
  );
}

