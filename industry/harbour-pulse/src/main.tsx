import { createRoot } from 'react-dom/client';

import App from '@/App';
import { AuthProvider } from '@/hooks/AuthContext';
import { bootstrapAuth } from '@/services/bootstrap';
import { isKustoConnectPopup, runKustoConnectPopup } from '@/services/kustoClient';

import './main.css';

// The interactive-auth popup reuses this origin; it must not boot the app.
if (isKustoConnectPopup()) {
  void runKustoConnectPopup();
} else {
  const authService = bootstrapAuth();

  createRoot(document.getElementById('root')!).render(
    <AuthProvider authService={authService}>
      <App />
    </AuthProvider>
  );
}
