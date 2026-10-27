import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/App';
import { StoreProvider } from '@/guidelines/useConventions';
import { I18nProvider } from '@/i18n';

import './main.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </I18nProvider>
  </StrictMode>
);
