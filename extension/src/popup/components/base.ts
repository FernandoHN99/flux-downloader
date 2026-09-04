/**
 * The smallest component base that solves this popup's actual problem.
 *
 * Every bug this refactor is answering came from one of two things: reaching
 * into `document` for elements another piece of code owned, or patching the
 * DOM by hand until it disagreed with the state behind it. So a component
 * owns exactly one element, only ever queries inside it, and redraws from
 * state rather than being edited in place.
 *
 * Redrawing wholesale has a cost the old code ran into head-on: it destroys
 * whatever the user was typing. `renderHistory` used to bail out entirely
 * while a rename input was open, which then dropped detections that arrived
 * meanwhile. Instead of forbidding the redraw, `update()` carries focus and
 * the text selection across it — see `data-focus-id`.
 */
export abstract class Component<S = Record<string, never>> {
  readonly el: HTMLElement;
  protected state: S;

  constructor(options: { tag?: string; className?: string; state: S }) {
    this.el = document.createElement(options.tag ?? 'div');
    if (options.className) this.el.className = options.className;
    this.state = options.state;
  }

  /** Merge a patch into the state and redraw. */
  setState(patch: Partial<S>): void {
    this.state = { ...this.state, ...patch };
    this.update();
  }

  /** Redraw from the current state, keeping focus where the user left it. */
  update(): void {
    const restoreFocus = captureFocus(this.el);
    this.render();
    restoreFocus();
  }

  /** Build this component's DOM inside `el`. Called by `update()`. */
  protected abstract render(): void;

  destroy(): void {
    this.el.remove();
  }
}

/**
 * Focus survives a redraw only for elements tagged with `data-focus-id`,
 * which is how a component says "this is the same field afterwards". Text
 * selection and caret position ride along, so typing is not interrupted.
 */
function captureFocus(root: HTMLElement): () => void {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) return () => { /* focus was elsewhere */ };

  const focusId = active.dataset.focusId;
  if (!focusId) return () => { /* not marked as surviving a redraw */ };

  const field = active as HTMLInputElement;
  const start = typeof field.selectionStart === 'number' ? field.selectionStart : null;
  const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : null;

  return () => {
    const next = root.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`);
    if (!next) return;
    next.focus();
    if (start === null) return;
    try {
      (next as HTMLInputElement).setSelectionRange(start, end ?? start);
    } catch {
      // Not a field that carries a selection; focus alone is enough.
    }
  };
}
