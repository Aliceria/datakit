import { useEffect, useRef, useState } from 'react';
import { formatInteger } from '@datakit/core';
import { activeTable, appStore, showError, useApp } from '../../state/appStore.ts';
import { selectCell } from '../../state/selection.ts';
import { visibleRows } from '../../state/view.ts';

/** Evento que o Ctrl+G dispara para pôr o foco no "Ir para". */
export const FOCUS_GOTO_EVENT = 'dk:focus-goto';

/**
 * Ir para (seção 11.3): linha e coluna. O número da linha é a posição nos dados, o mesmo que a
 * grade mostra, com ou sem filtro e ordenação.
 */
export function GoTo() {
  const table = useApp(activeTable);
  useApp((s) => s.revision);
  const [row, setRow] = useState('');
  const [colId, setColId] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => {
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener(FOCUS_GOTO_EVENT, focus);
    return () => {
      window.removeEventListener(FOCUS_GOTO_EVENT, focus);
    };
  }, []);

  if (!table) return <p className="dk-section-empty">Nenhum arquivo aberto.</p>;

  const go = () => {
    const n = Number(row.trim());
    const total = table.rowOrder.length;
    if (!Number.isInteger(n) || n < 1 || n > total) {
      showError('Linha inválida', `Digite um número de linha entre 1 e ${formatInteger(total)}.`);
      return;
    }
    const rowId = table.rowOrder[n - 1];
    const r = rowId === undefined ? -1 : visibleRows(appStore.get(), table).indexOf(rowId);
    if (r < 0) {
      showError('Linha oculta', `A linha ${formatInteger(n)} está escondida pelos filtros.`);
      return;
    }
    const c = Math.max(
      0,
      table.columns.findIndex((col) => col.id === colId),
    );
    selectCell(r, c);
    document.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true });
  };

  return (
    <div>
      <div className="dk-form-row">
        <label htmlFor="dk-goto-row">Linha</label>
        <input
          id="dk-goto-row"
          ref={input}
          className="dk-field"
          inputMode="numeric"
          value={row}
          placeholder={`1 a ${formatInteger(table.rowOrder.length)}`}
          onChange={(e) => {
            setRow(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go();
            }
          }}
        />
      </div>
      <div className="dk-form-row">
        <label htmlFor="dk-goto-col">Coluna</label>
        <select
          id="dk-goto-col"
          className="dk-field"
          value={colId}
          onChange={(e) => {
            setColId(e.target.value);
          }}
        >
          <option value="">(a primeira)</option>
          {table.columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="dk-panel-actions">
        <button type="button" className="dk-button" onClick={go}>
          Ir
        </button>
      </div>
    </div>
  );
}
