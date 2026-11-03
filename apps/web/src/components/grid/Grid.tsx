import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  NATIVE,
  STATE_VALUE,
  classifyValue,
  type CellState,
  type ColumnInference,
  type ColumnType,
  type NativeCode,
  type Table,
} from '@datakit/core';
import { cellTitle, renderCell } from './cellDisplay.tsx';
import { initialColumnWidths, rowNumberWidth } from './columnWidths.ts';
import './Grid.css';

const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 26;

const TYPE_BADGE: Record<ColumnType, string> = {
  text: 'abc',
  number: '123',
  date: 'data',
  boolean: 'bool',
  json: 'json',
  mixed: 'misto',
};

const TYPE_LABEL: Record<ColumnType, string> = {
  text: 'texto',
  number: 'número',
  date: 'data',
  boolean: 'booleano',
  json: 'JSON',
  mixed: 'misto',
};

type Props = {
  table: Table;
  inference: Record<string, ColumnInference>;
};

/** Grade virtualizada nas duas direções, por enquanto só leitura (seção 7.1). */
export function Grid({ table, inference }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const widths = useMemo(() => initialColumnWidths(table), [table]);
  const gutter = rowNumberWidth(table.rowOrder.length);

  // O TanStack Virtual devolve funções que o React Compiler não consegue memorizar; o componente
  // é renderizado normalmente, só sem a otimização automática.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rows = useVirtualizer({
    count: table.rowOrder.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const columns = useVirtualizer({
    horizontal: true,
    count: table.columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => widths[i] ?? 100,
    overscan: 4,
  });

  const totalWidth = gutter + columns.getTotalSize();
  const virtualColumns = columns.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      className="dk-grid"
      role="grid"
      aria-label={`Dados de ${table.name}`}
      aria-rowcount={table.rowOrder.length + 1}
      aria-colcount={table.columns.length}
      tabIndex={0}
    >
      <div
        style={{ width: totalWidth, height: HEADER_HEIGHT + rows.getTotalSize() }}
        className="dk-grid-canvas"
      >
        <div
          className="dk-grid-header"
          role="row"
          aria-rowindex={1}
          style={{ width: totalWidth, height: HEADER_HEIGHT }}
        >
          <div className="dk-grid-corner" style={{ width: gutter }}>
            #
          </div>
          {virtualColumns.map((vc) => {
            const column = table.columns[vc.index];
            if (!column) return null;
            const type = inference[column.id]?.type ?? 'text';
            return (
              <div
                key={column.id}
                role="columnheader"
                aria-colindex={vc.index + 1}
                className="dk-grid-headcell"
                style={{ left: gutter + vc.start, width: vc.size }}
                title={column.path ? `Caminho: ${column.path.join(' › ')}` : column.name}
              >
                <span className="dk-grid-headname">{column.name}</span>
                <span className="dk-grid-badge" title={`Tipo inferido: ${TYPE_LABEL[type]}`}>
                  {TYPE_BADGE[type]}
                </span>
              </div>
            );
          })}
        </div>

        {rows.getVirtualItems().map((vr) => {
          const rowId = table.rowOrder[vr.index];
          if (rowId === undefined) return null;
          return (
            <div
              key={vr.key}
              role="row"
              aria-rowindex={vr.index + 2}
              className="dk-grid-row"
              style={{ top: HEADER_HEIGHT + vr.start, width: totalWidth, height: ROW_HEIGHT }}
            >
              <div className="dk-grid-rownum" role="rowheader" style={{ width: gutter }}>
                {vr.index + 1}
              </div>
              {virtualColumns.map((vc) => {
                const column = table.columns[vc.index];
                const data = column && table.data.get(column.id);
                if (!column || !data) return null;
                const state = (data.state[rowId] ?? STATE_VALUE) as CellState;
                const raw = state === STATE_VALUE ? (data.raw[rowId] ?? '') : '';
                const native = (data.native[rowId] ?? NATIVE.none) as NativeCode;
                const info = inference[column.id];
                const kind = info ? classifyValue(state, raw, native, info).kind : 'text';
                return (
                  <div
                    key={column.id}
                    role="gridcell"
                    aria-colindex={vc.index + 1}
                    className={kind === 'number' ? 'dk-grid-cell is-number' : 'dk-grid-cell'}
                    style={{ left: gutter + vc.start, width: vc.size }}
                    title={cellTitle(state, raw)}
                  >
                    {renderCell(state, raw)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
