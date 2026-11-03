import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Filter } from 'lucide-react';
import {
  NATIVE,
  STATE_VALUE,
  cellKey,
  classifyValue,
  type CellState,
  type ColumnInference,
  type NativeCode,
  type Table,
  type TableMarks,
} from '@datakit/core';
import { rememberScroll, rememberWidth, tableView } from '../../session/viewState.ts';
import { appStore, useApp, type Selection } from '../../state/appStore.ts';
import {
  clearSelection,
  commitCellEdit,
  copyFromMenu,
  copySelection,
  cutSelection,
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  pasteFromMenu,
  pasteText,
  renameColumn,
  setSelectionNull,
} from '../../state/commands.ts';
import {
  normalized,
  selectCell,
  selectColumns,
  selectRows,
  setSelection,
} from '../../state/selection.ts';
import { setColumnFilter, setSort, toggleSort } from '../../state/view.ts';
import { ContextMenu, type MenuItem } from '../common/ContextMenu.tsx';
import { FilterDialog } from '../dialogs/FilterDialog.tsx';
import { SortButton } from './SortButton.tsx';
import { Modal } from '../dialogs/Modal.tsx';
import { CellEditor, type EditorMove } from './CellEditor.tsx';
import { cellTitle, renderCell } from './cellDisplay.tsx';
import { initialColumnWidths, rowNumberWidth } from './columnWidths.ts';
import { TYPE_BADGE, TYPE_LABEL } from './typeLabels.ts';
import './Grid.css';

const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 26;
const MIN_WIDTH = 40;
const MAX_WIDTH = 800;
const CHAR_WIDTH = 7.8;

type Props = {
  table: Table;
  inference: Record<string, ColumnInference>;
  marks: TableMarks | undefined;
  readOnly: boolean;
};

type MenuState = { x: number; y: number; kind: 'cell' | 'column' | 'row' };

const isPrintable = (e: React.KeyboardEvent) =>
  e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

/** Grade virtualizada e editável (seções 7.1 a 7.3). */
export function Grid({ table, inference, marks, readOnly }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selection = useApp((s) => s.selection);
  const editing = useApp((s) => s.editing);
  useApp((s) => s.revision);
  const view = useApp((s) => s.views[table.id]);
  // Valores que não puderam ser convertidos (seção 8) ficam destacados.
  const flagged = useApp((s) => (s.flagged?.tableId === table.id ? s.flagged.cells : undefined));
  // Linhas visíveis, na ordem mostrada (filtros e ordenação só mudam a vista).
  const viewRows = view?.rowIds ?? table.rowOrder;
  const dataPosition = useMemo(
    () => new Map(table.rowOrder.map((id, i) => [id, i])),
    [table.rowOrder],
  );
  const [filtering, setFiltering] = useState<number | undefined>();
  const [menu, setMenu] = useState<MenuState | undefined>();
  const [renaming, setRenaming] = useState<number | undefined>();
  const dragging = useRef(false);

  // --- Larguras de coluna (seção 7.1): padrão pela amostra, ajustes guardados no estado de visualização.
  const defaults = useMemo(() => initialColumnWidths(table), [table]);
  const [widths, setWidths] = useState<Record<string, number>>(() => ({
    ...tableView(table.id)?.widths,
  }));
  const widthOf = useCallback(
    (i: number) => {
      const column = table.columns[i];
      return (column && widths[column.id]) ?? defaults[i] ?? 100;
    },
    [table.columns, widths, defaults],
  );
  const gutter = rowNumberWidth(table.rowOrder.length);

  // O TanStack Virtual devolve funções que o React Compiler não consegue memorizar; o componente
  // é renderizado normalmente, só sem a otimização automática.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rows = useVirtualizer({
    count: viewRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    paddingStart: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
    overscan: 12,
  });
  const columns = useVirtualizer({
    horizontal: true,
    count: table.columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: widthOf,
    paddingStart: gutter,
    scrollPaddingStart: gutter,
    overscan: 4,
  });

  useEffect(() => {
    columns.measure();
  }, [columns, widths, table.columns.length, defaults]);

  // Restaura a rolagem uma vez, ao montar (F5, troca de aba da planilha).
  const restored = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const view = tableView(table.id);
    if (restored.current || !el) return;
    restored.current = true;
    if (view) {
      el.scrollTop = view.top;
      el.scrollLeft = view.left;
    }
  }, [table.id]);

  // Mantém a célula em foco visível quando ela muda pelo teclado.
  const focusR = selection?.focus.r;
  const focusC = selection?.focus.c;
  useEffect(() => {
    if (focusR === undefined || focusC === undefined || dragging.current) return;
    rows.scrollToIndex(focusR, { align: 'auto' });
    columns.scrollToIndex(focusC, { align: 'auto' });
  }, [focusR, focusC, rows, columns]);

  const range = selection ? normalized(selection, table) : undefined;
  const filteredCols = new Set(view?.spec.filters.map((f) => f.colId) ?? []);
  const sortOf = (colId: string) => {
    const keys = view?.spec.sort ?? [];
    const index = keys.findIndex((k) => k.colId === colId);
    const key = keys[index];
    return key ? { direction: key.direction, priority: index + 1 } : undefined;
  };
  const inRange = (r: number, c: number) =>
    range !== undefined && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;

  const focusGrid = () => {
    scrollRef.current?.focus({ preventScroll: true });
  };

  // --- Edição ---------------------------------------------------------------------------------

  const startEditing = (r: number, c: number, replaceWith?: string) => {
    if (readOnly) return;
    const rowId = viewRows[r];
    const column = table.columns[c];
    const data = column && table.data.get(column.id);
    if (rowId === undefined || !data) return;
    const raw = data.state[rowId] === STATE_VALUE ? (data.raw[rowId] ?? '') : '';
    appStore.set({
      editing: { r, c, initial: replaceWith ?? raw, replace: replaceWith !== undefined },
    });
  };

  const stopEditing = (commit: { text: string; move: EditorMove } | undefined) => {
    const current = appStore.get().editing;
    appStore.set({ editing: undefined });
    if (current && commit) {
      commitCellEdit(current.r, current.c, commit.text);
      const delta: Record<EditorMove, [number, number]> = {
        down: [1, 0],
        up: [-1, 0],
        right: [0, 1],
        left: [0, -1],
        none: [0, 0],
      };
      const [dr, dc] = delta[commit.move];
      if (dr !== 0 || dc !== 0) moveFocus(current.r + dr, current.c + dc, false);
    }
    focusGrid();
  };

  // --- Navegação ------------------------------------------------------------------------------

  const lastRow = viewRows.length - 1;
  const lastCol = table.columns.length - 1;

  const moveFocus = (r: number, c: number, extend: boolean) => {
    const nr = Math.max(0, Math.min(r, lastRow));
    const nc = Math.max(0, Math.min(c, lastCol));
    const current = appStore.get().selection;
    if (extend && current) {
      setSelection({
        mode: 'cells',
        anchor:
          current.mode === 'cells' ? current.anchor : { r: current.anchor.r, c: current.anchor.c },
        focus: { r: nr, c: nc },
      });
    } else {
      selectCell(nr, nc);
    }
  };

  const pageRows = () =>
    Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_HEIGHT) - 2);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || appStore.get().editing) return;
    if (viewRows.length === 0 || table.columns.length === 0) return;
    const sel = appStore.get().selection ?? {
      mode: 'cells' as const,
      anchor: { r: 0, c: 0 },
      focus: { r: 0, c: 0 },
    };
    const { r, c } = sel.focus;
    const ctrl = e.ctrlKey || e.metaKey;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    switch (e.key) {
      case 'ArrowDown':
        handled();
        moveFocus(ctrl ? lastRow : r + 1, c, e.shiftKey);
        return;
      case 'ArrowUp':
        handled();
        moveFocus(ctrl ? 0 : r - 1, c, e.shiftKey);
        return;
      case 'ArrowRight':
        handled();
        moveFocus(r, ctrl ? lastCol : c + 1, e.shiftKey);
        return;
      case 'ArrowLeft':
        handled();
        moveFocus(r, ctrl ? 0 : c - 1, e.shiftKey);
        return;
      case 'Tab':
        handled();
        moveFocus(r, e.shiftKey ? c - 1 : c + 1, false);
        return;
      case 'Home':
        handled();
        moveFocus(ctrl ? 0 : r, 0, e.shiftKey);
        return;
      case 'End':
        handled();
        moveFocus(ctrl ? lastRow : r, lastCol, e.shiftKey);
        return;
      case 'PageDown':
        handled();
        moveFocus(r + pageRows(), c, e.shiftKey);
        return;
      case 'PageUp':
        handled();
        moveFocus(r - pageRows(), c, e.shiftKey);
        return;
      case 'Enter':
      case 'F2':
        handled();
        if (!appStore.get().selection) selectCell(r, c);
        startEditing(r, c);
        return;
      case 'Delete':
        handled();
        if (!readOnly) clearSelection();
        return;
      case 'Backspace':
        handled();
        startEditing(r, c, '');
        return;
      case 'ContextMenu':
        handled();
        openMenuAtFocus('cell');
        return;
      default:
        break;
    }
    if (e.key === 'F10' && e.shiftKey) {
      handled();
      openMenuAtFocus('cell');
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'a') {
      handled();
      setSelection({ mode: 'cells', anchor: { r: 0, c: 0 }, focus: { r: lastRow, c: lastCol } });
      return;
    }
    // Digitar começa a editar substituindo o valor (seção 7.2).
    if (isPrintable(e) && !e.nativeEvent.isComposing) {
      handled();
      if (!appStore.get().selection) selectCell(r, c);
      startEditing(r, c, e.key);
    }
  };

  // --- Menus ----------------------------------------------------------------------------------

  const cellRect = (r: number, c: number) => {
    let left = gutter;
    for (let i = 0; i < c; i += 1) left += widthOf(i);
    return { left, top: HEADER_HEIGHT + r * ROW_HEIGHT, width: widthOf(c), height: ROW_HEIGHT };
  };

  const openMenuAtFocus = (kind: MenuState['kind']) => {
    const sel = appStore.get().selection;
    const el = scrollRef.current;
    if (!sel || !el) return;
    const rect = cellRect(sel.focus.r, sel.focus.c);
    const box = el.getBoundingClientRect();
    setMenu({
      x: box.left + rect.left - el.scrollLeft + 8,
      y: box.top + rect.top - el.scrollTop + ROW_HEIGHT,
      kind,
    });
  };

  /** Filtro e ordenação no menu da coluna (seção 7.4). */
  const columnViewItems = (c: number, nCols: number): MenuItem[] => {
    const colId = table.columns[c]?.id;
    if (!colId || nCols > 1) return [];
    const items: MenuItem[] = [
      {
        kind: 'item',
        label: 'Filtrar…',
        onSelect: () => {
          setFiltering(c);
        },
      },
    ];
    if (filteredCols.has(colId)) {
      items.push({
        kind: 'item',
        label: 'Remover filtro',
        onSelect: () => {
          setColumnFilter(table.id, colId, undefined);
        },
      });
    }
    items.push(
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Ordenar crescente',
        onSelect: () => {
          setSort(table.id, colId, 'asc');
        },
      },
      {
        kind: 'item',
        label: 'Ordenar decrescente',
        onSelect: () => {
          setSort(table.id, colId, 'desc');
        },
      },
    );
    if (sortOf(colId)) {
      items.push({
        kind: 'item',
        label: 'Remover ordenação',
        onSelect: () => {
          setSort(table.id, colId, undefined);
        },
      });
    }
    return items;
  };

  const menuItems = (kind: MenuState['kind']): MenuItem[] => {
    const many = (n: number, one: string, more: string) => (n > 1 ? more : one);
    const r = range ?? { r1: 0, r2: 0, c1: 0, c2: 0 };
    const nRows = r.r2 - r.r1 + 1;
    const nCols = r.c2 - r.c1 + 1;
    const ro = readOnly;
    const rowItems: MenuItem[] = [
      {
        kind: 'item',
        label: 'Inserir linha acima',
        onSelect: () => {
          insertRows('above');
        },
        disabled: ro,
      },
      {
        kind: 'item',
        label: 'Inserir linha abaixo',
        onSelect: () => {
          insertRows('below');
        },
        disabled: ro,
      },
      {
        kind: 'item',
        label: many(nRows, 'Excluir linha', `Excluir ${String(nRows)} linhas`),
        onSelect: deleteRows,
        disabled: ro,
      },
    ];
    const colItems: MenuItem[] = [
      {
        kind: 'item',
        label: 'Inserir coluna à esquerda',
        onSelect: () => {
          insertColumns('left');
        },
        disabled: ro,
      },
      {
        kind: 'item',
        label: 'Inserir coluna à direita',
        onSelect: () => {
          insertColumns('right');
        },
        disabled: ro,
      },
      {
        kind: 'item',
        label: many(nCols, 'Excluir coluna', `Excluir ${String(nCols)} colunas`),
        onSelect: deleteColumns,
        disabled: ro || nCols >= table.columns.length,
      },
    ];
    const cellItems: MenuItem[] = [
      { kind: 'item', label: 'Copiar', shortcut: 'Ctrl+C', onSelect: () => void copyFromMenu() },
      {
        kind: 'item',
        label: 'Recortar',
        shortcut: 'Ctrl+X',
        onSelect: () => void copyFromMenu(true),
        disabled: ro,
      },
      {
        kind: 'item',
        label: 'Colar',
        shortcut: 'Ctrl+V',
        onSelect: () => void pasteFromMenu(),
        disabled: ro,
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Limpar (texto vazio)',
        shortcut: 'Delete',
        onSelect: clearSelection,
        disabled: ro,
      },
      { kind: 'item', label: 'Definir como nulo', onSelect: setSelectionNull, disabled: ro },
    ];
    if (kind === 'column') {
      return [
        ...columnViewItems(r.c1, nCols),
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Renomear…',
          onSelect: () => {
            setRenaming(r.c1);
          },
          disabled: ro || nCols > 1,
        },
        { kind: 'separator' },
        ...colItems,
        { kind: 'separator' },
        ...cellItems,
      ];
    }
    if (kind === 'row') return [...rowItems, { kind: 'separator' }, ...cellItems];
    return [...cellItems, { kind: 'separator' }, ...rowItems, { kind: 'separator' }, ...colItems];
  };

  // --- Mouse ----------------------------------------------------------------------------------

  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mouseup', up);
    };
  }, []);

  const onCellMouseDown = (e: React.MouseEvent, r: number, c: number) => {
    if (e.button === 2) {
      if (!inRange(r, c)) selectCell(r, c);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (appStore.get().editing) stopEditingFromOutside();
    selectCell(r, c, e.shiftKey);
    dragging.current = true;
    focusGrid();
  };

  /** Clique fora do editor: o blur dele já confirma; aqui só garante o foco de volta. */
  const stopEditingFromOutside = () => {
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const onCellMouseEnter = (r: number, c: number) => {
    if (!dragging.current) return;
    const current = appStore.get().selection;
    if (current?.mode === 'cells') setSelection({ ...current, focus: { r, c } });
  };

  // --- Redimensionar colunas -------------------------------------------------------------------

  const startResize = (e: React.MouseEvent, c: number) => {
    e.preventDefault();
    e.stopPropagation();
    const column = table.columns[c];
    if (!column) return;
    const startX = e.clientX;
    const startWidth = widthOf(c);
    let latest = startWidth;
    const move = (ev: MouseEvent) => {
      latest = Math.round(
        Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + ev.clientX - startX)),
      );
      setWidths((w) => ({ ...w, [column.id]: latest }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      rememberWidth(table.id, column.id, latest);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** Duplo clique na borda: ajusta a largura ao conteúdo (amostra de até 2.000 linhas). */
  const autoFit = (c: number) => {
    const column = table.columns[c];
    const data = column && table.data.get(column.id);
    if (!column || !data) return;
    // Nome + indicador de tipo e seta de ordenação.
    let longest = column.name.length + 9;
    for (const rowId of table.rowOrder.slice(0, 2000)) {
      const raw = data.raw[rowId];
      if (raw && raw.length > longest) longest = raw.length;
    }
    const width = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, longest * CHAR_WIDTH + 18)));
    setWidths((w) => ({ ...w, [column.id]: width }));
    rememberWidth(table.id, column.id, width);
  };

  // --- Render ---------------------------------------------------------------------------------

  const totalWidth = columns.getTotalSize();
  const virtualColumns = columns.getVirtualItems();
  const editorRect = editing ? cellRect(editing.r, editing.c) : undefined;

  return (
    <>
      <div
        ref={scrollRef}
        className="dk-grid"
        role="grid"
        aria-label={`Dados de ${table.name}`}
        aria-rowcount={viewRows.length + 1}
        aria-colcount={table.columns.length}
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          rememberScroll(table.id, e.currentTarget.scrollTop, e.currentTarget.scrollLeft);
        }}
        onCopy={(e) => {
          if (appStore.get().editing) return;
          const text = copySelection();
          if (text === undefined) return;
          e.preventDefault();
          e.clipboardData.setData('text/plain', text);
        }}
        onCut={(e) => {
          if (appStore.get().editing || readOnly) return;
          const text = cutSelection();
          if (text === undefined) return;
          e.preventDefault();
          e.clipboardData.setData('text/plain', text);
        }}
        onPaste={(e) => {
          if (appStore.get().editing || readOnly) return;
          e.preventDefault();
          pasteText(e.clipboardData.getData('text/plain'));
        }}
      >
        <div style={{ width: totalWidth, height: rows.getTotalSize() }} className="dk-grid-canvas">
          <div
            className="dk-grid-header"
            role="row"
            aria-rowindex={1}
            style={{ width: totalWidth, height: HEADER_HEIGHT }}
          >
            <button
              type="button"
              className="dk-grid-corner"
              style={{ width: gutter }}
              tabIndex={-1}
              aria-label="Selecionar tudo"
              onClick={() => {
                if (lastRow >= 0 && lastCol >= 0) {
                  setSelection({
                    mode: 'cells',
                    anchor: { r: 0, c: 0 },
                    focus: { r: lastRow, c: lastCol },
                  });
                }
                focusGrid();
              }}
            >
              #
            </button>
            {virtualColumns.map((vc) => {
              const column = table.columns[vc.index];
              if (!column) return null;
              const type = inference[column.id]?.type ?? 'text';
              const selected = range !== undefined && vc.index >= range.c1 && vc.index <= range.c2;
              const edited = marks?.cols.has(column.id) ?? false;
              return (
                <div
                  key={column.id}
                  role="columnheader"
                  aria-colindex={vc.index + 1}
                  aria-selected={selected}
                  className={`dk-grid-headcell${selected ? ' is-selected' : ''}${edited ? ' is-edited' : ''}`}
                  style={{ left: vc.start, width: vc.size }}
                  title={column.path ? `Caminho: ${column.path.join(' › ')}` : column.name}
                  onMouseDown={(e) => {
                    if (e.button === 2) {
                      if (!selected || selection?.mode !== 'columns') selectColumns(vc.index);
                      return;
                    }
                    if (e.button !== 0) return;
                    e.preventDefault();
                    selectColumns(vc.index, e.shiftKey);
                    focusGrid();
                  }}
                  onDoubleClick={() => {
                    if (!readOnly) setRenaming(vc.index);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    // Clique direito na seta ou no funil não passa pelo mousedown do cabeçalho:
                    // o menu tem de valer para esta coluna, e não para a selecionada antes.
                    if (!selected || selection?.mode !== 'columns') selectColumns(vc.index);
                    setMenu({ x: e.clientX, y: e.clientY, kind: 'column' });
                  }}
                >
                  <span className="dk-grid-headname">{column.name}</span>
                  {filteredCols.has(column.id) && (
                    <button
                      type="button"
                      className="dk-grid-headbtn is-on"
                      tabIndex={-1}
                      aria-label={`Filtro em ${column.name}`}
                      title="Filtro ativo — clique para editar"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        setFiltering(vc.index);
                      }}
                    >
                      <Filter size={11} aria-hidden="true" />
                    </button>
                  )}
                  <SortButton
                    columnName={column.name}
                    sortKey={sortOf(column.id)}
                    multi={(view?.spec.sort.length ?? 0) > 1}
                    onToggle={(additive) => {
                      toggleSort(table.id, column.id, additive);
                    }}
                  />
                  <span className="dk-grid-badge" title={`Tipo inferido: ${TYPE_LABEL[type]}`}>
                    {TYPE_BADGE[type]}
                  </span>
                  <span
                    className="dk-col-resizer"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Largura da coluna ${column.name}`}
                    onMouseDown={(e) => {
                      startResize(e, vc.index);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      autoFit(vc.index);
                    }}
                  />
                </div>
              );
            })}
          </div>

          {rows.getVirtualItems().map((vr) => {
            const rowId = viewRows[vr.index];
            if (rowId === undefined) return null;
            const rowSelected = range !== undefined && vr.index >= range.r1 && vr.index <= range.r2;
            const rowEdited = marks?.rows.has(rowId) ?? false;
            return (
              <div
                key={vr.key}
                role="row"
                aria-rowindex={vr.index + 2}
                className="dk-grid-row"
                style={{ top: vr.start, width: totalWidth, height: ROW_HEIGHT }}
              >
                <div
                  className={`dk-grid-rownum${rowSelected ? ' is-selected' : ''}${rowEdited ? ' is-edited' : ''}`}
                  role="rowheader"
                  style={{ width: gutter }}
                  onMouseDown={(e) => {
                    if (e.button === 2) {
                      if (!rowSelected || selection?.mode !== 'rows') selectRows(vr.index);
                      return;
                    }
                    if (e.button !== 0) return;
                    e.preventDefault();
                    selectRows(vr.index, e.shiftKey);
                    focusGrid();
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, kind: 'row' });
                  }}
                >
                  {/* Com filtro ou ordenação, mostra a posição original da linha nos dados. */}
                  {(view ? (dataPosition.get(rowId) ?? vr.index) : vr.index) + 1}
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
                  const selected = inRange(vr.index, vc.index);
                  const isFocus = selection?.focus.r === vr.index && selection.focus.c === vc.index;
                  const edited = marks?.cells.has(cellKey(rowId, column.id)) ?? false;
                  let className = 'dk-grid-cell';
                  if (kind === 'number') className += ' is-number';
                  if (selected) className += ' is-selected';
                  if (isFocus) className += ' is-focus';
                  if (edited) className += ' is-edited';
                  if (flagged?.has(`${String(rowId)}:${column.id}`)) className += ' is-flagged';
                  return (
                    <div
                      key={column.id}
                      role="gridcell"
                      aria-colindex={vc.index + 1}
                      aria-selected={selected}
                      className={className}
                      style={{ left: vc.start, width: vc.size }}
                      title={cellTitle(state, raw)}
                      onMouseDown={(e) => {
                        onCellMouseDown(e, vr.index, vc.index);
                      }}
                      onMouseEnter={() => {
                        onCellMouseEnter(vr.index, vc.index);
                      }}
                      onDoubleClick={() => {
                        startEditing(vr.index, vc.index);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, kind: 'cell' });
                      }}
                    >
                      {renderCell(state, raw)}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {editing && editorRect && (
            <CellEditor
              key={`${String(editing.r)}:${String(editing.c)}`}
              left={editorRect.left}
              top={editorRect.top}
              width={editorRect.width}
              height={editorRect.height}
              initial={editing.initial}
              replace={editing.replace}
              onCommit={(text, move) => {
                stopEditing({ text, move });
              }}
              onCancel={() => {
                stopEditing(undefined);
              }}
            />
          )}
        </div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={
            menu.kind === 'column'
              ? 'Ações da coluna'
              : menu.kind === 'row'
                ? 'Ações da linha'
                : 'Ações da célula'
          }
          items={menuItems(menu.kind)}
          onClose={() => {
            setMenu(undefined);
            focusGrid();
          }}
        />
      )}

      {filtering !== undefined && table.columns[filtering] && (
        <FilterDialog
          table={table}
          colId={table.columns[filtering].id}
          onClose={() => {
            setFiltering(undefined);
            focusGrid();
          }}
        />
      )}

      {renaming !== undefined && (
        <RenameDialog
          table={table}
          c={renaming}
          onClose={() => {
            setRenaming(undefined);
            focusGrid();
          }}
        />
      )}
    </>
  );
}

/** Renomear coluna (seção 7.3). Em JSON aninhado, edita só a última chave do caminho (L22). */
function RenameDialog({ table, c, onClose }: { table: Table; c: number; onClose: () => void }) {
  const column = table.columns[c];
  const prefix =
    column?.path && column.path.length > 1 ? `${column.path.slice(0, -1).join('.')}.` : '';
  const [value, setValue] = useState(
    column?.path ? (column.path.at(-1) ?? '') : (column?.name ?? ''),
  );
  if (!column) return null;
  const confirm = () => {
    if (renameColumn(c, value)) onClose();
  };
  return (
    <Modal
      title="Renomear coluna"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="dk-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="dk-button is-primary" onClick={confirm}>
            Renomear
          </button>
        </>
      }
    >
      <div className="dk-form-row">
        <label htmlFor="dk-rename-input">Nome</label>
        <div className="dk-rename-field">
          {prefix && <span className="dk-rename-prefix">{prefix}</span>}
          <input
            id="dk-rename-input"
            className="dk-field"
            value={value}
            data-autofocus
            onChange={(e) => {
              setValue(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirm();
              }
            }}
          />
        </div>
      </div>
    </Modal>
  );
}

export type { Selection };
