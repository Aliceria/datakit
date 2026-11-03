import { X } from 'lucide-react';
import { appStore, activeTable, useApp } from '../../state/appStore.ts';
import { requestCloseFile } from '../../state/importFlow.ts';
import { rememberActiveTable, rememberScroll, tableView } from '../../session/viewState.ts';
import { Grid } from '../grid/Grid.tsx';
import { EmptyState } from './EmptyState.tsx';
import './Workspace.css';

type Props = { onOpen: () => void };

export function Workspace({ onOpen }: Props) {
  const doc = useApp((s) => s.doc);
  const table = useApp(activeTable);
  const busy = useApp((s) => s.busy);

  if (!doc || !table) {
    return (
      <div className="dk-workspace-inner">
        <EmptyState onOpen={onOpen} />
        {busy && <BusyOverlay text={busy} />}
      </div>
    );
  }

  const manifestTable = doc.manifest.tables.find((t) => t.id === table.id);
  const isXlsx = doc.manifest.source.format === 'xlsx';

  return (
    <div className="dk-workspace-inner">
      <div className="dk-filetabs" role="presentation">
        <div className="dk-filetab">
          <span className="dk-filetab-name" title={doc.manifest.source.fileName}>
            {doc.manifest.source.fileName}
          </span>
          <button
            type="button"
            className="dk-filetab-close"
            aria-label="Fechar o arquivo"
            title="Fechar o arquivo"
            onClick={requestCloseFile}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      </div>

      {table.columns.length === 0 ? (
        <p className="dk-sheet-empty">Esta aba está vazia.</p>
      ) : (
        <Grid
          key={table.id}
          table={table}
          inference={manifestTable?.inference ?? {}}
          initialScroll={tableView(table.id)}
          onScroll={(top, left) => {
            rememberScroll(table.id, top, left);
          }}
        />
      )}

      {isXlsx && (
        <div className="dk-sheettabs" role="tablist" aria-label="Abas da planilha">
          {doc.tables.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === table.id}
              className={t.hidden ? 'dk-sheettab is-hidden' : 'dk-sheettab'}
              title={t.hidden ? 'Aba oculta no arquivo original' : t.name}
              onClick={() => {
                rememberActiveTable(t.id);
                appStore.set({ activeTableId: t.id });
              }}
            >
              {t.name}
              {t.hidden ? ' (oculta)' : ''}
            </button>
          ))}
        </div>
      )}
      {busy && <BusyOverlay text={busy} />}
    </div>
  );
}

function BusyOverlay({ text }: { text: string }) {
  return (
    <div className="dk-busy" role="status" aria-live="polite">
      <span>{text}</span>
    </div>
  );
}
