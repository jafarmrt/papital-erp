import React , { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { isChunkLoadError, reloadOnceForNewVersion, reloadPage } from '../lib/system/chunkReload';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  title?: string;
  description?: string;
  /** OBS-R2-92: a new value (the route's pathname for the root boundary) clears a caught error */
  resetKey?: unknown;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global & Route-level Error Boundary for Papital ERP.
 * Catches unhandled exceptions, provides graceful recovery, and offers user-friendly Persian messaging.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  declare props: Props;
  declare state: State;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error in component tree:', error, errorInfo);
    // OBS-R2-92: only a chunk that failed to load is a new version; one automatic reload per guard window, never a loop
    if (isChunkLoadError(error)) {
      setTimeout(() => { reloadOnceForNewVersion(error); }, 150);
    }
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    reloadPage();
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isModuleLoadError = isChunkLoadError(this.state.error);

      return (
        <div className="min-h-[420px] flex items-center justify-center p-6 text-center" dir="rtl">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl p-8 max-w-lg w-full animate-in fade-in zoom-in-95">
            <div className="w-16 h-16 bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xs">
              <AlertTriangle size={32} />
            </div>

            <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">
              {isModuleLoadError ? 'به‌روزرسانی نسخه جدید سامانه' : (this.props.title || 'خطا در بارگذاری بخش مورد نظر')}
            </h2>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              {isModuleLoadError
                ? 'نسخه جدیدی از سامانه منتشر شده است. لطفاً جهت بارگذاری آخرین فایل‌ها روی دکمه بارگذاری مجدد کلیک کنید.'
                : (this.props.description || 'در پردازش یا نمایش اطلاعات این صفحه مشکلی رخ داده است. می‌توانید با دکمه تلاش مجدد یا بازگشت به پیشخوان به کار خود ادامه دهید.')}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <RefreshCw size={14} />
                <span>تلاش مجدد در همین بخش</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw size={14} />
                <span>بارگذاری مجدد کل صفحه</span>
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Home size={14} />
                <span>بازگشت به پیشخوان</span>
              </button>
            </div>

            {/* Collapsible Technical Details for Diagnostics */}
            {this.state.error && (
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                <details className="text-right">
                  <summary className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer select-none">
                    مشاهده جزئیات فنی خطا (ویژه پشتیبانی)
                  </summary>
                  <div className="mt-2 p-3 bg-slate-900 text-slate-200 rounded-xl text-[10px] font-mono text-left max-h-40 overflow-y-auto leading-relaxed" dir="ltr">
                    <div className="text-rose-400 font-bold mb-1">{this.state.error.name}: {this.state.error.message}</div>
                    {this.state.error.stack && <pre className="whitespace-pre-wrap opacity-75">{this.state.error.stack}</pre>}
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
