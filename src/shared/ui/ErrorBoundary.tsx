import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Rendered instead of the children after a render/lifecycle error. Defaults to nothing. */
  fallback?: ReactNode | ((error: Error, info: ErrorInfo | null) => ReactNode);
  /** Optional hook for logging/telemetry when a subtree crashes. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Contains render/lifecycle errors to a subtree so one crashing component can't
 * blank the whole app. Without this, an exception (e.g. a WebGL context failing
 * to initialize in a webview) unmounts the entire React tree — a black screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: unknown): Pick<State, "error"> {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.error) {
      return typeof this.props.fallback === "function"
        ? this.props.fallback(this.state.error, this.state.info)
        : this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
