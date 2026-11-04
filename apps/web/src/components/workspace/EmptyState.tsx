import { LIMITS, SESSION_TIMING, formatBytes, formatInteger } from '@datakit/core';
import './EmptyState.css';

const HOUR_MS = 3_600_000;

type Props = { onOpen: () => void };

/** Tela inicial sem arquivo: convite para abrir, formatos, limites e aviso temporário (seções 11.3 e 12). */
/** Formatos e limites aceitos (também na Ajuda). */
export const LIMIT_ROWS: Array<[string, string]> = [
  ['Formatos', 'CSV, XLSX, JSON'],
  ['Tamanho máximo', formatBytes(LIMITS.maxFileBytes)],
  ['Linhas por tabela', formatInteger(LIMITS.maxRowsPerTable)],
  ['Colunas por tabela', formatInteger(LIMITS.maxColumnsPerTable)],
  ['Células por arquivo', formatInteger(LIMITS.maxCellsPerFile)],
];

/** Aviso de armazenamento temporário (seção 12): na tela inicial e na Ajuda. */
export const STORAGE_NOTICE = `Os arquivos ficam no servidor só temporariamente. Eles são apagados quando você fecha a aba ou quando a sessão expira (${String(SESSION_TIMING.inactivityMs / HOUR_MS)} h sem uso ou ${String(SESSION_TIMING.maxDurationMs / HOUR_MS)} h no total).`;

export function EmptyState({ onOpen }: Props) {
  const limits = LIMIT_ROWS;

  return (
    <div className="dk-empty">
      <div className="dk-empty-box">
        <p className="dk-empty-title">
          Arraste um arquivo aqui ou clique em{' '}
          <button type="button" className="dk-empty-open" onClick={onOpen}>
            Abrir
          </button>
        </p>
        <dl className="dk-empty-limits">
          {limits.map(([label, value]) => (
            <div key={label} className="dk-empty-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="dk-empty-notice">{STORAGE_NOTICE}</p>
      </div>
    </div>
  );
}
