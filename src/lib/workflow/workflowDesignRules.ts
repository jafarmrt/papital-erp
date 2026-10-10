/**
 * v9.0.45 (TD-452، B14-10): قواعد ساختاری طرح گردش کار، مشترک سرور (ذخیره تعریف، ۴۲۲) و طراح (پیش از ذخیره).
 * پیش‌تر طرح بی گام آغاز، با دو گام آغاز، کلید تکراری یا خروج از گام پایانی ذخیره می‌شد و اقدامی که مبدأ یا
 * مقصدش پیدا نمی‌شد بی‌صدا حذف می‌شد.
 */

import { isCatalogPermission } from '../permissions/permissionCatalog';

export const WORKFLOW_STATE_TYPES = ['initial', 'intermediate', 'normal', 'terminal'] as const;
export const WORKFLOW_APPROVAL_RULE_TYPES = ['SINGLE', 'AND_ALL', 'OR_ANY', 'K_OF_N'] as const;

/** گام پایانی ردشده تنها گام پایانی است که اقدام خروجی دارد (بازگشایی فرایند ردشده، TD-379) */
export const REJECTED_STATE_KEY = 'rejected';

export interface WorkflowDesignState {
  id?: unknown;
  stateKey?: unknown;
  key?: unknown;
  title?: unknown;
  stateType?: unknown;
}

export interface WorkflowDesignTransition {
  fromStateId?: unknown;
  fromStateKey?: unknown;
  from?: unknown;
  toStateId?: unknown;
  toStateKey?: unknown;
  to?: unknown;
  actionKey?: unknown;
  key?: unknown;
  title?: unknown;
  approvalRuleType?: unknown;
  parallelApprovalRule?: unknown;
  kValue?: unknown;
  requiredRole?: unknown;
  requiredPermission?: unknown;
  isInitiatorExcluded?: unknown;
  isInitiatorOnly?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const flagOn = (v: unknown): boolean => v === true || Number(v) === 1;
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function designStateKey(state: WorkflowDesignState): string {
  return text(state.stateKey) || text(state.key);
}

/** مبدأ و مقصد اقدام همان‌طور که سرویس ذخیره آن‌ها را به گام وصل می‌کند: شناسه، سپس کلید */
export function transitionEndpoints(tr: WorkflowDesignTransition): { from: unknown; to: unknown } {
  return { from: tr.fromStateId ?? tr.fromStateKey ?? tr.from, to: tr.toStateId ?? tr.toStateKey ?? tr.to };
}

/** نگاشت شناسه یا کلید طراح به گام؛ همان کلیدهایی که سرویس ذخیره می‌پذیرد */
export function designStateLookup<T extends WorkflowDesignState>(states: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const st of states) {
    if (st.id !== undefined && st.id !== null && st.id !== '') map.set(`id:${String(st.id)}`, st);
    const key = designStateKey(st);
    if (key) map.set(`key:${key}`, st);
  }
  return map;
}

export function resolveDesignState<T extends WorkflowDesignState>(lookup: Map<string, T>, ref: unknown): T | undefined {
  if (ref === undefined || ref === null || ref === '') return undefined;
  if (typeof ref === 'number') return lookup.get(`id:${ref}`);
  if (typeof ref !== 'string') return undefined;
  return lookup.get(`key:${ref.trim()}`) ?? lookup.get(`id:${ref.trim()}`);
}

const stateLabel = (st: WorkflowDesignState, index: number): string => `«${text(st.title) || designStateKey(st) || `گام ${index + 1}`}»`;
const transitionLabel = (tr: WorkflowDesignTransition, index: number): string => `«${text(tr.title) || text(tr.actionKey) || text(tr.key) || `اقدام ${index + 1}`}»`;

/** خطاهای ساختاری طرح (فارسی)؛ آرایه خالی یعنی طرح درست است */
export function workflowDesignErrors(states: unknown, transitions: unknown): string[] {
  if (!Array.isArray(states)) return ['فهرست گام‌ها باید آرایه باشد.'];
  if (states.length === 0) return ['گردش کار دست‌کم یک گام آغاز و یک گام پایان می‌خواهد.'];
  if (transitions !== undefined && transitions !== null && !Array.isArray(transitions)) return ['فهرست اقدام‌ها باید آرایه باشد.'];

  const errors: string[] = [];
  const validStates: WorkflowDesignState[] = [];
  const seenKeys = new Set<string>();
  states.forEach((raw, i) => {
    if (!isRecord(raw)) {
      errors.push(`گام ${i + 1} نامعتبر است.`);
      return;
    }
    const st = raw as WorkflowDesignState;
    const key = designStateKey(st);
    if (!key) errors.push(`گام ${stateLabel(st, i)} کلید ندارد.`);
    else if (seenKeys.has(key)) errors.push(`کلید گام «${key}» تکراری است؛ هر گام کلید یکتای خودش را می‌خواهد.`);
    else seenKeys.add(key);
    if (!text(st.title)) errors.push(`گام ${stateLabel(st, i)} عنوان ندارد.`);
    if (st.stateType !== undefined && !(WORKFLOW_STATE_TYPES as readonly unknown[]).includes(st.stateType)) {
      errors.push(`نوع گام ${stateLabel(st, i)} نامعتبر است؛ آغاز، میانی یا پایان را برگزینید.`);
    }
    validStates.push(st);
  });

  const initialCount = validStates.filter(s => s.stateType === 'initial').length;
  if (initialCount === 0) errors.push('گردش کار گام آغاز ندارد؛ دقیقاً یک گام را «آغاز» کنید.');
  if (initialCount > 1) errors.push(`گردش کار ${initialCount} گام آغاز دارد؛ دقیقاً یک گام باید «آغاز» باشد.`);
  if (!validStates.some(s => s.stateType === 'terminal')) errors.push('گردش کار گام پایان ندارد؛ دست‌کم یک گام را «پایان» کنید.');

  const lookup = designStateLookup(validStates);
  const list = Array.isArray(transitions) ? transitions : [];
  list.forEach((raw, i) => {
    if (!isRecord(raw)) {
      errors.push(`اقدام ${i + 1} نامعتبر است.`);
      return;
    }
    const tr = raw as WorkflowDesignTransition;
    const { from, to } = transitionEndpoints(tr);
    const fromState = resolveDesignState(lookup, from);
    const toState = resolveDesignState(lookup, to);
    if (!fromState) errors.push(`گام مبدأ اقدام ${transitionLabel(tr, i)} پیدا نشد.`);
    if (!toState) errors.push(`گام مقصد اقدام ${transitionLabel(tr, i)} پیدا نشد.`);
    if (fromState && fromState.stateType === 'terminal' && designStateKey(fromState) !== REJECTED_STATE_KEY) {
      errors.push(`اقدام ${transitionLabel(tr, i)} از گام پایانی ${stateLabel(fromState, 0)} بیرون می‌رود؛ فرایند پایان‌یافته ادامه نمی‌یابد.`);
    }
    const rule = tr.approvalRuleType ?? tr.parallelApprovalRule;
    if (rule !== undefined && rule !== null && rule !== '' && !(WORKFLOW_APPROVAL_RULE_TYPES as readonly unknown[]).includes(rule)) {
      errors.push(`قاعده امضای اقدام ${transitionLabel(tr, i)} نامعتبر است.`);
    }
    if (tr.kValue !== undefined && tr.kValue !== null && !(Number.isInteger(tr.kValue) && Number(tr.kValue) >= 1)) {
      errors.push(`شمار امضای اقدام ${transitionLabel(tr, i)} باید عدد درست و دست‌کم ۱ باشد.`);
    }
    // v9.0.128 (TD-542، مدل مجوز §۴.۲): هر اقدام یک مجوز از فهرست مجوزها می‌خواهد و اختیاراً یک نقش مشخص؛ وجود نقش را
    // سرور هنگام ذخیره می‌سنجد
    const permission = text(tr.requiredPermission);
    if (permission && !isCatalogPermission(permission)) {
      errors.push(`مجوز لازم اقدام ${transitionLabel(tr, i)} («${permission}») در فهرست مجوزها نیست؛ آن را از فهرست برگزینید.`);
    }
    // v10.0.120 (TD-1220): «فقط آغازکننده» و «آغازکننده تأیید نکند» با هم اقدام را برای همه می‌بندند
    if (flagOn(tr.isInitiatorOnly) && flagOn(tr.isInitiatorExcluded)) {
      errors.push(`اقدام ${transitionLabel(tr, i)} هم «فقط آغازکننده اجرا کند» دارد و هم «آغازکننده تأیید نکند»؛ یکی را بردارید.`);
    }
    if (text(tr.requiredRole).includes('.')) {
      errors.push(`نقش اقدام ${transitionLabel(tr, i)} کلید مجوز است؛ آن را در «مجوز لازم» بگذارید و نقش را از فهرست نقش‌ها برگزینید.`);
    }
  });

  return errors;
}

/** تغییر کلید یک گام در طراح؛ اقدام‌های آن گام همراهش می‌مانند (پیش‌تر به کلید قدیم می‌ماندند و با ذخیره حذف می‌شدند) */
export function renameDesignStateKey<N extends { stateKey: string }, E extends { fromStateKey: string; toStateKey: string }>(
  nodes: N[], edges: E[], oldKey: string, newKey: string,
): { nodes: N[]; edges: E[] } {
  return {
    nodes: nodes.map(n => (n.stateKey === oldKey ? { ...n, stateKey: newKey } : n)),
    edges: edges.map(e => ({
      ...e,
      fromStateKey: e.fromStateKey === oldKey ? newKey : e.fromStateKey,
      toStateKey: e.toStateKey === oldKey ? newKey : e.toStateKey,
    })),
  };
}

/** v9.0.47 (TD-454): ترتیب گامی که طراح می‌خواند یا می‌سازد؛ ترتیب ذخیره‌شده، وگرنه جای گام در فهرست */
export function designStepOrder(stored: unknown, index: number): number {
  const n = Number(stored);
  return Number.isInteger(n) && n > 0 ? n : index + 1;
}

/** ترتیب گام تازه طراح: یکی بیش از بزرگ‌ترین ترتیب موجود */
export function nextDesignStepOrder(nodes: Array<{ stepOrder?: number }>): number {
  return nodes.reduce((max, n) => Math.max(max, Number(n.stepOrder) || 0), 0) + 1;
}
