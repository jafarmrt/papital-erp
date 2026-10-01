import { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorStateView } from './ErrorStateView';

export interface SectionErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  title?: string;
  description?: string;
  compact?: boolean;
  onReset?: () => void;
  resetKeys?: readonly unknown[];
}

interface SectionErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Robust Section-level Error Boundary for enterprise subcomponents, tabs, and tables.
 * Prevents a single localized crash from blanking the entire ERP dashboard.
 */
export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): SectionErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log structured error for observability
    console.error('[SectionErrorBoundary] Caught rendering error:', error, errorInfo);
  }

  public componentDidUpdate(prevProps: SectionErrorBoundaryProps) {
    // Automatically reset when specified resetKeys change (e.g. activeTab, selectedItemId)
    if (this.state.hasError && this.props.resetKeys && prevProps.resetKeys) {
      const prevKeys = prevProps.resetKeys;
      const currKeys = this.props.resetKeys;
      const hasChanged =
        currKeys.length !== prevKeys.length ||
        currKeys.some((key, idx) => key !== prevKeys[idx]);
      if (hasChanged) {
        this.handleReset();
      }
    }
  }

  public handleReset = () => {
    if (this.props.onReset) {
      try {
        this.props.onReset();
      } catch (err) {
        console.warn('[SectionErrorBoundary] onReset handler error:', err);
      }
    }
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError && this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error, this.handleReset);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isChunkLoadError =
        this.state.error.message?.includes('dynamically imported module') ||
        this.state.error.name === 'ChunkLoadError' ||
        this.state.error.message?.includes('Loading chunk') ||
        this.state.error.message?.includes('Failed to fetch');

      const title = isChunkLoadError
        ? 'به‌روزرسانی نسخه جدید سامانه'
        : (this.props.title || 'خطا در بارگذاری این بخش');

      const description = isChunkLoadError
        ? 'نسخه جدیدی از این ماژول در سرور منتشر شده است. جهت بارگذاری کامل، لطفاً این بخش را بازنشانی فرمایید.'
        : (this.props.description ||
           'پردازش داده‌های این بخش با مشکل مواجه شد. می‌توانید با فشردن دکمه زیر مجدداً تلاش نمایید.');

      const onRetryAction = isChunkLoadError
        ? () => {
            try {
              window.location.reload();
            } catch {
              this.handleReset();
            }
          }
        : this.handleReset;

      return (
        <ErrorStateView
          title={title}
          description={description}
          error={this.state.error}
          onRetry={onRetryAction}
          retryText={isChunkLoadError ? 'تازه‌سازی و دریافت نسخه جدید' : 'بارگذاری مجدد این بخش'}
          compact={this.props.compact}
        />
      );
    }

    return this.props.children;
  }
}

export default SectionErrorBoundary;
