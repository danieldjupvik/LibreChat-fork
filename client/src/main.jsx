import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import './locales/i18n';
import App from './App';
import './style.css';
import './mobile.css';
import './forked-style-custom/custom-daniel-ai.css';
import { ApiErrorBoundaryProvider } from './hooks/ApiErrorBoundaryContext';
import { ForkedCustomizations } from './forked-code-custom';
import 'katex/dist/katex.min.css';

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <ApiErrorBoundaryProvider>
    <ForkedCustomizations />
    <App />
  </ApiErrorBoundaryProvider>,
);
