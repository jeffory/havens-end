import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Action } from '../core/Controls';
import { focusFirst, moveFocus, recoverFocus } from './menuNav';

/** What a screen does with the controller's tab and back buttons. */
export interface NavHandlers {
  tab?: (step: 1 | -1) => void;
  back?: () => void;
  /** The chart button: a port screen shows its chart tab. */
  chart?: () => void;
}

export type ScreenKind = 'port' | 'chart' | 'build' | 'store' | 'system';

/**
 * The full-screen menus (port, chart), drawn with React over the 3D view. The game
 * says what to show; the screens act on the simulation through the objects they're
 * given and re-render themselves. Controller and arrow-key input arrives here as menu
 * actions and becomes focus moves and clicks, so every menu works without a mouse.
 */
export class Overlay {
  private readonly el = document.createElement('div');
  private readonly root: Root;
  readonly handlers: NavHandlers = {};
  kind: ScreenKind | null = null;
  /** Where focus last was, to recover from a focused button being disabled or removed. */
  private lastFocus: DOMRect | undefined;

  constructor(parent: HTMLElement) {
    this.el.className = 'overlay';
    this.el.hidden = true;
    // Arrow keys move the selection (see Controls); don't let them scroll the panel as well.
    this.el.addEventListener('keydown', (e) => {
      if (e.key.startsWith('Arrow')) e.preventDefault();
    });
    this.el.addEventListener('focusin', (e) => {
      if (e.target instanceof HTMLElement) this.lastFocus = e.target.getBoundingClientRect();
    });
    // A click that disables its own button (buying the last you can afford) drops focus: pick it back up nearby.
    this.el.addEventListener('click', () =>
      requestAnimationFrame(() => {
        if (this.kind && !this.el.contains(document.activeElement)) recoverFocus(this.el, this.lastFocus);
      }),
    );
    parent.append(this.el);
    this.root = createRoot(this.el);
  }

  show(kind: ScreenKind, screen: ReactNode): void {
    const fresh = this.kind !== kind;
    if (fresh) {
      // A different screen: forget the old one's handlers (a re-render keeps them).
      this.lastFocus = undefined;
      this.handlers.tab = undefined;
      this.handlers.back = undefined;
      this.handlers.chart = undefined;
    }
    this.kind = kind;
    this.el.hidden = false;
    this.root.render(screen);
    // A new screen starts with its first (or data-autofocus) control focused, for keys and pads.
    if (fresh) requestAnimationFrame(() => this.el.contains(document.activeElement) || focusFirst(this.el));
  }

  hide(): void {
    this.kind = null;
    this.lastFocus = undefined;
    this.root.render(null);
    this.el.hidden = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  /** A menu action from the keyboard or a gamepad. */
  nav(action: Action): void {
    switch (action) {
      case 'navUp':
        return moveFocus(this.el, 'up', this.lastFocus);
      case 'navDown':
        return moveFocus(this.el, 'down', this.lastFocus);
      case 'navLeft':
        return moveFocus(this.el, 'left', this.lastFocus);
      case 'navRight':
        return moveFocus(this.el, 'right', this.lastFocus);
      case 'confirm': {
        const active = document.activeElement;
        if (active instanceof HTMLElement && this.el.contains(active)) active.click();
        else recoverFocus(this.el, this.lastFocus);
        return;
      }
      case 'back':
        return this.handlers.back?.();
      case 'tabPrev':
        return this.handlers.tab?.(-1);
      case 'tabNext':
        return this.handlers.tab?.(1);
      case 'chart':
        return this.handlers.chart?.();
    }
  }
}
