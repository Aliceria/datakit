import { ENCODING_LABELS, formatInteger } from '@datakit/core';
import { activeTable, useApp, type SessionStatus } from '../../state/appStore.ts';
import { normalized } from '../../state/selection.ts';
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
  const selection = useApp((s) => s.selection);
  const views = useApp((s) => s.views);
  const changes = useApp((s) => (s.revision >= 0 ? (s.doc?.marks.changes ?? 0) : 0));
  useApp((s) => s.revision);
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
  const view = views[table.id];
  // Com filtro ativo: "X de Y linhas" (seção 7.4).
  parts.push(
    view?.spec.filters.length
      ? `${formatInteger(view.rowIds.length)} de ${formatInteger(table.rowOrder.length)} linhas`
      : `${formatInteger(table.rowOrder.length)} linhas`,
  );
  parts.push(`${formatInteger(table.columns.length)} colunas`);
  if (selection) {
    const column = table.columns[selection.focus.c];
    const r = normalized(selection, table);
    const size = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
    parts.push(
      size > 1
        ? `L${String(r.r1 + 1)}–L${String(r.r2 + 1)} · ${formatInteger(r.r2 - r.r1 + 1)} × ${formatInteger(r.c2 - r.c1 + 1)}`
        : `L${String(selection.focus.r + 1)} ${column?.name ?? ''}`,
    );
  }

  return (
    <footer className="dk-statusbar" role="status">
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
      {sessionLabel}
      <span
        className={changes > 0 ? 'dk-status-changes is-dirty' : 'dk-status-changes'}
        title="Alterações não exportadas"
        data-testid="unexported-changes"
      >
        {formatInteger(changes)} ●
      </span>
    </footer>
  );
}
