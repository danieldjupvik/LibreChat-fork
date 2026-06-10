import './polyfills/regeneratorRuntime';
import { createRoot } from 'react-dom/client';
import { initializeI18n } from './locales/i18n';
import App from './App';
import '@librechat/client/style.css';
import './style.css';
import './mobile.css';
import './forked-style-custom/custom-daniel-ai.css';
import { ApiErrorBoundaryProvider } from './hooks/ApiErrorBoundaryContext';
import { ForkedCustomizations } from './forked-code-custom';
import 'katex/dist/katex.min.css';
import 'katex/dist/contrib/copy-tex.js';

const container = document.getElementById('root');
const root = createRoot(container);

<<<<<<< HEAD
root.render(
  <ApiErrorBoundaryProvider>
    {/* FORK-SENTINEL:forked-customizations — mounts fork-only global customizations (and custom CSS import above) */}
    <ForkedCustomizations />
    <App />
  </ApiErrorBoundaryProvider>,
);
||||||| e25373d7d
root.render(
  <ApiErrorBoundaryProvider>
    <App />
  </ApiErrorBoundaryProvider>,
);
=======
async function bootstrap() {
  await initializeI18n();

  root.render(
    <ApiErrorBoundaryProvider>
      <App />
    </ApiErrorBoundaryProvider>,
  );
}

bootstrap().catch((error) => {
  console.error('[i18n] Failed to initialize before render', error);
  root.render(
    <ApiErrorBoundaryProvider>
      <App />
    </ApiErrorBoundaryProvider>,
  );
});
>>>>>>> upstream/main
