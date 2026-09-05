import * as xlsx from 'xlsx';
import { 
  parseCleanAmount, 
  calculateDateDiffDays, 
  parseBankStatementBuffer, 
  matchStatementWithTransactions,
  StatementRow,
  TreasuryTxCandidate
} from '../src/components/accounting/reconciliation/bankStatementMatcher.js';

async function runTests() {
  console.log('--- شروع آزمون‌های خودکار موتور مغایرت‌گیری بانکی (Bank Reconciliation Engine) ---');

  // ۱. تست parseCleanAmount
  console.log('۱. آزمون تبدیل و پاکسازی مبالغ بانکی:');
  const testAmounts = [
    { input: '۱۲,۵۰۰,۰۰۰', expected: 12500000 },
    { input: '(۵,۰۰۰,۰۰۰)', expected: 5000000 },
    { input: -350000, expected: 350000 },
    { input: '1500000.5', expected: 1500000.5 },
    { input: '  ۹۸,۰۰۰ ریال ', expected: 98000 },
    { input: '', expected: 0 },
    { input: null, expected: 0 },
  ];

  for (const t of testAmounts) {
    const result = parseCleanAmount(t.input);
    if (result !== t.expected) {
      throw new Error(`شکست در تبدیل مبلغ: ورودی ${t.input} -> خروجی ${result}، مورد انتظار ${t.expected}`);
    }
  }
  console.log('✅ آزمون پاکسازی مبالغ با موفقیت سپری شد.');

  // ۲. تست calculateDateDiffDays
  console.log('۲. آزمون محاسبه اختلاف روزهای تاریخ‌های شمسی:');
  const diff1 = calculateDateDiffDays('1405/06/15', '1405/06/15');
  if (diff1 !== 0) throw new Error(`اختلاف تاریخ‌های یکسان باید صفر باشد: ${diff1}`);

  const diff2 = calculateDateDiffDays('1405/06/15', '1405/06/17');
  if (diff2 !== 2) throw new Error(`اختلاف باید ۲ روز باشد: ${diff2}`);

  const diff3 = calculateDateDiffDays('1405/06/15', '1405/06/13');
  if (diff3 !== 2) throw new Error(`اختلاف باید ۲ روز باشد: ${diff3}`);

  console.log('✅ آزمون محاسبه اختلاف روزها با موفقیت سپری شد.');

  // ۳. آزمون تطبیق هوشمند ۳ سطحی (matchStatementWithTransactions)
  console.log('۳. آزمون موتور تطبیق ۳ سطحی:');
  const mockStatement: StatementRow[] = [
    {
      rowNo: 1,
      date: '1405/06/15',
      amount: 15000000,
      type: 'receipt',
      description: 'واریز ساتنا شرکت آزمایشی',
      tracking: '987654321',
    },
    {
      rowNo: 2,
      date: '1405/06/16',
      amount: 2500000,
      type: 'payment',
      description: 'انتقال پایا بابت فاکتور خرید',
      tracking: '', // بدون کد پیگیری اما تاریخ با ۱ روز فاصله
    },
    {
      rowNo: 3,
      date: '1405/06/10',
      amount: 780000,
      type: 'receipt',
      description: 'واریز اینترنتی',
      tracking: '',
    },
    {
      rowNo: 4,
      date: '1405/06/18',
      amount: 50000,
      type: 'payment',
      description: 'کارمزد انتقال وجه شتاب',
      tracking: '112233',
    },
  ];

  const mockTxs: TreasuryTxCandidate[] = [
    {
      id: 101,
      transactionNumber: 'TRX-101',
      date: '1405/06/15',
      type: 'receipt',
      amount: 15000000,
      partyName: 'شرکت آزمایشی نگین',
      trackingNumber: '987654321',
      status: 'final',
    },
    {
      id: 102,
      transactionNumber: 'TRX-102',
      date: '1405/06/15', // تاریخ دیروز نسبت به صورت‌حساب (پایا روز بعد نشسته)
      type: 'payment',
      amount: 2500000,
      partyName: 'فروشگاه ابزار دقیق',
      status: 'final',
    },
    {
      id: 103,
      transactionNumber: 'TRX-103',
      date: '1405/06/05', // اختلاف ۵ روزه اما مبلغ منحصربه‌فرد است
      type: 'receipt',
      amount: 780000,
      partyName: 'خریدار نقدی',
      status: 'final',
    },
  ];

  const matched = matchStatementWithTransactions(mockStatement, mockTxs);
  
  // سطر ۱: تطبیق قطعی با کد پیگیری
  const r1 = matched.find(r => r.rowNo === 1);
  if (!r1 || r1.matchQuality !== 'tracking' || r1.matchedTxId !== 101) {
    throw new Error(`سطر ۱ باید با پیگیری تطبیق یابد: ${JSON.stringify(r1)}`);
  }

  // سطر ۲: تطبیق هوشمند با مبلغ و تاریخ (اختلاف ۱ روز)
  const r2 = matched.find(r => r.rowNo === 2);
  if (!r2 || r2.matchQuality !== 'amount_date' || r2.matchedTxId !== 102) {
    throw new Error(`سطر ۲ باید با مبلغ و تاریخ تطبیق یابد: ${JSON.stringify(r2)}`);
  }

  // سطر ۳: تطبیق منحصربه‌فرد بر اساس مبلغ
  const r3 = matched.find(r => r.rowNo === 3);
  if (!r3 || r3.matchQuality !== 'amount_only' || r3.matchedTxId !== 103) {
    throw new Error(`سطر ۳ باید با مبلغ تطبیق یابد: ${JSON.stringify(r3)}`);
  }

  // سطر ۴: مغایرت (کارمزد بانکی که در دفاتر ثبت نشده است)
  const r4 = matched.find(r => r.rowNo === 4);
  if (!r4 || r4.matchQuality !== 'none' || r4.matchedTxId !== null) {
    throw new Error(`سطر ۴ باید بدون تطبیق (مغایرت) باشد: ${JSON.stringify(r4)}`);
  }

  console.log('✅ آزمون تطبیق ۳ سطحی با موفقیت و درستی ۱۰۰٪ انجام شد.');

  // ۴. تست استخراج و تحلیل فایل اکسل شبیه‌سازی‌شده بانک ملت
  console.log('۴. آزمون تحلیل شیت اکسل شبیه‌سازی‌شده (فرمت بانک ملت):');
  const mellatRows = [
    { 'ردیف': 1, 'تاریخ': '1405/06/15', 'واریز': '10,000,000', 'برداشت': '0', 'مانده': '50,000,000', 'شماره پیگیری': '445566', 'شرح': 'واریز وجه حواله' },
    { 'ردیف': 2, 'تاریخ': '1405/06/16', 'واریز': '0', 'برداشت': '1,200,000', 'مانده': '48,800,000', 'شماره پیگیری': '778899', 'شرح': 'خرید اینترنتی' },
  ];
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(mellatRows);
  xlsx.utils.book_append_sheet(wb, ws, 'Mellat-Statement');
  const buf = xlsx.write(wb, { type: 'array', bookType: 'xlsx' });

  const parsedMellat = parseBankStatementBuffer(buf);
  if (parsedMellat.rows.length !== 2) {
    throw new Error(`تعداد سطر استخراج‌شده باید ۲ باشد، دریافت شد: ${parsedMellat.rows.length}`);
  }
  if (parsedMellat.rows[0].type !== 'receipt' || parsedMellat.rows[0].amount !== 10000000) {
    throw new Error(`سطر واریز ملت درست تشخیص داده نشد: ${JSON.stringify(parsedMellat.rows[0])}`);
  }
  if (parsedMellat.rows[1].type !== 'payment' || parsedMellat.rows[1].amount !== 1200000) {
    throw new Error(`سطر برداشت ملت درست تشخیص داده نشد: ${JSON.stringify(parsedMellat.rows[1])}`);
  }
  console.log(`✅ فرمت بانک با موفقیت شناسایی شد: ${parsedMellat.detectedBank || 'بانک'}`);

  console.log('🎉 تمام آزمون‌های موتور مغایرت‌گیری بانکی با موفقیت پاس شدند!');
}

runTests().catch(err => {
  console.error('❌ خطا در اجرای آزمون:', err);
  process.exit(1);
});
