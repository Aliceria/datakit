import { useEffect, useState } from 'react';
import {
  formatInteger,
  inspectCell,
  profileColumn,
  TEXT_INFERENCE,
  type CellInspection,
  type ColumnProfile,
} from '@datakit/core';
import { activeTable, useApp } from '../../state/appStore.ts';
import { visibleRows } from '../../state/view.ts';
import { TYPE_LABEL } from '../grid/typeLabels.ts';
import './FileInfo.css';

// Inspetores de coluna e de célula (seção 9), da célula em foco na grade.

const PROFILE_DELAY_MS = 150;

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const percent = (n: number, total: number) =>
  total === 0 ? '0%' : `${number.format(Math.round((n / total) * 1000) / 10)}%`;

function InfoList({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="dk-info">
      {rows.map(([label, value]) => (
        <div key={label} className="dk-info-row">
          <dt>{label}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Coluna e linha da célula em foco, por ID. */
function useFocus() {
  const table = useApp(activeTable);
  const focus = useApp((s) => s.selection?.focus);
  const views = useApp((s) => s.views);
  if (!table || !focus) return undefined;
  const column = table.columns[focus.c];
  const rowId = visibleRows({ views }, table)[focus.r];
  if (!column) return undefined;
  return { table, column, rowId };
}

export function ColumnInspector() {
  const target = useFocus();
  const revision = useApp((s) => s.revision);
  const inference = useApp((s) =>
    target ? s.doc?.inference[target.table.id]?.[target.column.id] : undefined,
  );
  // Calcula fora do caminho da edição: com 100.000 linhas leva dezenas de milissegundos, e
  // a edição tem de aparecer em menos de 50 ms (seção 13). Debounce como as estatísticas.
  // Guarda de qual coluna é o perfil: enquanto o novo não chega, o antigo da mesma coluna fica.
  const [computed, setComputed] = useState<{ key: string; profile: ColumnProfile } | undefined>(
    undefined,
  );
  const table = target?.table;
  const colId = target?.column.id;
  useEffect(() => {
    const data = colId === undefined ? undefined : table?.data.get(colId);
    if (!table || !data || colId === undefined) return;
    const timer = setTimeout(() => {
      setComputed({
        key: `${table.id}:${colId}`,
        profile: profileColumn(data, table.rowOrder, inference ?? TEXT_INFERENCE),
      });
    }, PROFILE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [table, colId, inference, revision]);

  if (!target) return <p className="dk-section-empty">Nenhuma coluna selecionada.</p>;
  const profile =
    computed?.key === `${target.table.id}:${target.column.id}` ? computed.profile : undefined;
  if (!profile) return null;

  const type = inference?.type ?? 'text';
  const rows: Array<[string, string]> = [['Nome', target.column.name]];
  if (target.column.path) rows.push(['Caminho', target.column.path.join(' › ')]);
  rows.push(['Tipo inferido', TYPE_LABEL[type]]);
  const kinds = (Object.entries(profile.counts) as Array<[keyof typeof profile.counts, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${TYPE_LABEL[k]} ${percent(n, profile.nonEmpty)}`);
  if (kinds.length > 0) rows.push(['Tipos', kinds.join(' · ')]);
  rows.push(['Vazios', formatInteger(profile.empty)]);
  if (profile.whitespace > 0) rows.push(['Só espaços', formatInteger(profile.whitespace)]);
  rows.push(['Nulos', formatInteger(profile.nulls)], ['Ausentes', formatInteger(profile.absent)]);
  rows.push(['Valores distintos', formatInteger(profile.distinct)]);
  rows.push(['Inconsistentes', formatInteger(profile.inconsistent)]);
  if (profile.min !== undefined && profile.max !== undefined) {
    rows.push(['Mínimo', profile.min], ['Máximo', profile.max]);
    if (profile.mean !== undefined) rows.push(['Média', number.format(profile.mean)]);
  }
  if (profile.oldest !== undefined && profile.newest !== undefined) {
    rows.push(['Mais antiga', profile.oldest], ['Mais recente', profile.newest]);
  }
  rows.push(['Maior comprimento', formatInteger(profile.maxLength)]);
  return <InfoList rows={rows} />;
}

const STATE_LABEL: Record<CellInspection['state'], string> = {
  value: 'com conteúdo',
  empty: 'vazio',
  whitespace: 'só espaços',
  null: 'nulo',
  absent: 'ausente',
};

const NATIVE_LABEL: Record<string, string> = {
  none: '— (CSV não tem tipos)',
  string: 'texto',
  number: 'número',
  boolean: 'booleano',
  date: 'data',
  error: 'erro do Excel',
  json: 'objeto ou lista JSON',
  text: 'texto (convertido)',
};

/** Espaços, tabulações e quebras de linha visíveis (seção 9). */
function visible(raw: string): string {
  return raw.replaceAll(' ', '·').replaceAll('\t', '→').replaceAll('\r', '␍').replaceAll('\n', '↵');
}

export function CellInspector() {
  const target = useFocus();
  useApp((s) => s.revision);
  const inference = useApp((s) =>
    target ? s.doc?.inference[target.table.id]?.[target.column.id] : undefined,
  );
  if (!target || target.rowId === undefined)
    return <p className="dk-section-empty">Nenhuma célula selecionada.</p>;
  const data = target.table.data.get(target.column.id);
  if (!data) return null;
  const cell = inspectCell(data, target.rowId, inference ?? TEXT_INFERENCE);
  const kind = cell.kind === 'empty' ? '—' : TYPE_LABEL[cell.kind];
  const rows: Array<[string, string]> = [
    ['Valor bruto', cell.state === 'null' || cell.state === 'absent' ? '—' : visible(cell.raw)],
    ['Estado', STATE_LABEL[cell.state]],
    ['Tipo inferido', cell.inconsistent ? `${kind} (inconsistente)` : kind],
    ['Tipo de origem', NATIVE_LABEL[cell.native] ?? cell.native],
    ['Comprimento', formatInteger(cell.length)],
  ];
  if (cell.interpreted) rows.push(['Valor interpretado', cell.interpreted]);
  if (cell.formula) rows.push(['Fórmula', cell.formula]);
  return <InfoList rows={rows} />;
}
