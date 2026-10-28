import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import { ErrorBoundary } from '../ErrorBoundary'
import { STRINGS } from '../../i18n/strings'

/** Collect the text of a React element tree without a DOM. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (isValidElement(node)) {
    return textOf((node.props as { children?: unknown }).children)
  }
  return ''
}

describe('error boundary', () => {
  it('renders its children when nothing has failed', () => {
    const b = new ErrorBoundary({ children: 'the app' })
    b.state = { error: null }
    expect(b.render()).toBe('the app')
  })

  it('shows a localised message and the cause instead of a white screen', () => {
    // The fallback is the one component that must never throw, and it cannot
    // use the i18n context because the provider may be what failed.
    const b = new ErrorBoundary({ children: 'the app' })
    b.state = ErrorBoundary.getDerivedStateFromError(new Error('vehicles is not iterable'))
    const text = textOf(b.render())
    expect(text).toContain(STRINGS.de['crash.title'])
    expect(text).toContain('vehicles is not iterable')
    expect(text).toContain(STRINGS.de['crash.reload'])
  })

  it('survives a hostile environment while reading the language', () => {
    // localStorage throws in some privacy modes. A boundary that dies there
    // takes the whole demo with it, silently.
    const store = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('access denied')
      },
    })
    try {
      const b = new ErrorBoundary({ children: 'x' })
      b.state = { error: new Error('boom') }
      expect(() => b.render()).not.toThrow()
      expect(textOf(b.render())).toContain('boom')
    } finally {
      if (store) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store })
      else delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })

  it('keeps the stack in the console for afterwards', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const b = new ErrorBoundary({ children: 'x' })
    b.componentDidCatch(new Error('boom'), { componentStack: 'at NetworkMap' } as never)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
