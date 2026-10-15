/**
 * v10.1.17 (TD-1270, D-06 part D): what an unpublished draft changes against the published version, shared by the server
 * (`GET /workflow/definitions/:id/draft`) and the publish window. Steps are matched by their key and actions by their
 * source step, target step and action key, never by database id: every design save gives the rows new ids. Canvas
 * positions are layout only and are not compared.
 */

export interface VersionDiffState {
  id?: number | string;
  stateKey?: string | null;
  title?: string | null;
  stateType?: string | null;
  slaHours?: number | null;
}

export interface VersionDiffTransition {
  fromStateId?: number | string | null;
  toStateId?: number | string | null;
  actionKey?: string | null;
  title?: string | null;
  requiredRole?: string | null;
  requiredPermission?: string | null;
  approvalRuleType?: string | null;
  kValue?: number | null;
  ruleConditionsJson?: unknown;
  autoActionKey?: string | null;
  isInitiatorExcluded?: number | boolean | null;
  isInitiatorOnly?: number | boolean | null;
}

export interface VersionDiffDesign {
  states?: VersionDiffState[] | null;
  transitions?: VersionDiffTransition[] | null;
}

export interface VersionDiffChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface VersionDiffItem {
  key: string;
  title: string;
  changes: VersionDiffChange[];
}

export interface WorkflowVersionDiff {
  addedSteps: VersionDiffItem[];
  removedSteps: VersionDiffItem[];
  changedSteps: VersionDiffItem[];
  addedActions: VersionDiffItem[];
  removedActions: VersionDiffItem[];
  changedActions: VersionDiffItem[];
  /** nothing a record would notice differs */
  unchanged: boolean;
}

const STATE_TYPE_TEXT: Record<string, string> = { initial: 'آغاز', terminal: 'پایان', intermediate: 'میانی', normal: 'میانی' };
const APPROVAL_RULE_TEXT: Record<string, string> = { SINGLE: 'یک امضا', AND_ALL: 'همه اعضای نقش', OR_ANY: 'یکی از اعضا', K_OF_N: 'K امضا از N' };
const flag = (v: unknown) => (v === true || Number(v) === 1 ? 'بله' : 'خیر');
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

const STEP_FIELDS: ReadonlyArray<{ field: keyof VersionDiffState; label: string; show: (v: unknown) => string }> = [
  { field: 'title', label: 'عنوان', show: text },
  { field: 'stateType', label: 'نوع گام', show: (v) => STATE_TYPE_TEXT[text(v)] ?? (text(v) || 'میانی') },
  { field: 'slaHours', label: 'مهلت انجام (ساعت)', show: (v) => text(Number(v) || 24) },
];

const ACTION_FIELDS: ReadonlyArray<{ field: keyof VersionDiffTransition; label: string; show: (v: unknown) => string }> = [
  { field: 'title', label: 'عنوان', show: text },
  { field: 'requiredRole', label: 'نقش', show: text },
  { field: 'requiredPermission', label: 'مجوز', show: text },
  { field: 'approvalRuleType', label: 'قاعده امضا', show: (v) => APPROVAL_RULE_TEXT[text(v) || 'SINGLE'] ?? text(v) },
  { field: 'kValue', label: 'شمار امضا', show: (v) => text(Number(v) || 1) },
  { field: 'ruleConditionsJson', label: 'شرط', show: (v) => (Array.isArray(v) && v.length === 0) || v === null || v === undefined ? '' : JSON.stringify(v) },
  { field: 'autoActionKey', label: 'اقدام خودکار', show: text },
  { field: 'isInitiatorExcluded', label: 'آغازکننده تأیید نکند', show: flag },
  { field: 'isInitiatorOnly', label: 'فقط آغازکننده اجرا کند', show: flag },
];

function stepsByKey(design: VersionDiffDesign) {
  const states = Array.isArray(design.states) ? design.states : [];
  const keyOfId = new Map(states.map(s => [String(s.id), text(s.stateKey)]));
  return { byKey: new Map(states.map(s => [text(s.stateKey), s])), keyOfId };
}

function actionsByKey(design: VersionDiffDesign, keyOfId: Map<string, string>) {
  const transitions = Array.isArray(design.transitions) ? design.transitions : [];
  const titleOf = (t: VersionDiffTransition) => text(t.title) || text(t.actionKey);
  return new Map(transitions.map(t => {
    const from = keyOfId.get(String(t.fromStateId)) ?? '?';
    const to = keyOfId.get(String(t.toStateId)) ?? '?';
    return [`${from}>${to}>${text(t.actionKey)}`, { t, title: titleOf(t) }];
  }));
}

function fieldChanges<T>(before: T, after: T, fields: ReadonlyArray<{ field: keyof T; label: string; show: (v: unknown) => string }>): VersionDiffChange[] {
  return fields.flatMap(({ field, label, show }) => {
    const b = show(before[field]);
    const a = show(after[field]);
    return b === a ? [] : [{ field: String(field), label, before: b, after: a }];
  });
}

/** The draft's steps and actions added, removed and changed against the published version. */
export function workflowVersionDiff(published: VersionDiffDesign, draft: VersionDiffDesign): WorkflowVersionDiff {
  const pub = stepsByKey(published);
  const dra = stepsByKey(draft);
  const stepTitle = (s: VersionDiffState) => text(s.title) || text(s.stateKey);
  const addedSteps = [...dra.byKey].filter(([k]) => !pub.byKey.has(k)).map(([k, s]) => ({ key: k, title: stepTitle(s), changes: [] }));
  const removedSteps = [...pub.byKey].filter(([k]) => !dra.byKey.has(k)).map(([k, s]) => ({ key: k, title: stepTitle(s), changes: [] }));
  const changedSteps = [...dra.byKey].flatMap(([k, s]) => {
    const before = pub.byKey.get(k);
    const changes = before ? fieldChanges(before, s, STEP_FIELDS) : [];
    return changes.length > 0 ? [{ key: k, title: stepTitle(s), changes }] : [];
  });

  const pubActions = actionsByKey(published, pub.keyOfId);
  const draActions = actionsByKey(draft, dra.keyOfId);
  const addedActions = [...draActions].filter(([k]) => !pubActions.has(k)).map(([k, a]) => ({ key: k, title: a.title, changes: [] }));
  const removedActions = [...pubActions].filter(([k]) => !draActions.has(k)).map(([k, a]) => ({ key: k, title: a.title, changes: [] }));
  const changedActions = [...draActions].flatMap(([k, a]) => {
    const before = pubActions.get(k);
    const changes = before ? fieldChanges(before.t, a.t, ACTION_FIELDS) : [];
    return changes.length > 0 ? [{ key: k, title: a.title, changes }] : [];
  });

  const unchanged = [addedSteps, removedSteps, changedSteps, addedActions, removedActions, changedActions].every(list => list.length === 0);
  return { addedSteps, removedSteps, changedSteps, addedActions, removedActions, changedActions, unchanged };
}

export type WorkflowVersionStatus = 'draft' | 'published' | 'retired';

export const WORKFLOW_VERSION_STATUS_LABELS: Record<WorkflowVersionStatus, string> = {
  draft: 'پیش‌نویس',
  published: 'منتشرشده',
  retired: 'کنارگذاشته',
};

/** The publish window and the definition card: whether a definition has a draft that is not published yet. */
export function hasUnpublishedDraft(def: { version?: number | null; publishedVersion?: number | null }): boolean {
  const published = Number(def.publishedVersion) || Number(def.version) || 0;
  return (Number(def.version) || 0) > published;
}
