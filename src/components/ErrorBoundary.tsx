import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

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
    console.error('Uncaught error in component tree:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isModuleLoadError = this.state.error?.message?.includes('dynamically imported module') ||
        this.state.error?.name === 'ChunkLoadError';

      return (
        <div className="min-h-[400px] flex items-center justify-center p-6 text-center">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-xl p-8 max-w-md w-full animate-in fade-in zoom-in-95">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={32} />
            </div>
            
            <h2 className="text-base font-bold text-slate-800 mb-2">
              {isModuleLoadError ? 'به‌روزرسانی نسخه جدید سامانه' : 'خطا در بارگذاری بخش مورد نظر'}
            </h2>
            
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              {isModuleLoadError 
                ? 'فایل‌های این بخش به‌روزرسانی شده‌اند. لطفاً جهت بارگذاری آخرین تغییرات روی دکمه بارگذاری مجدد کلیک کنید.'
                : (this.state.error?.message || 'خطایی در پردازش اطلاعات رخ داده است.')}
            </p>

            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <RefreshCw size={14} />
                <span>بارگذاری مجدد صفحه</span>
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Home size={14} />
                <span>بازگشت به داشبورد</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
