import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { reportVisit } from './api/client.ts';
import { installPageLifecycle, startSession } from './session/sessionManager.ts';
import './styles/tokens.css';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Elemento #root não encontrado em index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Ciclo de vida da sessão: eventos da página e, se houver token nesta aba, retomar ou copiar.
installPageLifecycle();
void startSession();
reportVisit();
