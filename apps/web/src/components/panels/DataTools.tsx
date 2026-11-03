import { activeTable, useApp } from '../../state/appStore.ts';
import { selectedIds } from '../../state/selection.ts';
import {
  COLUMN_TOOLS,
  identifyInconsistent,
  locateBlanks,
  openTool,
  TOOL_TITLES,
  type ToolKind,
} from '../../state/tools.ts';
import './DataTools.css';

// Seção "Tratamento de dados" do painel direito (seção 8).

const ROW_TOOLS: ToolKind[] = ['duplicates', 'emptyRows'];

/** Todas abrem um diálogo de confirmação (seção 8): rótulo com reticências. */
const toolLabel = (kind: ToolKind) => `${TOOL_TITLES[kind]}…`;

export function DataTools() {
  const table = useApp(activeTable);
  const selection = useApp((s) => s.selection);
  const readOnly = useApp((s) => s.sessionStatus === 'expired');
  if (!table) return <p className="dk-section-empty">Nenhum arquivo aberto.</p>;

  const colIds = selection ? selectedIds(selection, table).colIds : [];
  const names = table.columns.filter((c) => colIds.includes(c.id)).map((c) => c.name);
  const single = colIds.length === 1 ? colIds[0] : undefined;

  return (
    <div className="dk-tools">
      <h3 className="dk-tools-title">Tabela</h3>
      <div className="dk-tools-grid">
        {ROW_TOOLS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="dk-button"
            disabled={readOnly}
            onClick={() => {
              openTool(kind);
            }}
          >
            {toolLabel(kind)}
          </button>
        ))}
        <button
          type="button"
          className="dk-button"
          onClick={() => {
            locateBlanks(table.id, undefined);
          }}
        >
          Localizar vazios
        </button>
        <button
          type="button"
          className="dk-button"
          onClick={() => {
            identifyInconsistent(table.id);
          }}
        >
          Identificar inconsistentes
        </button>
      </div>

      <h3 className="dk-tools-title">Colunas selecionadas</h3>
      <p className="dk-tools-cols" title={names.join(', ')}>
        {names.length === 0 ? 'Selecione colunas na grade.' : names.join(', ')}
      </p>
      <div className="dk-tools-grid">
        <button
          type="button"
          className="dk-button"
          disabled={!single}
          title={single ? undefined : 'Selecione uma coluna'}
          onClick={() => {
            if (single) locateBlanks(table.id, single);
          }}
        >
          Vazios na coluna
        </button>
        {COLUMN_TOOLS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="dk-button"
            disabled={readOnly || names.length === 0}
            onClick={() => {
              openTool(kind);
            }}
          >
            {toolLabel(kind)}
          </button>
        ))}
      </div>
    </div>
  );
}
