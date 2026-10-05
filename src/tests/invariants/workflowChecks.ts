import { makeTestCase, type TestCaseResult } from '../types.js';
import { getErrorMessage } from '../../utils/formatters.js';
import {
  checkMultiSignTaskStaysOpen, checkRunningInstanceKeepsTasksAfterEdit, checkSignaturesResetOnReentry,
  checkTaskAndTransitionNoDeadlock, checkTaskRunsItsOwnTransition, checkViewPermissionCannotApprove,
} from './workflowScenarios.js';
import { checkRequisitionActionFollowsWorkflow } from './workflowProcurementScenarios.js';
import { checkTransitionRequiredPermission } from './workflowPermissionScenarios.js';
import { checkAndAllNeedsEveryMember, checkDelegateActsForDelegatorRole, checkDelegationRevokedByDelegatorOnly } from './workflowDelegationScenarios.js';

/** آزمون‌های سخت‌گیرانه حوزه G (گردش‌کار و تأیید) در سوئیت workflow: [شناسه، نام، بررسی، شرح موفقیت] */
export const WORKFLOW_CHECKS: Array<[string, string, () => Promise<string[]>, string]> = [
  ['wf_td_370_task_runs_own_transition', 'v8.0.81: کار کارتابل انتقال خودش را اجرا می‌کند و «رد» فقط انتقال رد را؛ گام بی‌انتقال رد «رد» نمی‌پذیرد (TD-370)',
    checkTaskRunsItsOwnTransition, 'ارسال مدیر و کاربر عادی به «بررسی» رفت؛ «رد» بی‌انتقال رد رد شد؛ «رد» با انتقال رد فرایند را رد کرد'],
  ['wf_td_371_multi_sign_task_stays_open', 'v8.0.82: کار امضای چندنفره (K_OF_N) تا رسیدن حدنصاب در کارتابل باز می‌ماند و امضای دوم از کارتابل پذیرفته می‌شود (TD-371)',
    checkMultiSignTaskStaysOpen, 'کار پس از امضای اول باز ماند؛ امضای تکراری شمرده نشد؛ امضای دوم فرایند را تمام کرد'],
  ['wf_td_372_running_instance_tasks_after_edit', 'v8.0.83: فرایند در جریان پس از ویرایش طرح کار و مهلت گام بعد را از تصویر نسخه خودش می‌گیرد (TD-372)',
    checkRunningInstanceKeepsTasksAfterEdit, 'گام دوم یک کار با انتقال نسخه خودش و مهلت ۵ ساعت گرفت و فرایند تمام شد'],
  ['wf_td_373_signatures_reset_on_reentry', 'v8.0.84: امضاهای گام پس از بازگشت فرایند به همان گام از نو شمرده می‌شوند (TD-373)',
    checkSignaturesResetOnReentry, 'امضای دور قبل شمرده نشد؛ دو امضای تازه حدنصاب را کامل کرد'],
  ['wf_td_374_view_permission_cannot_approve', 'v8.0.85: مجوز مشاهده یا خزانه گام نقش انبار یا حسابدار را اجرا نمی‌کند و نقش تولید گام مدیر را (TD-374)',
    checkViewPermissionCannotApprove, 'پنج دسترسی نابجا رد و هفت دسترسی درست پذیرفته شد؛ API انتقال هم رد کرد'],
  ['wf_td_375_task_transition_no_deadlock', 'v8.0.86: اجرای کار کارتابل هم‌زمان با اجرای مستقیم همان گام به بن‌بست نمی‌رسد و گام یک بار اجرا می‌شود (TD-375)',
    checkTaskAndTransitionNoDeadlock, 'در سه دور هم‌زمان بی‌بن‌بست، گام یک بار اجرا شد'],
  ['wf_td_376_and_all_every_member', 'v8.0.87: گام «اتفاق آرا» (AND_ALL) امضای همه کاربران فعال نقش را می‌خواهد و گام بی‌نقش K طراح را (TD-376)',
    checkAndAllNeedsEveryMember, 'نقش سه‌نفره با سه امضا، نقش یک‌نفره با یک امضا و گام بی‌نقش با K=۲ رد شد'],
  ['wf_td_377_delegate_acts_for_role', 'v8.0.88: جانشین در بازه و حوزه تفویض کارهای نقش تفویض‌کننده را می‌بیند و به نام او امضا می‌کند و یک نفر دو امضا نمی‌شمارد (TD-377)',
    checkDelegateActsForDelegatorRole, 'جانشین کار را دید و به نام تفویض‌کننده امضا کرد؛ امضای دوم رد شد؛ تفویض حوزه دیگر و لغوشده رد شد؛ یادآوری رسید'],
  ['wf_td_378_delegation_revoked_by_delegator', 'v8.0.89: تفویض را فقط تفویض‌کننده یا ادمین لغو می‌کند و ورودی نادرست تفویض ۴۲۲ است، نه ۵۰۰ (TD-378)',
    checkDelegationRevokedByDelegatorOnly, 'لغو جانشین ۴۰۳؛ تفویض‌کننده و ادمین لغو کردند؛ ورودی نادرست ۴۲۲ و ناموجود ۴۰۴'],
  ['wf_td_379_requisition_action_follows_workflow', 'v8.0.90: اقدام گردش‌کار درخواست خرید فقط انتقال گام جاری را اجرا می‌کند؛ درخواست دریافت‌شده بازگشایی و دوباره دریافت نمی‌شود (TD-379)',
    checkRequisitionActionFollowsWorkflow, 'بازگشایی درخواست دریافت‌شده رد شد؛ موجودی ۱۰ ماند'],
  ['wf_td_391_transition_required_permission', 'v8.0.91: انتقالی که «مجوز لازم» دارد فقط برای دارنده آن مجوز یا ادمین اجرا و پیشنهاد می‌شود (TD-391)',
    checkTransitionRequiredPermission, 'کاربر بی مجوز ۴۰۳ گرفت و انتقال به او پیشنهاد نشد؛ نقش دارای مجوز، مجوز خود کاربر و ادمین اجرا کردند'],
];

export async function runWorkflowChecks(shouldRun: (id: string) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  for (const [id, name, check, okDetail] of WORKFLOW_CHECKS) {
    if (!shouldRun(id)) continue;
    const start = Date.now();
    let problems: string[];
    try {
      problems = await check();
    } catch (err) {
      problems = [`خطای پیش‌بینی‌نشده: ${getErrorMessage(err)}`];
    }
    const passed = problems.length === 0;
    results.push(makeTestCase({
      id, name, layer: 'workflow', executionType: 'real_database', passed, durationMs: Date.now() - start,
      ...(passed ? { details: okDetail } : { error: problems.join(' | ') }),
    }));
  }
  return results;
}
