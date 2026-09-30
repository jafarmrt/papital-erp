import { toEnglishDigits, jalaliToIsoDate, parseCleanNumber } from '../../../utils';

export interface StatementRow {
  rowNo: number;
  date: string;
  amount: number;
  type: 'receipt' | 'payment'; // receipt = واریز / بستانکار, payment = برداشت / بدهکار
  description: string;
  tracking: string;
  balance?: number;
  bankNameDetected?: string;
  rawRecord?: Record<string, any>;
}

export type MatchQuality = 'tracking' | 'amount_date' | 'amount_only' | 'none';

export interface ReconcileMatchedRow extends StatementRow {
  matchedTxId: number | null;
  matchedTxNumber?: string;
  matchedTxDate?: string;
  matchedTxParty?: string;
  matchQuality: MatchQuality;
  alreadyReconciled: boolean;
  dateDiffDays?: number;
}

export interface TreasuryTxCandidate {
  id: number;
  transactionNumber: string;
  date: string;
  type: 'receipt' | 'payment';
  amount: number | string;
  partyName?: string;
  trackingNumber?: string;
  reconciled?: number | boolean;
  status?: string;
  isDeleted?: number;
}

/**
 * پاکسازی مقادیر عددی مبلغ و تبدیل به عدد خالص مثبت
 */
export function parseCleanAmount(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return Math.abs(raw);
  
  let str = toEnglishDigits(String(raw)).trim();
  // مدیریت اعداد داخل پرانتز در حسابداری (100,000) به معنای منفی
  if (str.startsWith('(') && str.endsWith(')')) {
    str = str.slice(1, -1);
  }
  // حذف جداکننده‌ها و کاراکترهای غیرعددی (بجز اعشار)
  str = str.replace(/,/g, '').replace(/[^\d.-]/g, '');
  const n = parseCleanNumber(str, 0);
  return Math.abs(n);
}

/**
 * TD-151 (V6 Sub-phase 4.2):
 * نرمال‌سازی انواع تاریخ ورودی (شمسی، میلادی، ISO با ساعت، یا پیوسته ۸ رقمی) به تاریخ استاندارد میلادی ISO (YYYY-MM-DD).
 * این تابع مانع از خطای تفاضل روز نجومی میان تاریخ‌های شمسی اکسل بانک (مثلاً 1405/06/15) و تاریخ‌های میلادی دیتابیس (2026-09-06) می‌شود.
 */
export function normalizeDateToIso(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  let clean = toEnglishDigits(String(dateStr)).trim();
  if (!clean) return null;

  // حذف بخش زمان در صورت وجود (مثلاً "1405/06/15 14:30:00" یا "2026-09-06T12:00:00.000Z")
  clean = clean.split(/[ T]/)[0].trim();

  // اگر فرمت پیوسته عددی ۸ رقمی باشد مانند 14050615 یا 20260906
  if (/^\d{8}$/.test(clean)) {
    const y = parseInt(clean.slice(0, 4), 10);
    if (y >= 1300 && y <= 1500) {
      return jalaliToIsoDate(`${clean.slice(0, 4)}/${clean.slice(4, 6)}/${clean.slice(6, 8)}`);
    } else if (y >= 1900 && y <= 2100) {
      return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
    }
  }

  // اگر تاریخ میلادی استاندارد با خط‌تیره یا اسلش است (مثلاً 2026-09-06 یا 2026/09/06)
  const gMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (gMatch) {
    const y = parseInt(gMatch[1], 10);
    const m = gMatch[2].padStart(2, '0');
    const d = gMatch[3].padStart(2, '0');
    if (y >= 1900 && y <= 2100) {
      return `${y}-${m}-${d}`;
    }
  }

  // اگر تاریخ جلالی باشد (مثلاً 1405/06/15 یا 1405-06-15 یا 1405/6/5)
  const iso = jalaliToIsoDate(clean);
  if (iso) return iso;

  return null;
}

/**
 * TD-151 (V6 Sub-phase 4.2):
 * محاسبه تفاضل دقیق روزهای تقویمی بین دو تاریخ با هر مبنایی (شمسی اکسل بانک یا میلادی دیتابیس)
 * هر دو تاریخ به تاریخ استاندارد میلادی ISO نرمال‌سازی شده و سپس اختلاف روز آن‌ها بر مبنای نیمه‌شب UTC محاسبه می‌شود.
 */
export function calculateDateDiffDays(dateStr1: string, dateStr2: string): number {
  const iso1 = normalizeDateToIso(dateStr1);
  const iso2 = normalizeDateToIso(dateStr2);

  if (!iso1 || !iso2) return 999;

  const t1 = Date.parse(iso1 + 'T00:00:00Z');
  const t2 = Date.parse(iso2 + 'T00:00:00Z');

  if (isNaN(t1) || isNaN(t2)) return 999;

  const diffMs = Math.abs(t1 - t2);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * تشخیص هوشمند نام ستون‌های صورت‌حساب در اکسل بانک‌های ایرانی
 */
export async function parseBankStatementBuffer(buffer: ArrayBuffer): Promise<{ rows: StatementRow[]; detectedBank?: string }> {
  const xlsx = await import('xlsx');
  const wb = xlsx.read(buffer, { type: 'array' });
  const firstSheetName = wb.SheetNames[0];
  const ws = wb.Sheets[firstSheetName];
  
  // تبدیل به آرایه ردیف‌ها
  const rawRows = xlsx.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
  if (!rawRows || rawRows.length === 0) {
    throw new Error('فایل صورت‌حساب اکسل خالی است یا ردیفی در آن یافت نشد.');
  }

  // شناسایی ستون‌های کلیدی از روی ردیف‌ها
  const firstRowKeys = Object.keys(rawRows[0] || {});
  
  const findKey = (patterns: RegExp[]): string | undefined => {
    for (const key of firstRowKeys) {
      const normalized = key.trim().replace(/\u200c/g, ' ').toLowerCase();
      if (patterns.some(p => p.test(normalized))) {
        return key;
      }
    }
    return undefined;
  };

  // الگوهای تشخیص ستون‌ها بر اساس فرمت بانک‌های ایرانی (ملت، ملی، سامان، صادرات، تجارت، پاسارگاد و ...)
  const dateKey = findKey([/تاریخ/, /تاريخ/, /date/, /tx_date/, /زمان/]);
  const debitKey = findKey([/برداشت/, /بدهکار/, /بدهكار/, /خروجی/, /مبلغ برداشت/, /مبلغ بدهکار/, /debit/, /withdrawal/]);
  const creditKey = findKey([/واریز/, /واريز/, /بستانکار/, /بستانكار/, /ورودی/, /مبلغ واریز/, /مبلغ بستانکار/, /credit/, /deposit/]);
  const singleAmountKey = findKey([/مبلغ/, /amount/, /مبلغ تراکنش/, /ارزش/]);
  const typeKey = findKey([/نوع/, /نوع تراکنش/, /بدهکار\/بستانکار/, /واریز\/برداشت/, /type/]);
  const trackingKey = findKey([/پیگیری/, /پيگيري/, /کد رهگیری/, /کد پیگیری/, /شماره پیگیری/, /شماره ارجاع/, /شناسه ارجاع/, /شماره مرجع/, /شناسه تراکنش/, /شناسه واریز/, /شماره سند/, /tracking/, /reference/, /ref/]);
  const descKey = findKey([/شرح/, /توضیحات/, /بابت/, /جزئیات/, /description/, /details/, /memo/]);
  const balanceKey = findKey([/مانده/, /موجودی/, /balance/]);

  // حدس نام بانک از روی عناوین شیت یا ستون‌ها
  let detectedBank: string | undefined;
  const sheetLower = firstSheetName.toLowerCase();
  if (sheetLower.includes('mellat') || sheetLower.includes('ملت')) detectedBank = 'بانک ملت';
  else if (sheetLower.includes('melli') || sheetLower.includes('ملی')) detectedBank = 'بانک ملی';
  else if (sheetLower.includes('saman') || sheetLower.includes('سامان')) detectedBank = 'بانک سامان';
  else if (sheetLower.includes('pasargad') || sheetLower.includes('پاسارگاد')) detectedBank = 'بانک پاسارگاد';
  else if (sheetLower.includes('tejarat') || sheetLower.includes('تجارت')) detectedBank = 'بانک تجارت';
  else if (sheetLower.includes('saderat') || sheetLower.includes('صادرات')) detectedBank = 'بانک صادرات';
  else if (sheetLower.includes('resalat') || sheetLower.includes('رسالت')) detectedBank = 'بانک قرض‌الحسنه رسالت';

  const rows: StatementRow[] = [];
  let rowCounter = 1;

  for (const raw of rawRows) {
    // استخراج تاریخ
    let rawDate = dateKey ? String(raw[dateKey] ?? '').trim() : '';
    rawDate = toEnglishDigits(rawDate);
    // استانداردسازی تاریخ شمسی اگر به صورت پیوسته عددی بود (مثل 14050615)
    if (/^\d{8}$/.test(rawDate)) {
      rawDate = `${rawDate.slice(0, 4)}/${rawDate.slice(4, 6)}/${rawDate.slice(6, 8)}`;
    }

    // استخراج مبالغ
    let amount = 0;
    let type: 'receipt' | 'payment' = 'receipt';

    const debitVal = debitKey ? parseCleanAmount(raw[debitKey]) : 0;
    const creditVal = creditKey ? parseCleanAmount(raw[creditKey]) : 0;

    if (debitVal > 0 && creditVal === 0) {
      amount = debitVal;
      type = 'payment'; // برداشت از حساب
    } else if (creditVal > 0 && debitVal === 0) {
      amount = creditVal;
      type = 'receipt'; // واریز به حساب
    } else if (singleAmountKey) {
      // ستون تکی مبلغ
      const rawSingle = raw[singleAmountKey];
      const singleNum = parseCleanAmount(rawSingle);
      const isRawNegative = String(rawSingle).includes('-') || String(rawSingle).includes('(');
      
      const rawType = typeKey ? String(raw[typeKey]).toLowerCase() : '';
      const isDebitType = rawType.includes('برداشت') || rawType.includes('بدهکار') || rawType.includes('debit') || rawType.includes('خروج');
      
      amount = singleNum;
      type = (isRawNegative || isDebitType) ? 'payment' : 'receipt';
    }

    // شرح تراکنش
    const description = descKey ? String(raw[descKey] ?? '').trim() : '';
    
    // شماره پیگیری/ارجاع
    let tracking = trackingKey ? String(raw[trackingKey] ?? '').trim() : '';
    tracking = toEnglishDigits(tracking).replace(/[^\d]/g, '');

    // مانده حساب در صورت وجود
    const balance = balanceKey ? parseCleanAmount(raw[balanceKey]) : undefined;

    // فقط ردیف‌های دارای مبلغ معتبر را اضافه می‌کنیم
    if (amount > 0) {
      rows.push({
        rowNo: rowCounter++,
        date: rawDate,
        amount,
        type,
        description,
        tracking,
        balance,
        bankNameDetected: detectedBank,
        rawRecord: raw,
      });
    }
  }

  return { rows, detectedBank };
}

/**
 * موتور تطبیق ۳ گانه سطر‌های صورت‌حساب بانک با تراکنش‌های خزانه‌داری سیستم
 * ۱. تطبیق دقیق شماره پیگیری/ارجاع (تطبیق قطعی)
 * ۲. تطبیق هوشمند بر اساس مبلغ دقیق و تاریخ همزمان یا با خطای حداکثر ۲ روز (پایا/ساتنا/شتاب)
 * ۳. تطبیق منحصربه‌فرد مبلغ در صورت عدم وجود تشابه چندگانه
 */
export function matchStatementWithTransactions(
  statementRows: StatementRow[],
  transactions: TreasuryTxCandidate[]
): ReconcileMatchedRow[] {
  const usedTxIds = new Set<number>();

  // فیلتر تراکنش‌های فعال و معتبر
  const activeTxs = transactions.filter(t => 
    t.status !== 'voided' && 
    (t.isDeleted === undefined || t.isDeleted === 0)
  );

  return statementRows.map(row => {
    let matchedTx: TreasuryTxCandidate | null = null;
    let matchQuality: MatchQuality = 'none';
    let dateDiffDays: number | undefined;

    // نامزدهای هم‌جهت (واریز به واریز، برداشت به برداشت)
    const sameTypeCandidates = activeTxs.filter(t => 
      t.type === row.type && 
      !usedTxIds.has(t.id)
    );

    // ۱. سطح اول: تطبیق بر اساس شماره پیگیری/ارجاع دقیق (اگر حداقل ۴ رقم معتبر داشته باشد)
    if (row.tracking && row.tracking.length >= 4) {
      const matchByTracking = sameTypeCandidates.find(t => {
        const txTrack = toEnglishDigits(t.trackingNumber || '').replace(/[^\d]/g, '');
        if (!txTrack || txTrack.length < 4) return false;
        // P2-05: انطباق دقیق شماره پیگیری (بدون تطابق زیررشته‌ای) به همراه برابری مبلغ
        const cleanTx = txTrack.replace(/^0+/, '');
        const cleanRow = row.tracking.replace(/^0+/, '');
        const trackingMatches = txTrack === row.tracking || (cleanTx.length >= 4 && cleanTx === cleanRow);
        const amountMatches = Math.abs(Number(t.amount) - row.amount) < 1;
        return trackingMatches && amountMatches;
      });

      if (matchByTracking) {
        matchedTx = matchByTracking;
        matchQuality = 'tracking';
      }
    }

    // ۲. سطح دوم: تطبیق هوشمند بر اساس مبلغ دقیق و تاریخ همزمان یا اختلاف حداکثر ۲ روز (پایا/ساتنا/شتاب)
    if (!matchedTx) {
      const exactAmountCandidates = sameTypeCandidates.filter(t => 
        Math.abs(Number(t.amount) - row.amount) < 1
      );

      if (exactAmountCandidates.length > 0) {
        // جستجوی نزدیک‌ترین تاریخ با سقف خطای حداکثر ۲ روز
        let bestCandidate: TreasuryTxCandidate | null = null;
        let minDiff = 999;

        for (const cand of exactAmountCandidates) {
          const diff = calculateDateDiffDays(row.date, cand.date);
          if (diff <= 2 && diff < minDiff) {
            minDiff = diff;
            bestCandidate = cand;
          }
        }

        if (bestCandidate) {
          matchedTx = bestCandidate;
          matchQuality = 'amount_date';
          dateDiffDays = minDiff;
        }
      }
    }

    // در صورت یافتن تطبیق، شناسه تراکنش را ذخیره می‌کنیم تا به سطر دیگری اختصاص داده نشود
    if (matchedTx) {
      usedTxIds.add(matchedTx.id);
      const isAlreadyReconciled = Boolean(matchedTx.reconciled === 1 || matchedTx.reconciled === true);

      return {
        ...row,
        matchedTxId: matchedTx.id,
        matchedTxNumber: matchedTx.transactionNumber,
        matchedTxDate: matchedTx.date,
        matchedTxParty: matchedTx.partyName || 'طرف‌حساب مشخص‌نشده',
        matchQuality,
        alreadyReconciled: isAlreadyReconciled,
        dateDiffDays,
      };
    }

    // مغایرت (سطر صورت‌حساب بانک که در دفاتر سیستم ثبت نشده است)
    return {
      ...row,
      matchedTxId: null,
      matchQuality: 'none',
      alreadyReconciled: false,
    };
  });
}
