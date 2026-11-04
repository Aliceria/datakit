import { useMemo, useState } from 'react';
import {
  defaultExportName,
  exportWarnings,
  type CsvDelimiter,
  type ExportFormat,
  type ExportOptions,
  type ExportRequest,
} from '@datakit/core';
import { activeTable, useApp } from '../../state/appStore.ts';
import { closeExport, runExport } from '../../state/exportFlow.ts';
import { isActiveSpec, visibleRows } from '../../state/view.ts';
import { Modal } from './Modal.tsx';

// Diálogo "Exportar" (seção 10, Ctrl+S): formato, nome, escopo, opções e avisos de perda.

const FORMAT_LABELS: Record<ExportFormat, string> = { csv: 'CSV', xlsx: 'XLSX', json: 'JSON' };

const DELIMITERS: Array<[CsvDelimiter, string]> = [
  [',', 'Vírgula (,)'],
  [';', 'Ponto e vírgula (;)'],
  ['\t', 'Tabulação'],
  ['|', 'Barra vertical (|)'],
];

type Preset = 'standard' | 'excelBr' | 'custom';

export function ExportDialog() {
  const open = useApp((s) => s.exportOpen);
  const doc = useApp((s) => s.doc);
  const table = useApp(activeTable);
  if (!open || !doc || !table) return null;
  return <ExportForm key={table.id} />;
}

function ExportForm() {
  const doc = useApp((s) => s.doc);
  const table = useApp(activeTable);
  const views = useApp((s) => s.views);
  const revision = useApp((s) => s.revision);
  const source = doc?.manifest.source;
  const tables = useMemo(() => doc?.tables ?? [], [doc]);
  const many = tables.length > 1;
  const nestedSource = table?.columns.some((c) => (c.path?.length ?? 0) > 1) ?? false;

  const [format, setFormat] = useState<ExportFormat>(source?.format ?? 'csv');
  const [preset, setPreset] = useState<Preset>('standard');
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',');
  const [bom, setBom] = useState(false);
  // JSON não tem linha de cabeçalho: os nomes das colunas vêm das chaves, e vão para o cabeçalho.
  const [header, setHeader] = useState(
    source?.format === 'json' ? true : (source?.hasHeader ?? true),
  );
  const [formulaGuard, setFormulaGuard] = useState(true);
  const [allSheets, setAllSheets] = useState(true);
  const [nativeTypes, setNativeTypes] = useState(true);
  const [shape, setShape] = useState<'objects' | 'arrays'>('objects');
  const [nested, setNested] = useState(nestedSource);
  const [indent, setIndent] = useState(true);
  const [visibleOnly, setVisibleOnly] = useState(false);
  const [nameEdited, setNameEdited] = useState<string | undefined>(undefined);

  const viewActive = table ? isActiveSpec(views[table.id]?.spec) : false;
  const sheetsAll = format === 'xlsx' && many && allSheets && !visibleOnly;
  const defaultName = defaultExportName(
    source?.fileName ?? 'dados',
    format,
    many && !sheetsAll ? table?.name : undefined,
  );
  const fileName = nameEdited ?? defaultName;

  const request = useMemo((): ExportRequest | undefined => {
    if (!table) return undefined;
    const options: ExportOptions =
      format === 'csv'
        ? { format, delimiter, header, bom, formulaGuard }
        : format === 'xlsx'
          ? { format, allSheets: sheetsAll, header, nativeTypes }
          : { format, shape, nested: shape === 'objects' && nested, indent };
    return {
      tableIds: sheetsAll ? tables.map((t) => t.id) : [table.id],
      options,
      // O nome entra só na hora de exportar: digitar não recalcula os avisos.
      fileName: '',
      ...(visibleOnly ? { rowIds: [...visibleRows({ views }, table)] } : {}),
    };
  }, [
    table,
    tables,
    views,
    format,
    delimiter,
    header,
    bom,
    formulaGuard,
    sheetsAll,
    nativeTypes,
    shape,
    nested,
    indent,
    visibleOnly,
  ]);
  // Avisos de perda (seção 10.2), recalculados quando as opções ou os dados mudam.
  const warnings = useMemo(
    () => (request && revision >= 0 ? exportWarnings(tables, request) : []),
    [request, tables, revision],
  );
  if (!table || !request) return null;

  const conflict = warnings.some((w) => w.code === 'NESTING_CONFLICT');
  const blocked = conflict || fileName.trim() === '';
  const submit = () => {
    if (!blocked) void runExport({ ...request, fileName: fileName.trim() });
  };
  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p === 'standard') {
      setDelimiter(',');
      setBom(false);
    } else if (p === 'excelBr') {
      setDelimiter(';');
      setBom(true);
    }
  };

  return (
    <Modal
      title="Exportar"
      onClose={closeExport}
      onEnter={submit}
      footer={
        <>
          <button type="button" className="dk-button" onClick={closeExport}>
            Cancelar
          </button>
          <button
            type="button"
            className="dk-button is-primary"
            disabled={blocked}
            onClick={submit}
          >
            Exportar
          </button>
        </>
      }
    >
      <div className="dk-form-row">
        <label htmlFor="dk-export-format">Formato</label>
        <select
          id="dk-export-format"
          className="dk-field"
          value={format}
          data-autofocus
          onChange={(e) => {
            setFormat(e.target.value as ExportFormat);
          }}
        >
          {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
      </div>
      <div className="dk-form-row">
        <label htmlFor="dk-export-name">Nome do arquivo</label>
        <input
          id="dk-export-name"
          className="dk-field"
          value={fileName}
          maxLength={200}
          onChange={(e) => {
            setNameEdited(e.target.value);
          }}
        />
      </div>

      <fieldset className="dk-scope">
        <legend>Linhas</legend>
        <label className="dk-checkbox">
          <input
            type="radio"
            name="dk-export-scope"
            checked={!visibleOnly}
            onChange={() => {
              setVisibleOnly(false);
            }}
          />
          Todas as linhas, na ordem dos dados
        </label>
        <label className="dk-checkbox">
          <input
            type="radio"
            name="dk-export-scope"
            checked={visibleOnly}
            disabled={!viewActive}
            onChange={() => {
              setVisibleOnly(true);
            }}
          />
          Somente linhas visíveis, na ordem atual
        </label>
      </fieldset>

      {format === 'csv' && (
        <>
          <div className="dk-form-row">
            <label htmlFor="dk-export-preset">Predefinição</label>
            <select
              id="dk-export-preset"
              className="dk-field"
              value={preset}
              onChange={(e) => {
                choosePreset(e.target.value as Preset);
              }}
            >
              <option value="standard">Padrão (UTF-8, vírgula)</option>
              <option value="excelBr">Excel Brasil (UTF-8 com BOM, ponto e vírgula)</option>
              <option value="custom">Personalizada</option>
            </select>
          </div>
          <div className="dk-form-row">
            <label htmlFor="dk-export-delimiter">Delimitador</label>
            <select
              id="dk-export-delimiter"
              className="dk-field"
              value={delimiter}
              onChange={(e) => {
                setDelimiter(e.target.value as CsvDelimiter);
                setPreset('custom');
              }}
            >
              {DELIMITERS.map(([d, label]) => (
                <option key={d} value={d}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="dk-tool-options">
            <Check label="Com cabeçalho" checked={header} onChange={setHeader} />
            <Check
              label="UTF-8 com BOM"
              checked={bom}
              onChange={(v) => {
                setBom(v);
                setPreset('custom');
              }}
            />
            <Check
              label="Proteção contra fórmulas"
              checked={formulaGuard}
              onChange={setFormulaGuard}
            />
          </div>
        </>
      )}

      {format === 'xlsx' && (
        <div className="dk-tool-options">
          {many && (
            <Check
              label="Todas as abas"
              checked={allSheets && !visibleOnly}
              disabled={visibleOnly}
              onChange={setAllSheets}
            />
          )}
          <Check label="Com cabeçalho" checked={header} onChange={setHeader} />
          <Check
            label="Tipos nativos (número, data, booleano)"
            checked={nativeTypes}
            onChange={setNativeTypes}
          />
        </div>
      )}

      {format === 'json' && (
        <>
          <div className="dk-form-row">
            <label htmlFor="dk-export-shape">Estrutura</label>
            <select
              id="dk-export-shape"
              className="dk-field"
              value={shape}
              onChange={(e) => {
                setShape(e.target.value as 'objects' | 'arrays');
              }}
            >
              <option value="objects">Array de objetos</option>
              <option value="arrays">Array de arrays</option>
            </select>
          </div>
          <div className="dk-tool-options">
            {shape === 'objects' && (
              <Check label="Reconstruir objetos aninhados" checked={nested} onChange={setNested} />
            )}
            <Check label="Indentado" checked={indent} onChange={setIndent} />
          </div>
        </>
      )}

      {many && format !== 'xlsx' && (
        <p className="dk-tool-desc">{`O ${FORMAT_LABELS[format]} tem uma tabela só: exporta a aba "${table.name}".`}</p>
      )}
      {warnings.length > 0 && (
        <ul className="dk-export-warnings" aria-label="Avisos da exportação">
          {warnings.map((w) => (
            <li key={w.code}>{w.message}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="dk-checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      {label}
    </label>
  );
}
