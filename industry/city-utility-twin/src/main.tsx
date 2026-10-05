import './style.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getLanguage } from './i18n';

document.documentElement.lang = getLanguage();

// ⚠️ NO <StrictMode>. Its development double mount would dispose the WebGL scene and immediately
// build a second one on the same canvas, which loads every terrain asset twice and can leave the
// canvas with a lost context. The scene's own effect already cleans up correctly on unmount.
createRoot(document.getElementById('root')!).render(<App />);
