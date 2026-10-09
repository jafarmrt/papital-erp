import { useEffect, useState } from 'react';
import { Download, PlusSquare, Share } from 'lucide-react';
import { Modal } from '../common/Modal';
import { toPersianDigits } from '../../utils/persianNumber';
import { installMode, promptInstall, subscribeInstallMode, type InstallMode } from '../../lib/pwa/installPrompt';

export const INSTALL_BUTTON_TEXT = 'نصب برنامه روی گوشی';
export const IOS_GUIDE_TITLE = 'افزودن برنامه به صفحه اصلی آیفون';
export const IOS_GUIDE_STEPS = [
  'این صفحه را در سافاری باز کنید.',
  'دکمه «اشتراک‌گذاری» پایین صفحه را بزنید.',
  'گزینه «افزودن به صفحه اصلی» را بزنید (نماد مربع با علامت به‌علاوه) و افزودن را تأیید کنید.',
  'برنامه را از آیکون «پاپیتال» باز کنید و یک بار درون خود برنامه وارد شوید.',
] as const;

const STEP_ICONS = [null, Share, PlusSquare, null];

/**
 * v10.0.16 (D-11): دکمه «نصب برنامه روی گوشی» در پایین فهرست کناری. در اندروید پنجره نصب مرورگر را باز می‌کند و در
 * آیفون راهنمای «افزودن به صفحه اصلی» را، چون آیفون نصب خودکار ندارد. برنامه نصب‌شده و رایانه بی پنجره نصب دکمه را نمی‌بینند.
 */
export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<InstallMode>(installMode);
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => subscribeInstallMode(() => setMode(installMode())), []);

  if (mode === 'none') return null;

  const onClick = () => {
    if (mode === 'ios-guide') setGuideOpen(true);
    else void promptInstall();
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        title={INSTALL_BUTTON_TEXT}
        className={compact
          ? 'flex items-center justify-center p-2 text-amber-300 hover:text-white rounded-lg hover:bg-slate-900 cursor-pointer'
          : 'flex items-center gap-2 px-2 py-1.5 text-amber-300 hover:text-white rounded-lg hover:bg-slate-900 cursor-pointer'}
      >
        <Download size={16} className="shrink-0" aria-hidden="true" />
        {!compact && <span className="truncate">{INSTALL_BUTTON_TEXT}</span>}
      </button>
      <Modal isOpen={guideOpen} onClose={() => setGuideOpen(false)} title={IOS_GUIDE_TITLE} size="sm">
        <ol className="space-y-3 text-sm text-slate-700 leading-7" dir="rtl">
          {IOS_GUIDE_STEPS.map((step, index) => {
            const Icon = STEP_ICONS[index];
            return (
              <li key={step} className="flex items-start gap-3">
                <span className="w-6 h-6 shrink-0 rounded-full bg-slate-900 text-amber-400 text-xs font-bold flex items-center justify-center">
                  {toPersianDigits(index + 1)}
                </span>
                <span className="flex-1">{step}</span>
                {Icon && <Icon size={18} className="text-blue-600 shrink-0 mt-1" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      </Modal>
    </>
  );
}

export default InstallAppButton;
