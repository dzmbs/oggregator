import { Component, type ErrorInfo, type ReactNode } from 'react';

import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
  label?: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', this.props.label ?? 'unknown', error, info.componentStack);
    }
  }

  handleRetry = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={styles.wrap} role="alert">
        <span className={styles.icon} aria-hidden>
          ⚠
        </span>
        <span className={styles.title}>
          {this.props.label ? `${this.props.label} failed to load` : 'Something went wrong'}
        </span>
        <span className={styles.detail}>{error.message || 'An unexpected error occurred.'}</span>
        <button className={styles.retry} onClick={this.handleRetry} type="button">
          Retry
        </button>
      </div>
    );
  }
}
