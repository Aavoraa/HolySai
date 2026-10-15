import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { AuthProvider } from '@/auth/AuthContext';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { initTheme } from '@/theme/theme';
import App from './App';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/home.css';
import './styles/responsive.css';
import './styles/app.css';
import './styles/modules/admissions-parents.css';
import './styles/modules/academics.css';
import './styles/modules/finance-workforce.css';
import './styles/modules/safety-tracking.css';
import './styles/modules/portals.css';
import './styles/modules/operations-intel.css';
import './styles/modules/exam-correction.css';
import './styles/system.css';
import './styles/hues.css';

initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <I18nProvider>
          <ToastProvider>
            <ConfirmProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </I18nProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
