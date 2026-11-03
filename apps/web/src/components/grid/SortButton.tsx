import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortDirection } from '@datakit/core';

type Props = {
  columnName: string;
  sortKey: { direction: SortDirection; priority: number } | undefined;
  /** Há mais de um critério: mostra a prioridade. */
  multi: boolean;
  onToggle: (additive: boolean) => void;
};

/**
 * Seta de ordenação do cabeçalho (seção 7.4, L43): clique alterna crescente → decrescente → sem
 * ordenação; Shift+clique acrescenta como critério secundário. Fica fora do clique do cabeçalho,
 * que seleciona a coluna (seção 7.2).
 */
export function SortButton({ columnName, sortKey, multi, onToggle }: Props) {
  const label = sortKey
    ? `Ordenado ${sortKey.direction === 'asc' ? 'crescente' : 'decrescente'} por ${columnName}`
    : `Ordenar por ${columnName}`;
  const Icon = !sortKey ? ArrowUpDown : sortKey.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className={
        sortKey ? 'dk-grid-headbtn dk-grid-sortbtn is-on' : 'dk-grid-headbtn dk-grid-sortbtn'
      }
      tabIndex={-1}
      aria-label={label}
      title={`${label} (Shift+clique adiciona critério)`}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.shiftKey);
      }}
    >
      <Icon size={11} aria-hidden="true" />
      {sortKey && multi && <span className="dk-grid-sortprio">{sortKey.priority}</span>}
    </button>
  );
}
