import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import App from './App.tsx';
import { AuthProvider } from './hooks/useAuth.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { detectBrowserLocale, I18nProvider, readStoredLocale } from './i18n';
import { appResources } from './i18n/appResources';
import './index.css';

document.documentElement.lang = readStoredLocale() ?? detectBrowserLocale();

// Mobile browser chrome can leave CSS viewport units taller than the portion
// of the page that is actually visible. Keep a live pixel value from the
// Visual Viewport API so bottom-docked controls stay above browser toolbars and
// the on-screen keyboard. Browsers without the API fall back to innerHeight.
const syncAppViewportHeight = () => {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-viewport-height', `${Math.round(height)}px`);
};

syncAppViewportHeight();
window.addEventListener('resize', syncAppViewportHeight, { passive: true });
window.visualViewport?.addEventListener('resize', syncAppViewportHeight, { passive: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <I18nProvider resources={appResources}>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </MotionConfig>
  </StrictMode>,
);
