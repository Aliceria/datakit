import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MetricsApp } from './MetricsApp.tsx';
import '../styles/tokens.css';
import '../styles/base.css';
import './metrics.css';

// Painel /metrics: página separada do editor (não chama a visita do editor, então abrir o painel
// não conta como acesso).
const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado em metrics.html');

createRoot(container).render(
  <StrictMode>
    <MetricsApp />
  </StrictMode>,
);
