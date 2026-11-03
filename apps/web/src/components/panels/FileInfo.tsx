import {
  DELIMITER_LABELS,
  ENCODING_LABELS,
  formatBytes,
  formatInteger,
  type FormatId,
} from '@datakit/core';
import { activeTable, useApp } from '../../state/appStore.ts';
import './FileInfo.css';

const FORMAT_LABEL: Record<FormatId, string> = { csv: 'CSV', xlsx: 'XLSX', json: 'JSON' };

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

/** "Informações do arquivo" (seção 9). Reflete a aba ativa. */
export function FileInfo() {
  const doc = useApp((s) => s.doc);
  const table = useApp(activeTable);
  // Estatísticas recalculadas depois das operações (seção 9).
  useApp((s) => s.revision);
  if (!doc || !table) return <p className="dk-section-empty">Nenhum arquivo aberto.</p>;

  const { source } = doc.manifest;
  const stats = doc.stats[table.id];
  const hiddenSheets = doc.tables.filter((t) => t.hidden).length;

  const rows: Array<[string, string]> = [
    ['Nome', source.fileName],
    ['Extensão', source.extension],
    ['Formato', FORMAT_LABEL[source.format]],
    ['Tamanho original', formatBytes(source.sizeBytes)],
  ];
  if (source.encoding && source.format !== 'xlsx')
    rows.push(['Codificação', ENCODING_LABELS[source.encoding]]);
  if (source.delimiter) rows.push(['Delimitador', DELIMITER_LABELS[source.delimiter]]);
  if (source.format === 'xlsx') {
    const sheets = formatInteger(doc.tables.length);
    rows.push([
      'Abas',
      hiddenSheets > 0 ? `${sheets} (${formatInteger(hiddenSheets)} oculta)` : sheets,
    ]);
    if (source.date1904) rows.push(['Sistema de datas', '1904']);
  }
  if (source.jsonRootPath) rows.push(['Array importado', source.jsonRootPath.join('.')]);
  rows.push(['Importado em', dateTime.format(new Date(source.importedAt))]);
  if (stats) {
    rows.push(['Linhas', formatInteger(stats.rows)], ['Colunas', formatInteger(stats.columns)]);
    rows.push(['Células vazias', formatInteger(stats.emptyCells)]);
    if (stats.whitespaceCells > 0) rows.push(['Só espaços', formatInteger(stats.whitespaceCells)]);
    rows.push(['Células nulas', formatInteger(stats.nullCells)]);
    if (source.format === 'json') rows.push(['Células ausentes', formatInteger(stats.absentCells)]);
    rows.push(['Linhas duplicadas', formatInteger(stats.duplicateRows)]);
  }
  rows.push(['Alterações não exportadas', formatInteger(doc.marks.changes)]);

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
