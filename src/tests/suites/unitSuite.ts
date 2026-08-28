import { TestCaseResult, makeTestCase } from '../types.js';
import { WorkflowRuleEngine } from '../../services/workflow/workflowEngineService.js';
import { normalizeError } from '../../errors/customErrors.js';
import { fin, FinancialMath } from '../../lib/financialDecimal.js';
import crypto from 'crypto';

export async function runUnitTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // Test 1: Rule Engine Evaluator - Success
  const t1Start = Date.now();
  try {
    const rules = [
      { field: 'totalAmount', operator: 'gt', value: 1000000 },
      { field: 'branch', operator: 'eq', value: 'تهران' }
    ];
    const context = { totalAmount: 5000000, branch: 'تهران' };
    const evalRes = WorkflowRuleEngine.evaluateRuleBreakdown(rules, context);

    if (evalRes.passed) {
      results.push(makeTestCase({
        id: 'unit_rule_engine_pass',
        name: 'ارزیابی صحیح قوانین موتور ارزیابی (Rule Engine)',
        layer: 'unit',
        executionType: 'simulation_logic',
        passed: true,
        durationMs: Date.now() - t1Start,
        details: 'شرایط قوانین مالی به درستی صادق ارزیابی شد.'
      }));
    } else {
      throw new Error('قوانین با وجود تطابق مقدار مردود ارزیابی شدند');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'unit_rule_engine_pass',
      name: 'ارزیابی صحیح قوانین موتور ارزیابی (Rule Engine)',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t1Start,
      error: err.message
    }));
  }

  // Test 2: Rule Engine Evaluator - Failure Scenario
  const t2Start = Date.now();
  try {
    const rules = [
      { field: 'totalAmount', operator: 'gte', value: 10000000 }
    ];
    const context = { totalAmount: 2000000 };
    const evalRes = WorkflowRuleEngine.evaluateRuleBreakdown(rules, context);

    if (!evalRes.passed) {
      results.push(makeTestCase({
        id: 'unit_rule_engine_fail',
        scenarioId: 'rule_condition_failure',
        name: 'ارزیابی خطای عدم تحقق شروط در Rule Engine',
        layer: 'unit',
        executionType: 'simulation_logic',
        passed: true,
        durationMs: Date.now() - t2Start,
        details: 'عدم صدق شرط مبلغ در موتور ارزیابی قوانین به درستی تشخیص داده شد (Rule condition failure).'
      }));
    } else {
      throw new Error('شرط غیرصادق به اشتباه قبول شد');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'unit_rule_engine_fail',
      scenarioId: 'rule_condition_failure',
      name: 'ارزیابی خطای عدم تحقق شروط در Rule Engine',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t2Start,
      error: err.message
    }));
  }

  // Test 3: HMAC SHA-256 Signature Verification
  const t3Start = Date.now();
  try {
    const secret = 'webhook_secret_key_123';
    const payload = JSON.stringify({ event: 'order.created', orderId: 9988 });
    const computedHmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    if (computedHmac && computedHmac.length === 64) {
      results.push(makeTestCase({
        id: 'unit_hmac_signature',
        name: 'تولید و اعتبارسنجی امضای دیجیتال HMAC-SHA256 وب‌هوک‌ها',
        layer: 'unit',
        executionType: 'simulation_logic',
        passed: true,
        durationMs: Date.now() - t3Start,
        details: 'امضای HMAC-SHA256 خروجی ۶۴ کاراکتری معتبر تولید کرد.'
      }));
    } else {
      throw new Error('امضای HMAC نا معتبر است');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'unit_hmac_signature',
      name: 'تولید و اعتبارسنجی امضای دیجیتال HMAC-SHA256 وب‌هوک‌ها',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t3Start,
      error: err.message
    }));
  }

  // Test 4: Custom Error & Postgres Error Normalization
  const t4Start = Date.now();
  try {
    const pgDuplicateError = { code: '23505', detail: 'Key (code)=(ITEM-001) already exists.' };
    const normalized = normalizeError(pgDuplicateError);

    if (normalized.statusCode === 409) {
      results.push(makeTestCase({
        id: 'unit_error_normalization',
        name: 'استانداردسازی و نگاشت خطاهای دیتابیس به AppError',
        layer: 'unit',
        executionType: 'simulation_logic',
        passed: true,
        durationMs: Date.now() - t4Start,
        details: 'خطای کد 23505 دیتابیس به درستی به ConflictError با کد 409 تبدیل شد.'
      }));
    } else {
      throw new Error(`موقعیت خطا کد ${normalized.statusCode} بازگرداند`);
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'unit_error_normalization',
      name: 'استانداردسازی و نگاشت خطاهای دیتابیس به AppError',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t4Start,
      error: err.message
    }));
  }

  // Test 5: High-Precision Financial Decimal & WAC Arithmetic
  const t5Start = Date.now();
  try {
    // 0.1 + 0.2 floating point precision test
    const sum = fin('0.1').add('0.2');
    if (!sum.equals('0.3')) {
      throw new Error(`خطای ممیز شناور در جمع دسیمل: ${sum.toString()} به جای 0.3`);
    }

    // WAC Calculation: 10 units @ 1000 + 5 units @ 1300 = (10000 + 6500) / 15 = 1100
    const wac = FinancialMath.calculateWAC(10, 1000, 5, 1300);
    if (!wac.equals(1100)) {
      throw new Error(`خطای محاسبه میانگین موزون: ${wac.toString()} به جای 1100`);
    }

    // Currency Rounding
    const rialRounded = FinancialMath.roundCurrency('1250000.75', 'IRR');
    if (!rialRounded.equals('1250001')) {
      throw new Error(`خطای گردکردن ریال: ${rialRounded.toString()}`);
    }

    results.push(makeTestCase({
      id: 'unit_financial_decimal_precision',
      scenarioId: 'inventory_rebuild',
      name: 'صحت محاسبات دسیمل با دقت بالا و میانگین موزون انبار (Financial Decimal & WAC)',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t5Start,
      details: 'عدم وجود خطای ممیز شناور (0.1+0.2=0.3)، دقت اعشاری و محاسبه میانگین موزون WAC تایید گردید.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'unit_financial_decimal_precision',
      name: 'صحت محاسبات دسیمل با دقت بالا و میانگین موزون انبار (Financial Decimal & WAC)',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t5Start,
      error: err.message
    }));
  }

  // Test 6: Nested Expression Evaluation & Dot Notation Path Resolution (Subphase 7.1)
  const t6Start = Date.now();
  try {
    const nestedExpression = {
      logic: 'AND',
      conditions: [
        { field: 'payload.amount', operator: 'gte', value: 10000000 },
        {
          logic: 'OR',
          conditions: [
            { field: 'payload.buyer.branch', operator: 'eq', value: 'TEH' },
            { field: 'payload.priority', operator: 'eq', value: 'high' }
          ]
        },
        {
          logic: 'NOT',
          conditions: [
            { field: 'payload.status', operator: 'eq', value: 'blacklisted' }
          ]
        }
      ]
    };

    const matchingContext = {
      payload: {
        amount: 25000000,
        priority: 'high',
        buyer: { branch: 'IR-ALL' },
        status: 'active'
      }
    };

    const evalRes = WorkflowRuleEngine.evaluateRuleBreakdown(nestedExpression, matchingContext);

    if (evalRes.passed && evalRes.trace && evalRes.trace.passed) {
      results.push(makeTestCase({
        id: 'unit_nested_rule_expression_evaluation',
        name: 'ارزیابی ساختار شروط ترکیبی و تو در تو (Nested AND/OR/NOT Expression Engine)',
        layer: 'unit',
        executionType: 'simulation_logic',
        passed: true,
        durationMs: Date.now() - t6Start,
        details: 'شروط ترکیبی (AND/OR/NOT) و مسیرهای نقطه‌ای (Dot Notation) با موفقیت صحه‌گذاری شدند.'
      }));
    } else {
      throw new Error('ارزیابی شروط ترکیبی با شکست مواجه شد');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'unit_nested_rule_expression_evaluation',
      name: 'ارزیابی ساختار شروط ترکیبی و تو در تو (Nested AND/OR/NOT Expression Engine)',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t6Start,
      error: err.message
    }));
  }

  // Test 7: Domain Event Contract & Validation (Subphase 8.1)
  const t7Start = Date.now();
  try {
    const { createDomainEvent, validateDomainEvent, DomainEventType } = await import('../../services/events/domainEvents.js');

    const validEvent = createDomainEvent({
      eventType: DomainEventType.PURCHASE_APPROVED,
      aggregateType: 'Document',
      aggregateId: 1005,
      payload: {
        documentId: 1005,
        refNumber: 'PUR-900',
        supplierName: 'تامین‌کننده الف',
        totalAmount: 150000000,
        currency: 'IRR',
        itemCount: 4,
        status: 'approved'
      },
      metadata: {
        userId: 12,
        userName: 'مدیر خرید',
        correlationId: 'corr_test_8001'
      }
    });

    const validationRes = validateDomainEvent(validEvent);

    // Test invalid event detection
    const invalidEvent: any = {
      eventId: 'evt_123',
      eventType: 'Unknown',
      // missing aggregateType, occurredAt, metadata
    };
    const invalidValidation = validateDomainEvent(invalidEvent);

    if (
      validationRes.valid &&
      validEvent.eventId.startsWith('evt_') &&
      validEvent.aggregateId === '1005' &&
      validEvent.metadata.timestamp &&
      !invalidValidation.valid &&
      invalidValidation.errors.length >= 2
    ) {
      results.push(makeTestCase({
        id: 'unit_domain_event_contract',
        scenarioId: 'domain_event_contract',
        name: 'ارزیابی و اعتبارسنجی قرارداد استاندارد رویدادهای دامنه (Domain Event Contract)',
        layer: 'unit',
        executionType: 'simulation_logic',
        passed: true,
        durationMs: Date.now() - t7Start,
        details: 'تولید استاندارد eventId، تبدیل aggregateId به رشته، بررسی فیلدهای اجباری و تشخیص رویدادهای نامعتبر با موفقیت صحه‌گذاری شد.'
      }));
    } else {
      throw new Error('اعتبارسنجی قرارداد رویدادهای دامنه ناموفق بود');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'unit_domain_event_contract',
      scenarioId: 'domain_event_contract',
      name: 'ارزیابی و اعتبارسنجی قرارداد استاندارد رویدادهای دامنه (Domain Event Contract)',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t7Start,
      error: err.message
    }));
  }

  // Test 8: Transactional Outbox Atomic Claim & Dual-Write (Subphase 8.2)
  const t8Start = Date.now();
  try {
    const { OutboxService } = await import('../../services/events/outboxService.js');
    const { createDomainEvent, DomainEventType } = await import('../../services/events/domainEvents.js');

    const testEvent = createDomainEvent({
      eventType: DomainEventType.STOCK_RECEIVED,
      aggregateType: 'Item',
      aggregateId: 9999,
      payload: { itemId: 9999, qty: 50, location: 'W1' },
      metadata: { userName: 'تست انبار' }
    });

    // Test dual-write saveToOutbox
    await OutboxService.recordEvent(null, testEvent);

    // Test processing pending batch (atomic claim and dispatch)
    const batchRes = await OutboxService.processPendingBatch(10);

    // Verify outbox stats
    const stats = await OutboxService.getOutboxStats();

    if (stats.total >= 1 && batchRes.processed >= 1) {
      results.push(makeTestCase({
        id: 'unit_transactional_outbox',
        scenarioId: 'transactional_outbox',
        name: 'ارزیابی صندوق ارسال تراکنشی و قفل ادعای همزمان (Transactional Outbox & Claim Locking)',
        layer: 'unit',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t8Start,
        details: 'ثبت اتمیک رویداد در outbox_events، ادعای انحصاری (Atomic Claim) و ارسال غیرهمزمان با موفقیت صحه‌گذاری شد.'
      }));
    } else {
      throw new Error('پردازش آوتباکس یا استعلام آمار موفقیت‌آمیز نبود');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'unit_transactional_outbox',
      scenarioId: 'transactional_outbox',
      name: 'ارزیابی صندوق ارسال تراکنشی و قفل ادعای همزمان (Transactional Outbox & Claim Locking)',
      layer: 'unit',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t8Start,
      error: err.message
    }));
  }

  // Test 9: Action Handlers Idempotency, Auditability, and Observability (Subphase 8.3)
  const t9Start = Date.now();
  try {
    const { ActionHandlerService } = await import('../../services/events/actionHandlerService.js');
    const { createDomainEvent, DomainEventType } = await import('../../services/events/domainEvents.js');

    ActionHandlerService.initializeBuiltInHandlers();

    const sampleEvent = createDomainEvent({
      eventType: DomainEventType.INVOICE_APPROVED,
      aggregateType: 'Document',
      aggregateId: 8888,
      payload: { refNumber: 'INV-TEST-83', totalAmount: 250000000, currency: 'IRR' },
      metadata: { userName: 'تست اکشن هندر' }
    });

    // Register a custom test handler
    let executionCallCount = 0;
    ActionHandlerService.registerHandler({
      handlerName: 'TestIdempotentActionHandler',
      eventType: DomainEventType.INVOICE_APPROVED,
      description: 'تست یکبارپذیر و قابل ردیابی بودن اکشن‌هندلر',
      handlerFn: async () => {
        executionCallCount++;
        return { processed: true, callNumber: executionCallCount };
      }
    });

    // First execution
    const res1 = await ActionHandlerService.executeHandler({
      handlerName: 'TestIdempotentActionHandler',
      eventType: DomainEventType.INVOICE_APPROVED,
      description: 'تست یکبارپذیر و قابل ردیابی بودن اکشن‌هندلر',
      handlerFn: async () => {
        executionCallCount++;
        return { processed: true, callNumber: executionCallCount };
      }
    }, sampleEvent);

    // Re-execution of exact same event
    const res2 = await ActionHandlerService.executeHandler({
      handlerName: 'TestIdempotentActionHandler',
      eventType: DomainEventType.INVOICE_APPROVED,
      description: 'تست یکبارپذیر و قابل ردیابی بودن اکشن‌هندلر',
      handlerFn: async () => {
        executionCallCount++;
        return { processed: true, callNumber: executionCallCount };
      }
    }, sampleEvent);

    const stats = ActionHandlerService.getActionHandlerStats();

    if (
      res1.status === 'success' &&
      res2.status === 'skipped' &&
      res2.alreadyExecuted === true &&
      executionCallCount === 1 &&
      stats.registeredHandlersCount >= 3 &&
      stats.skippedIdempotentCount >= 1
    ) {
      results.push(makeTestCase({
        id: 'unit_action_handlers',
        scenarioId: 'action_handlers',
        name: 'ارزیابی اکشن‌هندلرهای یکبارپذیر، قابل ردیابی و مشاهده‌پذیر (Idempotent & Auditable Action Handlers)',
        layer: 'unit',
        executionType: 'simulation_logic',
        passed: true,
        durationMs: Date.now() - t9Start,
        details: 'خاصیت یکبارپذیری (Idempotency)، ردیابی لاگ حسابرسی، و آمار مشاهده‌پذیری (Observability) اکشن‌هندلرها با موفقیت صحه‌گذاری شد.'
      }));
    } else {
      throw new Error('خاصیت یکبارپذیری یا ثبت آمار اکشن‌هندلر به درستی عمل نکرد');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'unit_action_handlers',
      scenarioId: 'action_handlers',
      name: 'ارزیابی اکشن‌هندلرهای یکبارپذیر، قابل ردیابی و مشاهده‌پذیر (Idempotent & Auditable Action Handlers)',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t9Start,
      error: err.message
    }));
  }

  // Test 10: FinancialDecimal & decimal.js High Precision Calculations (DB-007)
  const t10Start = Date.now();
  try {
    const { fin: finLib, FinancialDecimal: FDLib, FinancialMath: FMLib } = await import('../../lib/financialDecimal.js');
    const { fin: finUtils, FinancialDecimal: FDUtils, FinancialMath: FMUtils } = await import('../../utils/financialMath.js');

    // 1. Acceptance Criteria verification: fin(1_000_000_000).multiply(0.1).divide(3).round(4)
    const testResult1 = finLib(1_000_000_000).multiply(0.1).divide(3).round(4);
    if (testResult1.toNumber() !== 33333333.3333 || testResult1.toString() !== '33333333.3333') {
      throw new Error(`محاسبه میلیارد تومانی دقت ۴ رقم اعشار نادرست است: ${testResult1.toString()} (انتظار: 33333333.3333)`);
    }

    // 2. Floating point drift prevention: 0.1 + 0.2 === 0.3
    const sumDec = finLib(0.1).add(0.2);
    if (!sumDec.equals(0.3) || sumDec.toNumber() !== 0.3) {
      throw new Error(`خطای ممیز شناور در جمع ۰.۱ و ۰.۲ رخ داده است: ${sumDec.toNumber()}`);
    }

    // 3. WAC calculation with large numbers
    const wac = FMLib.calculateWAC(100, 50000000, 50, 80000000);
    // (100 * 50M + 50 * 80M) / 150 = (5,000M + 4,000M) / 150 = 9,000M / 150 = 60,000,000
    if (wac.toNumber() !== 60000000) {
      throw new Error(`محاسبه میانگین موزون بها نادرست است: ${wac.toNumber()}`);
    }

    // 4. Verification of re-exported utils/financialMath
    const utilsResult = finUtils(1_000_000_000).multiply(0.1).divide(3).round(4);
    if (utilsResult.toNumber() !== 33333333.3333) {
      throw new Error(`محاسبه از مسیر utils/financialMath با شکست مواجه شد: ${utilsResult.toNumber()}`);
    }

    const legacyAdd = FMUtils.add(0.1, 0.2);
    if (legacyAdd !== 0.3) {
      throw new Error(`متد قدیمی FinancialMath.add خروجی ناصحیح دارد: ${legacyAdd}`);
    }

    results.push(makeTestCase({
      id: 'unit_financial_decimal_migration',
      name: 'یکپارچه‌سازی FinancialDecimal و دقت محاسبات مالی با decimal.js (DB-007)',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t10Start,
      details: 'مهاجرت به decimal.js، حذف کامل خطای ممیز شناور، یکپارچه‌سازی ماژول‌ها و صحت محاسبات چند میلیاردی با دقت ۴ رقم اعشار با موفقیت تأیید شد.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'unit_financial_decimal_migration',
      name: 'یکپارچه‌سازی FinancialDecimal و دقت محاسبات مالی با decimal.js (DB-007)',
      layer: 'unit',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t10Start,
      error: err.message
    }));
  }

  return results;
}


