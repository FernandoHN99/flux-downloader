import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefreshButton } from './RefreshButton';

function mount(refreshing = false) {
  const onRefresh = vi.fn();
  const component = new RefreshButton({ refreshing }, onRefresh);
  document.body.appendChild(component.el);
  component.update();
  return { button: component.el as HTMLButtonElement, component, onRefresh };
}

describe('RefreshButton', () => {
  beforeEach(() => document.body.replaceChildren());

  it('clearly says that every open tab will be refreshed', () => {
    const { button } = mount();

    expect(button.textContent).toBe('Refresh tabs');
    expect(button.getAttribute('aria-label')).toBe('Refresh media from all open tabs');
  });

  it('reports a click once', () => {
    const { button, onRefresh } = mount();

    button.click();

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables itself and reports progress during a refresh', () => {
    const { button, component, onRefresh } = mount();

    component.setState({ refreshing: true });
    button.click();

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Refreshing…');
    expect(button.classList.contains('refreshing')).toBe(true);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
