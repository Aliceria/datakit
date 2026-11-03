import { X } from 'lucide-react';
import { describeFilter, planApplyOrder } from '@datakit/core';
import { activeTable, useApp } from '../../state/appStore.ts';
import { execute } from '../../state/editor.ts';
import {
  clearFilters,
  clearSort,
  reapplyView,
  setColumnFilter,
  setSort,
  sortedDataOrder,
} from '../../state/view.ts';

/** Filtros ativos e ordenação (seções 7.4 e 11.3), removíveis um a um. */
export function FiltersSort() {
  const table = useApp(activeTable);
  const view = useApp((s) => (table ? s.views[table.id] : undefined));
  const readOnly = useApp((s) => s.sessionStatus === 'expired');
  useApp((s) => s.revision);
  if (!table) return <p className="dk-section-empty">Nenhum arquivo aberto.</p>;
  const filters = view?.spec.filters ?? [];
  const sort = view?.spec.sort ?? [];
  const name = (colId: string) => table.columns.find((c) => c.id === colId)?.name ?? colId;

  if (filters.length === 0 && sort.length === 0) {
    return (
      <p className="dk-section-empty">
        Nenhum filtro ou ordenação. Use a seta no cabeçalho ou o menu da coluna (clique direito).
      </p>
    );
  }

  /** "Aplicar ordem atual aos dados": todas as linhas, inclusive as escondidas pelo filtro. */
  const applyOrder = () => {
    const order = sortedDataOrder(table.id);
    if (!order) return;
    if (execute('Aplicar ordem aos dados', planApplyOrder(table, order))) clearSort(table.id);
  };

  return (
    <div>
      {view?.stale && (
        <p className="dk-view-stale" role="status">
          Os dados mudaram depois de aplicar os filtros e a ordenação.
        </p>
      )}
      {filters.length > 0 && (
        <>
          <p className="dk-view-subtitle">Filtros (combinados com E)</p>
          <ul className="dk-view-list" aria-label="Filtros ativos">
            {filters.map((f) => (
              <li key={f.colId}>
                <span>{describeFilter(f, name(f.colId))}</span>
                <button
                  type="button"
                  className="dk-view-remove"
                  aria-label={`Remover filtro de ${name(f.colId)}`}
                  onClick={() => {
                    setColumnFilter(table.id, f.colId, undefined);
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {sort.length > 0 && (
        <>
          <p className="dk-view-subtitle">Ordenação</p>
          <ol className="dk-view-list" aria-label="Critérios de ordenação">
            {sort.map((k) => (
              <li key={k.colId}>
                <span>
                  {name(k.colId)} {k.direction === 'asc' ? '↑ crescente' : '↓ decrescente'}
                </span>
                <button
                  type="button"
                  className="dk-view-remove"
                  aria-label={`Remover ordenação por ${name(k.colId)}`}
                  onClick={() => {
                    setSort(table.id, k.colId, undefined, true);
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="dk-panel-actions">
        {view?.stale && (
          <button
            type="button"
            className="dk-button is-primary"
            onClick={() => {
              reapplyView(table.id);
            }}
          >
            Reaplicar
          </button>
        )}
        {filters.length > 0 && (
          <button
            type="button"
            className="dk-button"
            onClick={() => {
              clearFilters(table.id);
            }}
          >
            Limpar filtros
          </button>
        )}
        {sort.length > 0 && (
          <>
            <button
              type="button"
              className="dk-button"
              onClick={() => {
                clearSort(table.id);
              }}
            >
              Limpar ordenação
            </button>
            <button type="button" className="dk-button" disabled={readOnly} onClick={applyOrder}>
              Aplicar ordem atual aos dados
            </button>
          </>
        )}
      </div>
    </div>
  );
}
