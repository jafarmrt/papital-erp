/**
 * v12 (start plan V12_WORKLOG_IMPORT_START_PLAN.md part B): the key that adds a row, as in the voucher form: Alt+N (and its key
 * on a Persian layout, «د») or Insert. Shared by the batch work-log form and the sales invoice's line picker.
 */
export const isAddRowShortcut = (e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'key'>): boolean =>
  (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'N' || e.key === 'د')) || (e.key === 'Insert' && !e.altKey && !e.ctrlKey);
