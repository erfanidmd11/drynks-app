// src/boot/GlobalErrorBoundary.tsx
import React from 'react';
import { Alert, AppState } from 'react-native';

type Props = {
  children: React.ReactNode;
  /** UI to show when an error occurs (renders null by default to keep splash at boot). */
  fallback?: React.ReactNode;
  /** Optional error hook for logging/analytics. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** Change this array to reset the boundary after an error. */
  resetKeys?: any[];
  /** Called when the boundary is reset. */
  onReset?: () => void;
};

type State = { error?: Error };

function arraysChanged(a?: any[], b?: any[]) {
  if (a === b) return false;
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

export default class GlobalErrorBoundary extends React.Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      console.warn('[ErrorBoundary] error:', error?.message);
      console.warn('[ErrorBoundary] stack:', error?.stack);
      console.warn('[ErrorBoundary] componentStack:', info?.componentStack);
      this.props.onError?.(error, info);
    } catch {}
    if (__DEV__) {
      try {
        if (AppState.currentState === 'active') {
          Alert.alert('App Error', error.message);
        }
      } catch {}
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && arraysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  reset = () => {
    this.setState({ error: undefined });
    try { this.props.onReset?.(); } catch {}
  };

  render() {
    if (this.state.error) {
      return this.props.fallback ?? null; // null keeps native splash if the crash is at boot
    }
    return this.props.children;
  }
}
