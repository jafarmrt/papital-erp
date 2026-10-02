/**
 * v7.0.40 (P2-11): پیش‌بارگذاری برای تست reg_process_exits_on_unhandled_errors_p2_11 —
 * پس از اینکه سرور به درخواست‌ها پاسخ داد (یعنی handlerهای پردازه نصب شده‌اند) یک خطای مدیریت‌نشده پرتاب می‌کند.
 */
const port = process.env.PORT || '3000';

const waitAndThrow = async (): Promise<void> => {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/live`);
      if (res.ok) {
        console.log('UNCAUGHT_PROBE_FIRING');
        setTimeout(() => {
          throw new Error('P2-11 probe: unexpected uncaught exception');
        }, 0);
        return;
      }
    } catch {
      // سرور هنوز گوش نمی‌دهد
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
};

void waitAndThrow();
