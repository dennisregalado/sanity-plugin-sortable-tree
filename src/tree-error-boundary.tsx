import {Component, type ErrorInfo, type ReactNode} from 'react'

interface Props {
  children?: ReactNode
  /** Rendered instead of the children after they throw */
  fallback: () => ReactNode
}

interface State {
  error: Error | null
}

/**
 * Keeps an error in the tree from taking down the whole document form: the field falls back to
 * the Studio's default array input instead. (`@sanity/ui`'s `ErrorBoundary` is marked "do not use
 * in production" and renders the raw error message.)
 */
export class TreeErrorBoundary extends Component<Props, State> {
  override state: State = {error: null}

  static getDerivedStateFromError(error: Error): State {
    return {error}
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the error for debugging; the user sees the default input instead
    console.error('[sanity-plugin-sortable-tree] Falling back to the default input:', error, info)
  }

  override render(): ReactNode {
    return this.state.error ? this.props.fallback() : this.props.children
  }
}
