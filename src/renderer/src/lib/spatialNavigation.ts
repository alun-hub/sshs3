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

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Scoring {
  /** How far a candidate's near edge may overlap the current box and still count as "in that direction". */
  edgeTolerance: number;
  /** Alternatively, how far its center must be past the current center. */
  centerTolerance: number;
  /** Weight of the gap along the movement axis / the offset across it. */
  gapWeight: number;
  crossWeight: number;
  /** Penalty when the two boxes share no span on the cross axis. */
  noOverlapPenalty: number;
}

const PANE_SCORING: Scoring = { edgeTolerance: 5, centerTolerance: 10, gapWeight: 2, crossWeight: 1, noOverlapPenalty: 500 };

const ELEMENT_SCORING: Record<NavigationDirection, Scoring> = {
  left: { edgeTolerance: 4, centerTolerance: 4, gapWeight: 1, crossWeight: 2.5, noOverlapPenalty: 400 },
  right: { edgeTolerance: 4, centerTolerance: 4, gapWeight: 1, crossWeight: 2.5, noOverlapPenalty: 400 },
  up: { edgeTolerance: 4, centerTolerance: 4, gapWeight: 1, crossWeight: 1.8, noOverlapPenalty: 250 },
  down: { edgeTolerance: 4, centerTolerance: 4, gapWeight: 1, crossWeight: 1.8, noOverlapPenalty: 250 },
};

/** Lower is better; null when `cand` does not lie in `direction` from `cur`. */
function directionalScore(
  cur: Box,
  cand: Box,
  direction: NavigationDirection,
  cfg: Scoring | Record<NavigationDirection, Scoring>
): number | null {
  const scoring = 'edgeTolerance' in cfg ? cfg : cfg[direction];
  const horizontal = direction === 'left' || direction === 'right';
  const forward = direction === 'right' || direction === 'down';
  // Normalize to a movement axis (main) and its perpendicular (cross).
  const [cMin, cMax, cCrossMin, cCrossMax] = horizontal
    ? [cur.left, cur.right, cur.top, cur.bottom]
    : [cur.top, cur.bottom, cur.left, cur.right];
  const [pMin, pMax, pCrossMin, pCrossMax] = horizontal
    ? [cand.left, cand.right, cand.top, cand.bottom]
    : [cand.top, cand.bottom, cand.left, cand.right];
  const cCenter = (cMin + cMax) / 2;
  const pCenter = (pMin + pMax) / 2;

  const inDirection = forward
    ? pMin >= cMax - scoring.edgeTolerance || pCenter > cCenter + scoring.centerTolerance
    : pMax <= cMin + scoring.edgeTolerance || pCenter < cCenter - scoring.centerTolerance;
  if (!inDirection) return null;

  const gap = Math.max(0, forward ? pMin - cMax : cMin - pMax);
  const cross = Math.abs((cCrossMin + cCrossMax) / 2 - (pCrossMin + pCrossMax) / 2);
  const overlap = Math.max(0, Math.min(cCrossMax, pCrossMax) - Math.max(cCrossMin, pCrossMin));
  return gap * scoring.gapWeight + cross * scoring.crossWeight + (overlap > 0 ? 0 : scoring.noOverlapPenalty);
}

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

  let bestTarget: string | null = null;
  let bestScore = Infinity;
  for (const candidate of panes) {
    if (candidate.id === currentId) continue;
    const score = directionalScore(current.rect, candidate.rect, direction, PANE_SCORING);
    if (score !== null && score < bestScore) {
      bestScore = score;
      bestTarget = candidate.id;
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
  if (typeof el.checkVisibility === 'function') {
    // Native, handles display:none ancestors in one call; also skip rendered-but-empty boxes.
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  // Fallback (e.g. jsdom): display:none is not inherited, so walk up.
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none') return false;
    if (node === el && (style.visibility === 'hidden' || style.opacity === '0')) return false;
  }
  return true;
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

  let bestCandidate: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of candidates) {
    if (el === current || current.contains(el) || el.contains(current)) continue;
    const score = directionalScore(cRect, el.getBoundingClientRect(), direction, ELEMENT_SCORING);
    if (score !== null && score < bestScore) {
      bestScore = score;
      bestCandidate = el;
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

/** Clears the keyboard-focus highlight as soon as the mouse is used. Returns an unsubscribe function. */
export function installSpatialNavPointerReset(): () => void {
  const handler = () => {
    document.querySelectorAll('.spatial-nav-active').forEach((el) => {
      el.classList.remove('spatial-nav-active');
    });
  };
  window.addEventListener('pointerdown', handler, { passive: true });
  return () => window.removeEventListener('pointerdown', handler);
}
