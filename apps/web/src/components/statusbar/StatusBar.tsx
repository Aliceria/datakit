import { ENCODING_LABELS, formatInteger } from '@datakit/core';
import { activeTable, useApp } from '../../state/appStore.ts';
import './StatusBar.css';

// Formato, codificação, linhas e colunas (seção 11.3). Seleção e estado da sessão: Etapas 4 e 5.
export function StatusBar() {
  const doc = useApp((s) => s.doc);
  const table = useApp(activeTable);

  if (!doc || !table) {
    return (
      <footer className="dk-statusbar" role="status">
        <span>Nenhum arquivo aberto</span>
      </footer>
    );
  }

  const { source } = doc.manifest;
  const parts = [source.format.toUpperCase()];
  if (source.encoding && source.format !== 'xlsx') parts.push(ENCODING_LABELS[source.encoding]);
  parts.push(`${formatInteger(table.rowOrder.length)} linhas`);
  parts.push(`${formatInteger(table.columns.length)} colunas`);

  return (
    <footer className="dk-statusbar" role="status">
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </footer>
  );
}
