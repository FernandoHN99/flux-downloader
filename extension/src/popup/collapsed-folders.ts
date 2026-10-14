/**
 * Which of the user's folders are collapsed. This is how the popup looks, not
 * a setting, so it has a key of its own: the settings page rewrites the whole
 * settings object and must not be able to clobber it.
 */
const KEY = 'collapsedFolders';

export async function loadCollapsedFolders(): Promise<Set<string>> {
  try {
    const stored = await chrome.storage.local.get(KEY);
    const ids = stored?.[KEY];
    if (!Array.isArray(ids)) return new Set();
    return new Set(ids.filter((id): id is string => typeof id === 'string'));
  } catch {
    // Remembering is a convenience: without it every folder simply starts open.
    return new Set();
  }
}

/** `existing`, when given, drops the ids of folders that have been deleted. */
export async function saveCollapsedFolders(
  collapsed: ReadonlySet<string>,
  existing?: readonly string[]
): Promise<void> {
  const known = existing ? new Set(existing) : null;
  const ids = [...collapsed].filter((id) => !known || known.has(id));
  try {
    await chrome.storage.local.set({ [KEY]: ids });
  } catch {
    // A failed save costs only the memory of one toggle.
  }
}
