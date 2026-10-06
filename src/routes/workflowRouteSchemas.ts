import { z } from 'zod';
import { WORKFLOW_APPROVAL_RULE_TYPES, WORKFLOW_STATE_TYPES } from '../lib/workflow/workflowDesignRules.js';

/**
 * v9.0.50 (TD-459، B14-17): بدنه routeهای نوشتنی گردش کار. پیش‌تر `/transition`، `/definitions`، `/positions` و
 * `/delegations` بی Zod بودند: شناسه متنی یا اعشاری به پایگاه‌داده می‌رسید و ۵۰۰ با متن SQL برمی‌گشت، و کل بدنه طراح
 * همان‌طور که رسیده بود در `dsl_json` و `snapshot_data` ذخیره می‌شد. اکنون فقط کلیدهای شناخته نگه داشته می‌شوند.
 */

const positiveId = (label: string) => z.number({ error: `${label} باید عدد صحیح مثبت باشد` })
  .int(`${label} باید عدد صحیح مثبت باشد`).positive(`${label} باید عدد صحیح مثبت باشد`);
const coordinate = z.number({ error: 'مختصات گام باید عدد باشد' }).finite().min(-100000).max(100000).transform(Math.round);
const shortText = (max: number) => z.string().trim().max(max);
/** شناسه یا کلید گام در بدنه طراح (شناسه پایگاه‌داده یا کلید متنی) */
const stateRef = z.union([positiveId('شناسه گام'), z.string().trim().min(1).max(100)]);

const designStateSchema = z.object({
  id: positiveId('شناسه گام').optional(),
  stateKey: shortText(100).optional(),
  key: shortText(100).optional(),
  title: shortText(200),
  stateType: z.enum(WORKFLOW_STATE_TYPES, { error: 'نوع گام باید آغاز، میانی یا پایان باشد' }).optional(),
  color: shortText(30).optional(),
  stepOrder: z.number({ error: 'ترتیب گام باید عدد صحیح مثبت باشد' }).int().positive().max(10000).optional(),
  slaHours: z.number({ error: 'مهلت گام باید عدد باشد' }).int().positive().max(100000).optional(),
  positionX: coordinate.optional(),
  positionY: coordinate.optional(),
});

const designTransitionSchema = z.object({
  id: positiveId('شناسه اقدام').optional(),
  fromStateId: stateRef.optional(),
  toStateId: stateRef.optional(),
  fromStateKey: shortText(100).optional(),
  toStateKey: shortText(100).optional(),
  from: stateRef.optional(),
  to: stateRef.optional(),
  actionKey: shortText(100),
  title: shortText(200).optional(),
  requiredRole: shortText(100).optional(),
  requiredPermission: shortText(100).optional(),
  approvalRuleType: z.enum(WORKFLOW_APPROVAL_RULE_TYPES, { error: 'قاعده امضا نامعتبر است' }).optional(),
  kValue: z.number({ error: 'شمار امضا باید عدد صحیح باشد' }).int().min(1).max(1000).optional(),
  ruleConditionsJson: z.unknown().optional(),
  autoActionKey: shortText(100).optional(),
  isInitiatorExcluded: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
});

export const saveDefinitionSchema = z.object({
  body: z.object({
    id: positiveId('شناسه گردش کار').optional(),
    code: z.string({ error: 'کد گردش کار باید متن باشد' }).trim().min(1, 'کد گردش کار الزامی است').max(100),
    title: z.string({ error: 'عنوان گردش کار باید متن باشد' }).trim().min(1, 'عنوان گردش کار الزامی است').max(300),
    entityType: z.string({ error: 'نوع موجودیت باید متن باشد' }).trim().min(1, 'نوع موجودیت الزامی است').max(50)
      .regex(/^[a-z][a-z0-9_]*$/, 'نوع موجودیت نامعتبر است'),
    description: shortText(2000).optional(),
    version: z.number().int().optional(),
    isActive: z.union([z.literal(0), z.literal(1)]).optional(),
    states: z.array(designStateSchema, { error: 'فهرست گام‌ها باید آرایه باشد' }).max(100),
    transitions: z.array(designTransitionSchema, { error: 'فهرست اقدام‌ها باید آرایه باشد' }).max(500).default([]),
  }),
});

export const executeTransitionSchema = z.object({
  body: z.object({
    instanceId: positiveId('شناسه فرایند'),
    transitionId: positiveId('شناسه اقدام'),
    comment: shortText(2000).optional(),
    snapshotData: z.record(z.string(), z.unknown()).optional()
      .refine(v => v === undefined || JSON.stringify(v).length <= 20000, 'داده پیوست اقدام بیش از اندازه است'),
  }),
});

export const canvasPositionsSchema = z.object({
  body: z.object({
    definitionId: positiveId('شناسه گردش کار'),
    positions: z.array(z.object({ id: positiveId('شناسه گام'), positionX: coordinate, positionY: coordinate }), { error: 'موقعیت گام‌ها باید آرایه باشد' }).min(1, 'موقعیت گام‌ها الزامی است').max(100),
  }),
});

export const createDelegationSchema = z.object({
  body: z.object({
    fromUserId: positiveId('کاربر تفویض‌کننده').optional(),
    toUserId: positiveId('کاربر دریافت‌کننده تفویض'),
    scope: shortText(100).optional(),
    startDate: z.string({ error: 'تاریخ شروع تفویض الزامی است' }).trim().min(1, 'تاریخ شروع تفویض الزامی است').max(40),
    endDate: z.string({ error: 'تاریخ پایان تفویض الزامی است' }).trim().min(1, 'تاریخ پایان تفویض الزامی است').max(40),
    reason: shortText(1000).optional(),
  }),
});
