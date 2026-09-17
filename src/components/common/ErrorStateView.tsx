import { useState } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

export interface ErrorStateViewProps {
  title?: string;
  description?: string;
  error?: Error | string | null;
  onRetry?: () => void | Promise<void>;
  retryText?: string;
  className?: string;
  compact?: boolean;
  showTechnicalDetails?: boolean;
}

/**
 * Enterprise user-friendly Error State View for ERP V4.
 * Replaces white screens and raw English stack traces with elegant Persian messages and retry capability.
 */
export function ErrorStateView({
  title = 'عدم امکان بارگذاری اطلاعات این بخش',
  description = 'در دریافت یا پردازش اطلاعات خطایی رخ داده است. لطفاً اتصال اینترنت خود را بررسی نموده و دوباره تلاش فرمایید.',
  error,
  onRetry,
  retryText = 'تلاش مجدد',
  className = '',
  compact = false,
  showTechnicalDetails = true,
}: ErrorStateViewProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const errorMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : null;
  const errorStack = error instanceof Error ? error.stack : null;

  const handleRetry = async () => {
    if (!onRetry || isRetrying) return;
    try {
      setIsRetrying(true);
      await Promise.resolve(onRetry());
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCopyDetails = () => {
    const details = `[خطای سامانه پاپیتال]\nپیام: ${errorMessage || 'نامشخص'}\nجزئیات: ${errorStack || '---'}`;
    navigator.clipboard.writeText(details);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (compact) {
    return (
      <div
        className={`flex items-center justify-between p-3.5 bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-xl text-xs text-rose-800 dark:text-rose-200 ${className}`}
        dir="rtl"
        role="alert"
      >
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="truncate font-medium">{title}</span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 disabled:opacity-50 text-[11px]"
          >
            <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
            <span>{retryText}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`min-h-[260px] flex flex-col items-center justify-center p-6 text-center bg-white/60 dark:bg-slate-900/60 border border-rose-100 dark:border-rose-950/80 rounded-2xl sm:rounded-3xl shadow-xs transition-all ${className}`}
      dir="rtl"
      role="alert"
    >
      <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-3 shadow-xs">
        <AlertTriangle className="w-7 h-7" />
      </div>

      <h3 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 mb-1.5">
        {title}
      </h3>

      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md leading-relaxed mb-5">
        {description}
      </p>

      {onRetry && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={isRetrying}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition shadow-md shadow-amber-500/20 flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
          <span>{isRetrying ? 'در حال بازخوانی...' : retryText}</span>
        </button>
      )}

      {showTechnicalDetails && errorMessage && (
        <div className="mt-5 w-full max-w-md text-right">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center justify-between w-full text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-1.5 border-t border-slate-100 dark:border-slate-800 transition cursor-pointer"
          >
            <span>مشاهده جزئیات فنی خطا (ویژه پشتیبانی)</span>
            {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showDetails && (
            <div className="mt-2 p-3 bg-slate-900 text-slate-300 rounded-xl text-[10px] font-mono text-left relative overflow-x-auto max-h-36" dir="ltr">
              <button
                type="button"
                onClick={handleCopyDetails}
                className="absolute top-2 right-2 p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition cursor-pointer"
                title="کپی کردن متن خطا"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
              <div className="text-rose-400 font-bold mb-1">{errorMessage}</div>
              {errorStack && <pre className="whitespace-pre-wrap opacity-75">{errorStack}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ErrorStateView;
