import { describe, it, expect, beforeEach } from 'vitest';
import { Component } from './base';

interface CounterState { label: string; value: string }

/** A component with a text field, which is the case that used to break. */
class Field extends Component<CounterState> {
  constructor(state: CounterState) {
    super({ className: 'field', state });
  }
  protected render(): void {
    this.el.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = this.state.label;
    const input = document.createElement('input');
    input.dataset.focusId = 'search';
    input.value = this.state.value;
    this.el.append(heading, input);
  }
}

describe('Component', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('redraws from state rather than being edited in place', () => {
    const field = new Field({ label: 'One', value: '' });
    document.body.appendChild(field.el);
    field.update();
    expect(field.el.querySelector('h2')!.textContent).toBe('One');

    field.setState({ label: 'Two' });
    expect(field.el.querySelector('h2')!.textContent).toBe('Two');
    expect(field.el.querySelectorAll('h2')).toHaveLength(1);
  });

  it('merges a patch instead of replacing the whole state', () => {
    const field = new Field({ label: 'One', value: 'kept' });
    document.body.appendChild(field.el);
    field.setState({ label: 'Two' });
    expect(field.el.querySelector('input')!.value).toBe('kept');
  });

  // The regression this base class exists to prevent: a detection arriving
  // mid-typing used to either wipe the input or be dropped to protect it.
  it('keeps focus and the caret across a redraw', () => {
    const field = new Field({ label: 'One', value: 'rocketseat' });
    document.body.appendChild(field.el);
    field.update();

    const input = field.el.querySelector('input')!;
    input.focus();
    input.setSelectionRange(6, 6);
    expect(document.activeElement).toBe(input);

    field.setState({ label: 'Updated while typing' });

    const after = field.el.querySelector('input')!;
    expect(document.activeElement).toBe(after);
    expect(after.selectionStart).toBe(6);
    expect(after.value).toBe('rocketseat');
  });

  it('preserves a selected range, not just the caret', () => {
    const field = new Field({ label: 'One', value: 'rocketseat' });
    document.body.appendChild(field.el);
    field.update();
    const input = field.el.querySelector('input')!;
    input.focus();
    input.setSelectionRange(0, 6);

    field.setState({ label: 'Two' });

    const after = field.el.querySelector('input')!;
    expect([after.selectionStart, after.selectionEnd]).toEqual([0, 6]);
  });

  it('leaves focus alone when it sits outside the component', () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    const field = new Field({ label: 'One', value: '' });
    document.body.appendChild(field.el);
    field.update();
    outside.focus();

    field.setState({ label: 'Two' });

    expect(document.activeElement).toBe(outside);
  });

  it('detaches its element on destroy', () => {
    const field = new Field({ label: 'One', value: '' });
    document.body.appendChild(field.el);
    field.destroy();
    expect(document.body.contains(field.el)).toBe(false);
  });
});
