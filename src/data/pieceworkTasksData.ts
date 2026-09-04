export interface DefaultPieceworkTask {
  code: string;
  title: string;
  category: string;
  defaultRate: number;
  unit: string;
}

/**
 * عناوین پیش‌فرض کارها (خالی شده تا توسط کاربر به صورت دستی یا از طریق اکسل بارگذاری شود)
 */
export const INITIAL_PIECEWORK_TASKS: DefaultPieceworkTask[] = [];

