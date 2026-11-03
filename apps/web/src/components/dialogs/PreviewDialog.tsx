import {
  DELIMITERS,
  DELIMITER_LABELS,
  ENCODING_LABELS,
  formatInteger,
  type CsvDelimiter,
  type PreviewTable,
  type TextEncoding,
} from '@datakit/core';
import { appStore, useApp } from '../../state/appStore.ts';
import { cancelPreview, confirmPreview, updatePreviewOptions } from '../../state/importFlow.ts';
import { renderCell } from '../grid/cellDisplay.tsx';
import { Modal } from './Modal.tsx';
import './PreviewDialog.css';

const ENCODINGS: TextEncoding[] = ['utf-8', 'utf-8-bom', 'windows-1252'];

function PreviewGrid({ table }: { table: PreviewTable }) {
  if (table.columns.length === 0) {
    return <p className="dk-preview-empty">Nenhuma coluna encontrada.</p>;
  }
  return (
    <div className="dk-preview-scroll">
      <table className="dk-preview-table">
        <thead>
          <tr>
            <th className="dk-preview-num">#</th>
            {table.columns.map((name, i) => (
              <th key={`${String(i)}-${name}`}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              <td className="dk-preview-num">{r + 1}</td>
              {row.map((cell, c) => (
                <td key={c}>{renderCell(cell.s, cell.r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dk-preview-count">
        {table.totalRows > table.rows.length
          ? `Mostrando as primeiras ${formatInteger(table.rows.length)} linhas.`
          : `${formatInteger(table.totalRows)} linhas.`}
      </p>
    </div>
  );
}

/** Pré-visualização com as opções a confirmar (seção 6.1). Enter confirma. */
export function PreviewDialog() {
  const preview = useApp((s) => s.preview);
  if (!preview) return null;

  const confirm = () => {
    void confirmPreview();
  };
  const footer = (
    <>
      <button type="button" className="dk-button" onClick={cancelPreview}>
        Cancelar
      </button>
      <button
        type="button"
        className="dk-button is-primary"
        onClick={confirm}
        disabled={preview.kind === 'client' && (preview.loading || preview.error !== undefined)}
        data-autofocus
      >
        Abrir
      </button>
    </>
  );

  if (preview.kind === 'xlsx') {
    const tables = preview.hasHeader ? preview.tables.withHeader : preview.tables.withoutHeader;
    const current = tables[preview.sheetIndex] ?? tables[0];
    return (
      <Modal
        title={`Abrir ${preview.file.name}`}
        onClose={cancelPreview}
        onEnter={confirm}
        footer={footer}
        wide
      >
        <div className="dk-form-row">
          <span className="dk-form-label">Cabeçalho</span>
          <label className="dk-checkbox">
            <input
              type="checkbox"
              checked={preview.hasHeader}
              onChange={(e) => {
                appStore.set({ preview: { ...preview, hasHeader: e.target.checked } });
              }}
            />
            Primeira linha é o cabeçalho (em todas as abas)
          </label>
        </div>
        <div className="dk-preview-sheets" role="tablist" aria-label="Abas da planilha">
          {tables.map((t, i) => (
            <button
              key={t.name}
              type="button"
              role="tab"
              aria-selected={i === preview.sheetIndex}
              className="dk-preview-sheet"
              onClick={() => {
                appStore.set({ preview: { ...preview, sheetIndex: i } });
              }}
            >
              {t.name}
              {t.hidden ? ' (oculta)' : ''}
            </button>
          ))}
        </div>
        {current && <PreviewGrid table={current} />}
      </Modal>
    );
  }

  const { options } = preview;
  const jsonCandidates = preview.json?.candidates ?? [];
  return (
    <Modal
      title={`Abrir ${preview.file.name}`}
      onClose={cancelPreview}
      onEnter={confirm}
      footer={footer}
      wide
    >
      {preview.format === 'csv' && (
        <>
          <div className="dk-form-row">
            <label htmlFor="dk-preview-encoding">Codificação</label>
            <select
              id="dk-preview-encoding"
              className="dk-field"
              value={options.encoding ?? 'utf-8'}
              onChange={(e) =>
                void updatePreviewOptions({ encoding: e.target.value as TextEncoding })
              }
            >
              {ENCODINGS.map((enc) => (
                <option key={enc} value={enc}>
                  {ENCODING_LABELS[enc]}
                  {preview.detected?.encoding === enc ? ' — detectada' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="dk-form-row">
            <label htmlFor="dk-preview-delimiter">Delimitador</label>
            <select
              id="dk-preview-delimiter"
              className="dk-field"
              value={options.delimiter ?? ','}
              onChange={(e) =>
                void updatePreviewOptions({ delimiter: e.target.value as CsvDelimiter })
              }
            >
              {DELIMITERS.map((d) => (
                <option key={d} value={d}>
                  {DELIMITER_LABELS[d]}
                  {preview.detected?.delimiter === d ? ' — detectado' : ''}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      {jsonCandidates.length > 0 && (
        <div className="dk-form-row">
          <label htmlFor="dk-preview-root">Array a importar</label>
          <select
            id="dk-preview-root"
            className="dk-field"
            value={JSON.stringify(options.jsonRootPath ?? jsonCandidates[0])}
            onChange={(e) =>
              void updatePreviewOptions({ jsonRootPath: JSON.parse(e.target.value) as string[] })
            }
          >
            {jsonCandidates.map((path) => (
              <option key={JSON.stringify(path)} value={JSON.stringify(path)}>
                {path.join('.')}
              </option>
            ))}
          </select>
        </div>
      )}
      {(preview.format === 'csv' || preview.json?.kind === 'arrays') &&
        !preview.json?.candidates.length && (
          <div className="dk-form-row">
            <span className="dk-form-label">Cabeçalho</span>
            <label className="dk-checkbox">
              <input
                type="checkbox"
                checked={options.hasHeader ?? true}
                onChange={(e) => void updatePreviewOptions({ hasHeader: e.target.checked })}
              />
              Primeira linha é o cabeçalho
            </label>
          </div>
        )}
      {preview.error ? (
        <p className="dk-message-single dk-tone-error">{preview.error}</p>
      ) : preview.table ? (
        <div aria-busy={preview.loading}>
          <PreviewGrid table={preview.table} />
        </div>
      ) : null}
    </Modal>
  );
}
