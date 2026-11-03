import { ENCODING_LABELS, formatInteger } from '@datakit/core';
import { activeTable, useApp, type SessionStatus } from '../../state/appStore.ts';
import './StatusBar.css';

/** Textos da seção 5.3. */
const SESSION_LABEL: Record<Exclude<SessionStatus, 'none'>, string> = {
  saved: 'Salvo',
  saving: 'Salvando…',
  offline: 'Sem conexão — tentando novamente',
  expired: 'Sessão expirada',
};

// Formato, codificação, linhas, colunas e estado da sessão (seção 11.3). Seleção: Etapa 5.
export function StatusBar() {
  const doc = useApp((s) => s.doc);
  const table = useApp(activeTable);
  const status = useApp((s) => s.sessionStatus);
  const sessionLabel =
    status === 'none' ? null : (
      <span className={`dk-status-session is-${status}`} data-testid="session-status">
        {SESSION_LABEL[status]}
      </span>
    );

  if (!doc || !table) {
    return (
      <footer className="dk-statusbar" role="status">
        <span>Nenhum arquivo aberto</span>
        {sessionLabel}
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
      {sessionLabel}
    </footer>
  );
}
