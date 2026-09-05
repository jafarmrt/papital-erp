import { toEnglishDigits } from '../../../utils';

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
  const n = parseFloat(str);
  return isNaN(n) ? 0 : Math.abs(n);
}

/**
 * تشخیص روزهای فاصله بین دو تاریخ شمسی (یا میلادی) با فرمت YYYY/MM/DD
 */
export function calculateDateDiffDays(dateStr1: string, dateStr2: string): number {
  const clean1 = toEnglishDigits(dateStr1).replace(/[^\d]/g, '');
  const clean2 = toEnglishDigits(dateStr2).replace(/[^\d]/g, '');
  
  if (clean1.length < 8 || clean2.length < 8) return 999;
  
  const y1 = parseInt(clean1.slice(0, 4), 10);
  const m1 = parseInt(clean1.slice(4, 6), 10);
  const d1 = parseInt(clean1.slice(6, 8), 10);
  
  const y2 = parseInt(clean2.slice(0, 4), 10);
  const m2 = parseInt(clean2.slice(4, 6), 10);
  const d2 = parseInt(clean2.slice(6, 8), 10);
  
  const days1 = y1 * 365 + (m1 <= 6 ? (m1 - 1) * 31 : 186 + (m1 - 7) * 30) + d1;
  const days2 = y2 * 365 + (m2 <= 6 ? (m2 - 1) * 31 : 186 + (m2 - 7) * 30) + d2;
  
  return Math.abs(days1 - days2);
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

    // ۱. سطح اول: تطبیق بر اساس شماره پیگیری/ارجاع (اگر حداقل ۴ رقم معتبر داشته باشد)
    if (row.tracking && row.tracking.length >= 4) {
      const matchByTracking = sameTypeCandidates.find(t => {
        const txTrack = toEnglishDigits(t.trackingNumber || '').replace(/[^\d]/g, '');
        if (!txTrack || txTrack.length < 4) return false;
        // تطبیق برابر یا شمول در کد پیگیری به همراه برابری مبلغ
        const trackingMatches = txTrack === row.tracking || txTrack.includes(row.tracking) || row.tracking.includes(txTrack);
        const amountMatches = Math.abs(Number(t.amount) - row.amount) < 1;
        return trackingMatches && amountMatches;
      });

      if (matchByTracking) {
        matchedTx = matchByTracking;
        matchQuality = 'tracking';
      }
    }

    // ۲. سطح دوم: تطبیق بر اساس مبلغ دقیق و تاریخ همزمان یا اختلاف حداکثر ۲ روز
    if (!matchedTx) {
      const exactAmountCandidates = sameTypeCandidates.filter(t => 
        Math.abs(Number(t.amount) - row.amount) < 1
      );

      if (exactAmountCandidates.length > 0) {
        // جستجوی نزدیک‌ترین تاریخ
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
        } else if (exactAmountCandidates.length === 1) {
          // ۳. سطح سوم: تطبیق منحصربه‌فرد بر اساس مبلغ وقتی فقط یک تراکنش با این مبلغ وجود دارد
          matchedTx = exactAmountCandidates[0];
          matchQuality = 'amount_only';
          dateDiffDays = calculateDateDiffDays(row.date, exactAmountCandidates[0].date);
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
