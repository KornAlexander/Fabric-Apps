import { Component, type ErrorInfo, type ReactNode } from 'react'
import { STRINGS, type Lang } from '../i18n/strings'

/**
 * Last line of defence for a live demo.
 *
 * React unmounts the entire tree when a render throws, so one bad value in one
 * panel turns the screen white in front of the room - with no way back except a
 * reload nobody wants to perform on stage. This keeps the failure local and
 * legible: say what happened, offer a reload, and keep the error text on screen
 * so the cause is not lost.
 *
 * It reads the language directly rather than through the context, because the
 * provider itself may be what failed.
 */
type Props = { children: ReactNode }
type State = { error: Error | null }

function lang(): Lang {
  try {
    const stored = localStorage.getItem('bsw-twin-lang')
    if (stored === 'en' || stored === 'de') return stored
    return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'de'
  } catch {
    return 'de'
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the console: on stage the visible message is for the
    // room, the console is for afterwards.
    console.error('render failed', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const t = STRINGS[lang()]
    return (
      <div className="crash" role="alert" data-testid="crash">
        <h1>{t['crash.title']}</h1>
        <p>{t['crash.text']}</p>
        <pre className="crash-detail">{error.message}</pre>
        <button type="button" onClick={() => window.location.reload()} data-testid="crash-reload">
          {t['crash.reload']}
        </button>
      </div>
    )
  }
}
