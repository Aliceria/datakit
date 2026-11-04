// Textos do painel: nomes de formatos, ferramentas e classificações em português.

const FORMATS: Record<string, string> = { csv: 'CSV', xlsx: 'XLSX', json: 'JSON', outro: 'Outro' };

export const formatLabel = (f: string | null): string => (f ? (FORMATS[f] ?? f) : '—');

/** "csv→json" → "CSV → JSON" */
export const conversionLabel = (key: string): string =>
  key
    .split('→')
    .map((f) => formatLabel(f))
    .join(' → ');

const TOOLS: Record<string, string> = {
  editCell: 'Editar célula',
  clearCells: 'Limpar células',
  setNull: 'Definir como nulo',
  cut: 'Recortar',
  paste: 'Colar',
  insertRows: 'Inserir linhas',
  deleteRows: 'Excluir linhas',
  insertColumns: 'Inserir colunas',
  deleteColumns: 'Excluir colunas',
  renameColumn: 'Renomear coluna',
  applyOrder: 'Aplicar ordem',
  replace: 'Substituir',
  replaceAll: 'Substituir todas',
  duplicates: 'Remover duplicadas',
  emptyRows: 'Remover linhas vazias',
  convert: 'Converter tipo',
  trim: 'Aparar espaços',
  upper: 'MAIÚSCULAS',
  lower: 'minúsculas',
  title: 'Primeira Letra Maiúscula',
  fill: 'Preencher vazios',
  replaceValue: 'Substituir valor',
  clear: 'Limpar coluna',
  edicao: 'Edição',
  undo: 'Desfazer',
  redo: 'Refazer',
};

export const toolLabel = (key: string | null): string => (key ? (TOOLS[key] ?? key) : '—');

const CLASSES: Record<string, string> = {
  external: 'Externo',
  admin: 'Administrativo',
  dev: 'Desenvolvimento',
};
export const classLabel = (c: string): string => CLASSES[c] ?? c;

const TYPES: Record<string, string> = {
  import: 'Importação',
  edit: 'Edição',
  export: 'Exportação',
};
export const typeLabel = (t: string): string => TYPES[t] ?? t;

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export const dateOf = (iso: string): string => dateFmt.format(new Date(iso));
export const timeOf = (iso: string): string => timeFmt.format(new Date(iso));

/** "2026-11-04" → "04/11" */
export const shortDay = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
/** "2026-11-04" → "04/11/2026" */
export const fullDay = (day: string): string =>
  `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

export const PERIOD_LABELS = {
  '24h': 'Últimas 24 horas',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  all: 'Todo o período',
} as const;
