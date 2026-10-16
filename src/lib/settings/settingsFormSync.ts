import type { Dispatch, SetStateAction } from 'react';

/**
 * OBS-R2-94: the settings form keeps the fields the user changed and has not saved yet. A refetch of the settings (a
 * save elsewhere, a window focus) fills only the untouched fields; a successful save makes every field clean again.
 */
export interface SettingsDirtyKeys {
  /** marks a setting key as edited */
  mark(key: string): void;
  /** true while the field of this key holds an unsaved edit */
  has(key: string): boolean;
  /** after a successful save: every field follows the server again */
  clear(): void;
}

export function createSettingsDirtyKeys(): SettingsDirtyKeys {
  const keys = new Set<string>();
  return {
    mark: key => { keys.add(key); },
    has: key => keys.has(key),
    clear: () => { keys.clear(); },
  };
}

/** A state setter that also marks its setting key as edited */
export function trackedSetter<T>(dirty: SettingsDirtyKeys, key: string, set: Dispatch<SetStateAction<T>>): Dispatch<SetStateAction<T>> {
  return value => {
    dirty.mark(key);
    set(value);
  };
}

/** The stored row of a setting key, unless its field holds an unsaved edit */
export function untouchedSetting<T extends { key: string }>(rows: readonly T[], dirty: SettingsDirtyKeys, key: string): T | undefined {
  if (dirty.has(key)) return undefined;
  return rows.find(row => row.key === key);
}
