import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { categories } from '../../db/schema.js';
import {
  createVoucherSchema,
  createChequeSchema,
  transferSchema,
  createTreasuryTxSchema
} from '../../routes/accounting.routes.js';

export async function runRegressionTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // Test 1: 22 Standard Categories & Default Units Auto-Fill
  const t1Start = Date.now();
  try {
    const allCategories = await orm.select().from(categories);
    const categoryCount = allCategories.length;
    const earringsCategory = allCategories.find(c => c.name.includes('گوشواره میخی') || c.name.includes('گوشواره آویز'));
    const defaultUnit = earringsCategory ? (earringsCategory.defaultUnit || (earringsCategory as any).default_unit) : null;

    if (categoryCount >= 22 && defaultUnit === 'جفت') {
      results.push(makeTestCase({
        id: 'reg_categories_default_units',
        scenarioId: 'regression_sanity',
        name: 'ارزیابی ۲۲ دسته‌بندی استاندارد سیستم و واحد سنجش خودکار (Regression Sanity)',
        layer: 'regression',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t1Start,
        details: `تعداد ${categoryCount} دسته‌بندی اصلی در دیتابیس موجود بوده و تنظیم خودکار واحد سنجش (جفت برای گوشواره) تأیید گردید.`
      }));
    } else {
      // V3.0.6 (FC-2): شاخه «شکست» قبلاً نیز passed:true ثبت می‌کرد و تست عملاً
      // هرگز fail نمی‌شد (False Confidence). اکنون انحراف از baseline واقعاً گزارش می‌شود.
      results.push(makeTestCase({
        id: 'reg_categories_default_units',
        scenarioId: 'regression_sanity',
        name: 'ارزیابی ۲۲ دسته‌بندی استاندارد سیستم و واحد سنجش خودکار (Regression Sanity)',
        layer: 'regression',
        executionType: 'real_database',
        passed: false,
        durationMs: Date.now() - t1Start,
        error: `Baseline دسته‌بندی‌ها مغایر است — تعداد دسته‌بندی‌ها: ${categoryCount} (انتظار: >= 22)، واحد پیش‌فرض گوشواره: ${defaultUnit || 'null'} (انتظار: جفت)`
      }));
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'reg_categories_default_units',
      scenarioId: 'regression_sanity',
      name: 'ارزیابی ۲۲ دسته‌بندی استاندارد سیستم و واحد سنجش خودکار (Regression Sanity)',
      layer: 'regression',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t1Start,
      error: err.message
    }));
  }

  // ------------------------------------------------------------------
  // Test 2: Runtime Contracts & Zod Validation for Inventory & Transfers (Sub-phase 4.3)
  // ------------------------------------------------------------------
  const t2Start = Date.now();
  try {
    const {
      transferStockSchema,
      negativeStockPolicySchema,
      projectAllocateSchema,
      allocationsQuerySchema
    } = await import('../../routes/inventory.routes.js');

    // Case 1: تایید انتقال معتبر بین دو انبار مجزا
    const validTransfer = await transferStockSchema.parseAsync({
      body: {
        itemId: '15',
        fromLocation: 'main',
        toLocation: 'workshop',
        quantity: '10',
        date: '1405/06/25'
      }
    });
    if (!validTransfer.body || validTransfer.body.itemId !== 15 || validTransfer.body.quantity !== 10) {
      throw new Error('شِمای انتقال باید شناسه‌ها و مقادیر رشته‌ای را به عدد تبدیل کند.');
    }

    // Case 2: رد انتقال با انبار مبداء و مقصد یکسان (Self-Transfer Block)
    let sameWarehouseThrew = false;
    try {
      await transferStockSchema.parseAsync({
        body: {
          itemId: 15,
          fromLocation: 'main',
          toLocation: 'main',
          quantity: 5
        }
      });
    } catch {
      sameWarehouseThrew = true;
    }
    if (!sameWarehouseThrew) {
      throw new Error('شِمای انتقال باید انتقال با انبار مبداء و مقصد یکسان را رد کند.');
    }

    // Case 3: رد انتقال با مقدار صفر یا منفی
    let negativeQtyThrew = false;
    try {
      await transferStockSchema.parseAsync({
        body: {
          itemId: 15,
          fromLocation: 'main',
          toLocation: 'workshop',
          quantity: -2
        }
      });
    } catch {
      negativeQtyThrew = true;
    }
    if (!negativeQtyThrew) {
      throw new Error('شِمای انتقال باید مقادیر منفی یا صفر را رد کند.');
    }

    // Case 4: اعتبارسنجی سیاست موجودی منفی (فقط forbidden, warning, allowed)
    const validPolicy = await negativeStockPolicySchema.parseAsync({
      body: { policy: 'forbidden' }
    });
    if (validPolicy.body.policy !== 'forbidden') {
      throw new Error('شِمای سیاست موجودی منفی باید مقدار معتبر را بپذیرد.');
    }

    let invalidPolicyThrew = false;
    try {
      await negativeStockPolicySchema.parseAsync({
        body: { policy: 'unlimited_dangerous' }
      });
    } catch {
      invalidPolicyThrew = true;
    }
    if (!invalidPolicyThrew) {
      throw new Error('شِمای سیاست موجودی منفی باید مقادیر ناشناخته را رد کند.');
    }

    // Case 5: اعتبارسنجی تخصیص به پروژه و ممانعت از آرایه خالی اقلام
    let emptyAllocationsThrew = false;
    try {
      await projectAllocateSchema.parseAsync({
        body: {
          projectId: 4,
          allocations: []
        }
      });
    } catch {
      emptyAllocationsThrew = true;
    }
    if (!emptyAllocationsThrew) {
      throw new Error('شِمای تخصیص پروژه باید ارسال آرایه خالی اقلام را رد کند.');
    }

    // Case 6: اعتبارسنجی فیلترهای کوئری تخصیص‌ها
    const validAllocQuery = await allocationsQuerySchema.parseAsync({
      query: {
        projectId: '4',
        status: 'allocated'
      }
    });
    if (!validAllocQuery.query || validAllocQuery.query.projectId !== 4) {
      throw new Error('شِمای فیلترهای تخصیص باید مقادیر مجاز را بپذیرد.');
    }

    results.push(makeTestCase({
      id: 'v4_inventory_runtime_contracts_guard',
      scenarioId: 'v4_inventory_runtime_contracts_guard',
      name: 'قراردادهای زمان اجرای انبارداری، انتقالات و تخصیص BOM با Zod (زیرفاز ۴.۳)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t2Start,
      details: 'اعتبارسنجی صلب انتقال بین‌انباری، ممانعت از مبدأ/مقصد یکسان، مقادیر نامنفی، سیاست موجودی منفی و تخصیص پروژه با موفقیت تایید شدند.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_inventory_runtime_contracts_guard',
      scenarioId: 'v4_inventory_runtime_contracts_guard',
      name: 'قراردادهای زمان اجرای انبارداری، انتقالات و تخصیص BOM با Zod (زیرفاز ۴.۳)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t2Start,
      error: err.message
    }));
  }

  // Test 4: Accounting & Treasury Runtime Contracts (Zod) - Phase 4.4
  const t4Start = Date.now();
  try {
    // Case 1: سند حسابداری تراز شده باید معتبر باشد
    const validVoucher = await createVoucherSchema.parseAsync({
      body: {
        date: '1403/06/26',
        description: 'ثبت سند پرداخت هزینه و کسر از بانک',
        voucherType: 'general',
        items: [
          { accountId: 10, debit: 500000, credit: 0, description: 'هزینه عمومی' },
          { accountId: 20, debit: 0, credit: 500000, description: 'بانک ملت' }
        ]
      }
    });
    if (validVoucher.body.items.length !== 2) {
      throw new Error('شِمای سند حسابداری باید سند معتبر و تراز شده را بپذیرد.');
    }

    // Case 2: سند حسابداری ناتراز باید توسط Zod رد شود
    let unbalanceThrew = false;
    try {
      await createVoucherSchema.parseAsync({
        body: {
          date: '1403/06/26',
          description: 'سند ناتراز تستی',
          items: [
            { accountId: 10, debit: 500000, credit: 0 },
            { accountId: 20, debit: 0, credit: 400000 }
          ]
        }
      });
    } catch {
      unbalanceThrew = true;
    }
    if (!unbalanceThrew) {
      throw new Error('شِمای سند دوبل باید اسناد ناتراز بدهکار/بستانکار را رد کند.');
    }

    // Case 3: چک صیادی با شناسه ۱۶ رقمی معتبر و ممانعت از شناسه نامعتبر
    const validCheque = await createChequeSchema.parseAsync({
      body: {
        type: 'received',
        chequeNumber: 'CHQ-9901',
        sayadNumber: '1234567890123456',
        bankName: 'بانک ملی',
        issueDate: '1403/06/26',
        dueDate: '1403/08/26',
        amount: 15000000,
        partyName: 'مشتری الف'
      }
    });
    if (validCheque.body.sayadNumber !== '1234567890123456') {
      throw new Error('شِمای چک صیادی باید شناسه ۱۶ رقمی معتبر را بپذیرد.');
    }

    let invalidSayadThrew = false;
    try {
      await createChequeSchema.parseAsync({
        body: {
          type: 'received',
          chequeNumber: 'CHQ-9902',
          sayadNumber: '12345', // کمتر از ۱۶ رقم
          bankName: 'بانک ملی',
          issueDate: '1403/06/26',
          dueDate: '1403/08/26',
          amount: 15000000,
          partyName: 'مشتری الف'
        }
      });
    } catch {
      invalidSayadThrew = true;
    }
    if (!invalidSayadThrew) {
      throw new Error('شِمای چک صیادی باید شناسه صیادی با فرمت نامعتبر را رد کند.');
    }

    // Case 4: انتقال وجه بین‌بانکی با ممانعت از حساب مبدا و مقصد یکسان
    let sameBankTransferThrew = false;
    try {
      await transferSchema.parseAsync({
        body: {
          date: '1403/06/26',
          amount: 1000000,
          fromBankAccountId: 5,
          toBankAccountId: 5 // حساب یکسان
        }
      });
    } catch {
      sameBankTransferThrew = true;
    }
    if (!sameBankTransferThrew) {
      throw new Error('شِمای انتقال وجه خزانه باید حساب مبدا و مقصد یکسان را رد کند.');
    }

    // Case 5: تراکنش دریافت/پرداخت با مبلغ منفی باید رد شود
    let negativeTreasuryTxThrew = false;
    try {
      await createTreasuryTxSchema.parseAsync({
        body: {
          type: 'receipt',
          date: '1403/06/26',
          method: 'cash',
          amount: -5000,
          bankAccountId: 1,
          partyName: 'تست'
        }
      });
    } catch {
      negativeTreasuryTxThrew = true;
    }
    if (!negativeTreasuryTxThrew) {
      throw new Error('شِمای تراکنش خزانه باید مبلغ منفی را رد کند.');
    }

    results.push(makeTestCase({
      id: 'v4_accounting_treasury_runtime_contracts_guard',
      scenarioId: 'v4_accounting_treasury_runtime_contracts_guard',
      name: 'قراردادهای زمان اجرای حسابداری و خزانه‌داری با Zod (زیرفاز ۴.۴)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: true,
      durationMs: Date.now() - t4Start,
      details: 'اعتبارسنجی تراز بودن سند حسابداری دوبل (Debit == Credit)، شناسه صیادی ۱۶ رقمی چک‌ها، ممانعت از حساب‌های مبدا/مقصد یکسان در انتقال وجه و مبالغ مثبت خزانه با موفقیت تایید شدند.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'v4_accounting_treasury_runtime_contracts_guard',
      scenarioId: 'v4_accounting_treasury_runtime_contracts_guard',
      name: 'قراردادهای زمان اجرای حسابداری و خزانه‌داری با Zod (زیرفاز ۴.۴)',
      layer: 'regression',
      executionType: 'simulation_logic',
      passed: false,
      durationMs: Date.now() - t4Start,
      error: err.message
    }));
  }

  return results;
}

