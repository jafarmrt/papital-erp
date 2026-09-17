import { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorStateView } from './ErrorStateView';

export interface SectionErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  title?: string;
  description?: string;
  compact?: boolean;
  onReset?: () => void;
  resetKeys?: any[];
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
      const hasChanged = this.props.resetKeys.some(
        (key, idx) => key !== prevProps.resetKeys![idx]
      );
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

      return (
        <ErrorStateView
          title={this.props.title || 'خطا در بارگذاری این بخش'}
          description={
            this.props.description ||
            'پردازش داده‌های این بخش با مشکل مواجه شد. می‌توانید با فشردن دکمه زیر مجدداً تلاش نمایید.'
          }
          error={this.state.error}
          onRetry={this.handleReset}
          retryText="بارگذاری مجدد این بخش"
          compact={this.props.compact}
        />
      );
    }

    return this.props.children;
  }
}

export default SectionErrorBoundary;
