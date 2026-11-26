/**
 * v12 (start plan V12_WORKLOG_IMPORT_START_PLAN.md part B): the key that adds a row, as in the voucher form: Alt+N (and its key
 * on a Persian layout, «د») or Insert. Shared by the batch work-log form and the sales invoice's line picker.
 */
export const isAddRowShortcut = (e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'> & { repeat?: boolean }): boolean => {
  // a held key adds one row, not one per repeat; Shift+Insert (paste) and Ctrl+Insert (copy) stay the browser's
  if (e.repeat) return false;
  if (e.key === 'Insert') return !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  return e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'N' || e.key === 'د');
};

/** a window open over the page (a dialog or an alert): a page-level shortcut leaves it alone */
export const windowOpenOverPage = (): boolean => !!document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]');

/** the add-row button's title: the key names as printed on the keyboard */
export const ADD_ROW_SHORTCUT_TITLE = 'کلید میان‌بر: Alt+N یا Insert';
