import { describe, it, expect, vi } from 'vitest';
import { Store, initialState } from './state';

describe('Store', () => {
  it('starts from a clean state', () => {
    const store = new Store();
    expect(store.get().remote.history).toEqual([]);
    expect(store.get().ui.selectionMode).toBe(false);
    expect(store.get().ui.refreshing).toBe(false);
  });

  it('patches one half without touching the other', () => {
    const store = new Store();
    store.setUi({ selectionMode: true, selectedForDeletion: new Set(['a']) });
    store.setRemote({ history: [{ id: '1' } as never] });

    expect(store.get().ui.selectionMode).toBe(true);
    expect(store.get().ui.selectedForDeletion.has('a')).toBe(true);
    expect(store.get().remote.history).toHaveLength(1);
  });

  // The bug class this split exists for: background messages used to be able
  // to wipe what the user was in the middle of doing.
  it('leaves an in-flight selection alone when remote data arrives', () => {
    const store = new Store();
    store.setUi({ selectionMode: true, selectedForDeletion: new Set(['x']), renamingKey: 'y' });
    store.setRemote({ history: [], currentKeys: new Set(['z']) });

    expect(store.get().ui.selectionMode).toBe(true);
    expect(store.get().ui.selectedForDeletion.has('x')).toBe(true);
    expect(store.get().ui.renamingKey).toBe('y');
  });

  it('replaces the state object rather than mutating it', () => {
    const store = new Store();
    const before = store.get();
    store.setUi({ search: 'react' });
    expect(store.get()).not.toBe(before);
    expect(before.ui.search).toBe('');
  });

  it('notifies subscribers and stops when unsubscribed', () => {
    const store = new Store();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setUi({ search: 'a' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.setUi({ search: 'b' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('delivers a change made from inside a listener instead of losing it', () => {
    const store = new Store(initialState());
    const seen: string[] = [];
    let corrected = false;

    store.subscribe((state) => {
      seen.push(state.ui.search);
      if (!corrected && state.ui.search === 'raw') {
        corrected = true;
        store.setUi({ search: 'normalised' });
      }
    });

    store.setUi({ search: 'raw' });
    expect(seen).toEqual(['raw', 'normalised']);
    expect(store.get().ui.search).toBe('normalised');
  });
});
