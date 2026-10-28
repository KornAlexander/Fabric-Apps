import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { prefetchBaked } from './lib/fetchBaked'
import { I18nProvider } from './i18n/I18nProvider'
import './main.css'

// Started before React mounts, so the download overlaps start-up. Access is
// enforced by the host (assetAccess: protected in rayfin.yml), so the app needs
// no sign-in gate of its own - that gate cost a ~15 s token exchange.
prefetchBaked(['data/charging.json', 'data/sites.json', 'data/units.json'])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
)
