import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from './layout'

type State = { error: Error | null }

/** Keeps one broken view from blanking the whole window; offers a retry instead. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Intentionally not logged with details: messages may contain user data.
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="p-8">
          <ErrorState
            error={new Error('This view hit an unexpected problem. Your data was not changed.')}
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      )
    }
    return this.props.children
  }
}
