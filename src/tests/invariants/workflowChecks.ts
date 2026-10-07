import { makeTestCase, type TestCaseResult } from '../types.js';
import { getErrorMessage } from '../../utils/formatters.js';
import {
  checkMultiSignTaskStaysOpen, checkRunningInstanceKeepsTasksAfterEdit, checkSignaturesResetOnReentry,
  checkTaskAndTransitionNoDeadlock, checkTaskRunsItsOwnTransition, checkViewPermissionCannotApprove,
} from './workflowScenarios.js';
import { checkReceiveApprovesInReceiverName, checkRequisitionActionFollowsWorkflow } from './workflowProcurementScenarios.js';
import { checkInitiatorExcludedStep, checkTransitionRequiredPermission } from './workflowPermissionScenarios.js';
import { checkRequisitionStepNotRewritten, checkWorkflowDocumentAmountInRials } from './workflowObservationScenarios.js';
import { checkAndAllNeedsEveryMember, checkDelegateActsForDelegatorRole, checkDelegationRevokedByDelegatorOnly } from './workflowDelegationScenarios.js';
import {
  checkDeliveryWithoutUserIdNotAttributedToUserOne, checkDocumentApprovalFinalizesInTransaction, checkOpeningApprovalsFollowTransaction,
  checkRefusedReceiveLeavesNoTrace, checkTransitionEffectsFollowCommit, checkVoucherApprovalRefusedWhenStatusCannotChange,
} from './workflowAutoActionScenarios.js';

/** آزمون‌های سخت‌گیرانه حوزه G (گردش‌کار و تأیید) در سوئیت workflow: [شناسه، نام، بررسی، شرح موفقیت] */
export const WORKFLOW_CHECKS: Array<[string, string, () => Promise<string[]>, string]> = [
  ['wf_td_370_task_runs_own_transition', 'v8.0.90: کار کارتابل انتقال خودش را اجرا می‌کند و «رد» فقط انتقال رد را؛ گام بی‌انتقال رد «رد» نمی‌پذیرد (TD-370)',
    checkTaskRunsItsOwnTransition, 'ارسال مدیر و کاربر عادی به «بررسی» رفت؛ «رد» بی‌انتقال رد رد شد؛ «رد» با انتقال رد فرایند را رد کرد'],
  ['wf_td_371_multi_sign_task_stays_open', 'v8.0.91: کار امضای چندنفره (K_OF_N) تا رسیدن حدنصاب در کارتابل باز می‌ماند و امضای دوم از کارتابل پذیرفته می‌شود (TD-371)',
    checkMultiSignTaskStaysOpen, 'کار پس از امضای اول باز ماند؛ امضای تکراری شمرده نشد؛ امضای دوم فرایند را تمام کرد'],
  ['wf_td_372_running_instance_tasks_after_edit', 'v8.0.92: فرایند در جریان پس از ویرایش طرح کار و مهلت گام بعد را از تصویر نسخه خودش می‌گیرد (TD-372)',
    checkRunningInstanceKeepsTasksAfterEdit, 'گام دوم یک کار با انتقال نسخه خودش و مهلت ۵ ساعت گرفت و فرایند تمام شد'],
  ['wf_td_373_signatures_reset_on_reentry', 'v8.0.93: امضاهای گام پس از بازگشت فرایند به همان گام از نو شمرده می‌شوند (TD-373)',
    checkSignaturesResetOnReentry, 'امضای دور قبل شمرده نشد؛ دو امضای تازه حدنصاب را کامل کرد'],
  ['wf_td_374_view_permission_cannot_approve', 'v8.0.94: مجوز مشاهده یا خزانه گام نقش انبار یا حسابدار را اجرا نمی‌کند و نقش تولید گام مدیر را (TD-374)؛ از v9.0.111 فقط همان نقش (TD-542)',
    checkViewPermissionCannotApprove, 'نه دسترسی نابجا رد و پنج دسترسی درست پذیرفته شد؛ API انتقال هم رد کرد'],
  ['wf_td_375_task_transition_no_deadlock', 'v8.0.95: اجرای کار کارتابل هم‌زمان با اجرای مستقیم همان گام به بن‌بست نمی‌رسد و گام یک بار اجرا می‌شود (TD-375)',
    checkTaskAndTransitionNoDeadlock, 'در سه دور هم‌زمان بی‌بن‌بست، گام یک بار اجرا شد'],
  ['wf_td_376_and_all_every_member', 'v8.0.96: گام «اتفاق آرا» (AND_ALL) امضای همه کاربران فعال نقش را می‌خواهد و گام بی‌نقش K طراح را (TD-376)',
    checkAndAllNeedsEveryMember, 'نقش سه‌نفره با سه امضا، نقش یک‌نفره با یک امضا و گام بی‌نقش با K=۲ رد شد'],
  ['wf_td_377_delegate_acts_for_role', 'v8.0.97: جانشین در بازه و حوزه تفویض کارهای نقش تفویض‌کننده را می‌بیند و به نام او امضا می‌کند و یک نفر دو امضا نمی‌شمارد (TD-377)',
    checkDelegateActsForDelegatorRole, 'جانشین کار را دید و به نام تفویض‌کننده امضا کرد؛ امضای دوم رد شد؛ تفویض حوزه دیگر و لغوشده رد شد؛ یادآوری رسید'],
  ['wf_td_378_delegation_revoked_by_delegator', 'v8.0.98: تفویض را فقط تفویض‌کننده یا ادمین لغو می‌کند و ورودی نادرست تفویض ۴۲۲ است، نه ۵۰۰ (TD-378)',
    checkDelegationRevokedByDelegatorOnly, 'لغو جانشین ۴۰۳؛ تفویض‌کننده و ادمین لغو کردند؛ ورودی نادرست ۴۲۲ و ناموجود ۴۰۴'],
  ['wf_td_379_requisition_action_follows_workflow', 'v8.0.99: اقدام گردش‌کار درخواست خرید فقط انتقال گام جاری را اجرا می‌کند؛ درخواست دریافت‌شده بازگشایی و دوباره دریافت نمی‌شود (TD-379)',
    checkRequisitionActionFollowsWorkflow, 'بازگشایی درخواست دریافت‌شده رد شد؛ موجودی ۱۰ ماند'],
  ['wf_td_390_receive_approves_in_receiver_name', 'v8.0.101: «دریافت کالا»ی درخواستِ تأییدنشده تأیید را به نام دریافت‌کننده ثبت می‌کند و بی اجازه تأیید رد می‌شود (TD-390)',
    checkReceiveApprovesInReceiverName, 'تأیید به نام دریافت‌کننده در تاریخچه ثبت شد؛ دریافت‌کننده بی نقش تأیید ۴۰۳ گرفت و موجودی ۴ ماند'],
  ['wf_td_391_transition_required_permission', 'v8.0.100: انتقالی که «مجوز لازم» دارد فقط برای دارنده آن مجوز یا ادمین اجرا و پیشنهاد می‌شود (TD-391)',
    checkTransitionRequiredPermission, 'کاربر بی مجوز ۴۰۳ گرفت و انتقال به او پیشنهاد نشد؛ نقش دارای مجوز، مجوز خود کاربر و ادمین اجرا کردند'],
  ['wf_td_392_initiator_excluded_step', 'v8.0.102: گام «آغازکننده تأیید نکند» برای آغازکننده و جانشینش بسته است و در کارتابل او نمی‌آید؛ همکار و ادمین اجرا می‌کنند (TD-392)',
    checkInitiatorExcludedStep, 'آغازکننده و جانشینش ۴۰۳ گرفتند؛ کار فقط در کارتابل همکار آمد؛ همکار و ادمین اجرا کردند؛ گام بی تیک باز ماند'],
  ['wf_td_404_document_amount_in_rials', 'v8.0.123: قاعده مبلغ گردش‌کار سند مبلغ قابل پرداخت ریالی را می‌سنجد (با مالیات، هزینه خدمات و تسعیر) و سند ارزی بی نرخ از هیچ شرط مبلغی نمی‌گذرد (TD-404)',
    checkWorkflowDocumentAmountInRials, 'فاکتور ۱۱۰ دلاری ۵۵ میلیون ریال سنجیده شد؛ فاکتور ریالی ۱٬۱۵۰٬۰۰۰ بی ردیف حذف‌شده؛ سند بی نرخ از هیچ شرط مبلغی نگذشت'],
  ['wf_td_405_requisition_step_not_rewritten', 'v8.0.124: اقدام درخواست خرید گام گردش‌کار را از وضعیت درخواست بازنویسی نمی‌کند و درخواستِ دریافت‌شده اقدامی نمی‌پذیرد (TD-405)',
    checkRequisitionStepNotRewritten, 'هر جابه‌جایی گام در تاریخچه ثبت شد و تأیید پیش از دریافت آمد؛ اقدام روی درخواستِ دریافت‌شده ۴۰۹ گرفت و گامش دست نخورد'],
  ['wf_td_415_refused_receive_leaves_no_trace', 'v9.0.2: «دریافت کالا»ی ردشده (سفارش ماندهٔ سال مالی بسته) هیچ کالا، کاردکس، سند حسابداری یا تغییر وضعیتی باقی نمی‌گذارد (TD-415)',
    checkRefusedReceiveLeavesNoTrace, 'اقدام رد شد؛ هر دو سفارش پیش‌نویس، موجودی و کاردکس صفر، بی سند حسابداری؛ درخواست و گام «سفارش‌شده» ماند'],
  ['wf_td_415_transition_effects_follow_commit', 'v9.0.2: انتقالِ برگشت‌خورده اثری بیرون نمی‌گذارد و انتقالِ ثبت‌شده فقط یک بار و فقط از outbox منتشر می‌شود (TD-415)',
    checkTransitionEffectsFollowCommit, 'انتقالِ برگشت‌خورده بی وضعیت، لاگ، outbox و انتشار ماند؛ انتقالِ ثبت‌شده یک ردیف outbox و یک لاگ داشت و درون‌فرایندی منتشر نشد'],
  ['wf_td_415_document_approval_finalizes_in_tx', 'v9.0.2: تأیید نهایی گردش‌کار سند، سند را در همان تراکنش قطعی می‌کند و قطعی‌سازیِ ناممکن تأیید را رد می‌کند (TD-415)',
    checkDocumentApprovalFinalizesInTransaction, 'تأیید فاکتورِ بی‌موجودی رد شد و گام و سند ماندند؛ تأیید فاکتور دیگر آن را در پاسخ قطعی کرد'],
  ['wf_td_415_voucher_approval_refused', 'v9.0.2: تأیید گردش‌کار سند حسابداری دائم رد می‌شود و گام و وضعیت سند دست نمی‌خورد (TD-415)',
    checkVoucherApprovalRefusedWhenStatusCannotChange, 'تأیید رد شد؛ گام «پیش‌نویس» و سند «دائم» ماند'],
  ['wf_td_415_opening_approval_in_tx', 'v9.0.2: تأیید نهایی کالا و حساب خزانه سند افتتاحیه را در همان تراکنش صادر می‌کند و صدورِ ناممکن تأیید را رد می‌کند (TD-415)',
    checkOpeningApprovalsFollowTransaction, 'تأییدِ برگشت‌خورده کالا سندی نگذاشت و تأیید ثبت‌شده یک سند افتتاحیه داشت؛ تأیید صندوق بی سرفصل رد شد و گام ماند'],
  ['wf_td_415_delivery_not_attributed_to_user_one', 'v9.0.2: تحویل سفارش بی شناسه کاربر، گام «دریافت‌شده» و لاگ تحویل را به نام کاربر ۱ ثبت نمی‌کند (TD-415)',
    checkDeliveryWithoutUserIdNotAttributedToUserOne, 'گام «دریافت‌شده» و لاگ تحویل بی کاربر ثبت شدند'],
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
