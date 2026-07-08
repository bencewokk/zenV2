import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Rendered instead of the children after a render/lifecycle error. Defaults to nothing. */
  fallback?: ReactNode;
  /** Optional hook for logging/telemetry when a subtree crashes. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  failed: boolean;
}

/**
 * Contains render/lifecycle errors to a subtree so one crashing component can't
 * blank the whole app. Without this, an exception (e.g. a WebGL context failing
 * to initialize in a webview) unmounts the entire React tree — a black screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
