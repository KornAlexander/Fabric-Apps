import { Component, type ReactNode } from 'react';

/**
 * Contains the failure of ONE lazily loaded piece, so it cannot take the shell down with it.
 *
 * ⚠️ A LAZY CHUNK CAN STOP EXISTING WHILE THE PAGE IS OPEN. Chunk file names carry a content hash,
 * and a deploy replaces them. A tab opened before the deploy still asks for the old name the first
 * time its user presses the button, gets a 404, and `lazy()` throws during render. With no boundary
 * that error unmounts everything up to the root: the campus goes blank because a report window
 * failed to load.
 *
 * ⚠️ AND THE FAILURE IS PERMANENT FOR THAT TAB, so it is SHOWN rather than swallowed. `lazy()`
 * remembers a rejected import and rejects again on every later render; only a reload fetches the
 * new file names. Rendering nothing would leave a button that silently does nothing, so the
 * boundary renders `fallback`, which is where the owner says "reload the page".
 */
export class ChunkBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; onError?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError?.();
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
