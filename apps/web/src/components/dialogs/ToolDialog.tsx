import { useEffect, useState } from 'react';
import { formatInteger, type ConvertTarget } from '@datakit/core';
import { useApp } from '../../state/appStore.ts';
import {
  closeTool,
  COLUMN_TOOLS,
  filterActive,
  previewToolBoth,
  runTool,
  TOOL_TITLES,
  type Scope,
  type ToolParams,
  type ToolPreviews,
  type ToolRequest,
} from '../../state/tools.ts';
import { Modal } from './Modal.tsx';

// Diálogo das ferramentas de tratamento (seção 8): opções, escopo quando há filtro (seção 7.5),
// quantas linhas ou células mudam e o lembrete de que dá para desfazer.

const TARGET_LABELS: Record<ConvertTarget, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  boolean: 'Booleano (true/false)',
};

const DESCRIPTIONS: Partial<Record<ToolRequest['kind'], string>> = {
  duplicates: 'Mantém a primeira ocorrência de cada linha repetida e remove as outras.',
  emptyRows: 'Remove as linhas em que todas as células estão vazias, nulas ou ausentes.',
  trim: 'Tira os espaços do começo e do fim do texto.',
  fill: 'Preenche células vazias, só com espaços, nulas ou ausentes.',
  replaceValue: 'Troca as células cujo texto inteiro é igual ao valor procurado.',
  clear: 'Deixa todas as células como texto vazio.',
};

export function ToolDialog() {
  const tool = useApp((s) => s.tool);
  if (!tool) return null;
  // A chave recria o estado do formulário a cada abertura.
  return <ToolForm key={`${tool.kind}:${tool.tableId}:${tool.colIds.join(',')}`} req={tool} />;
}

function ToolForm({ req }: { req: ToolRequest }) {
  const revision = useApp((s) => s.revision);
  const table = useApp((s) => s.doc?.tables.find((t) => t.id === req.tableId));
  const askScope = filterActive(req.tableId);
  const [scope, setScope] = useState<Scope>('all');
  const [params, setParams] = useState<ToolParams>(() => ({
    compare: table?.columns.map((c) => c.id) ?? [],
    ignoreCase: false,
    trim: false,
    whitespaceAsEmpty: false,
    target: 'number',
    source: { numberLocale: 'br', dateFormat: 'dmy' },
    value: '',
    from: '',
    to: '',
  }));
  const set = (patch: Partial<ToolParams>) => {
    setParams((p) => ({ ...p, ...patch }));
  };

  const needsColumns = COLUMN_TOOLS.includes(req.kind);
  const columns = (table?.columns ?? []).filter((c) => req.colIds.includes(c.id));
  // A prévia é calculada fora da renderização e pode ser cancelada: com 100.000 linhas,
  // "remover duplicadas" leva ~0,6 s e não pode travar a tela (seção 13).
  const key = JSON.stringify([params, revision, askScope]);
  const [computed, setComputed] = useState<{ key: string; previews: ToolPreviews } | undefined>(
    undefined,
  );
  useEffect(() => {
    let stop = false;
    void previewToolBoth(req, params, askScope, () => stop).then((previews) => {
      if (previews && !stop) setComputed({ key, previews });
    });
    return () => {
      stop = true;
    };
  }, [req, params, askScope, key]);
  const previews = computed?.key === key ? computed.previews : undefined;
  const preview =
    previews && (scope === 'visible' ? (previews.visible ?? previews.all) : previews.all);
  const allRows = previews?.all.count;
  const visibleRows = previews?.visible?.count;
  const unit = req.kind === 'duplicates' || req.kind === 'emptyRows' ? 'linhas' : 'células';
  if (!table) return null;

  const failed = (preview?.failed ?? []).reduce((n, f) => n + f.rowIds.length, 0);
  const missingColumns = needsColumns && columns.length === 0;
  const missingCompare = req.kind === 'duplicates' && params.compare.length === 0;
  const blocked = missingColumns || missingCompare || !preview || preview.count === 0;
  const run = () => {
    if (!blocked) runTool(req, preview);
  };
  const verb = unit === 'linhas' ? 'serão removidas' : 'serão alteradas';
  const summary = !preview
    ? 'Calculando…'
    : preview.count === 0
      ? `Nenhuma ${unit === 'linhas' ? 'linha' : 'célula'} muda.`
      : `${formatInteger(preview.count)} ${unit} ${verb}. Dá para desfazer com Ctrl+Z.`;

  return (
    <Modal
      title={TOOL_TITLES[req.kind]}
      onClose={closeTool}
      onEnter={run}
      footer={
        <>
          <button type="button" className="dk-button" onClick={closeTool}>
            Cancelar
          </button>
          <button type="button" className="dk-button is-primary" disabled={blocked} onClick={run}>
            {unit === 'linhas' ? 'Remover' : 'Aplicar'}
          </button>
        </>
      }
    >
      {DESCRIPTIONS[req.kind] && <p className="dk-tool-desc">{DESCRIPTIONS[req.kind]}</p>}

      {needsColumns && (
        <p className="dk-tool-cols">
          {missingColumns
            ? 'Selecione uma ou mais colunas na grade antes de usar esta ferramenta.'
            : `Colunas: ${columns.map((c) => c.name).join(', ')}`}
        </p>
      )}

      {req.kind === 'duplicates' && (
        <>
          <fieldset className="dk-scope dk-tool-compare">
            <legend>Comparar as colunas</legend>
            <div className="dk-tool-checklist">
              {table.columns.map((c) => (
                <label key={c.id} className="dk-checkbox">
                  <input
                    type="checkbox"
                    checked={params.compare.includes(c.id)}
                    onChange={(e) => {
                      set({
                        compare: e.target.checked
                          ? table.columns
                              .map((x) => x.id)
                              .filter((id) => id === c.id || params.compare.includes(id))
                          : params.compare.filter((id) => id !== c.id),
                      });
                    }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="dk-tool-options">
            <label className="dk-checkbox">
              <input
                type="checkbox"
                checked={params.ignoreCase}
                onChange={(e) => {
                  set({ ignoreCase: e.target.checked });
                }}
              />
              Ignorar maiúsculas
            </label>
            <label className="dk-checkbox">
              <input
                type="checkbox"
                checked={params.trim}
                onChange={(e) => {
                  set({ trim: e.target.checked });
                }}
              />
              Aparar espaços na comparação
            </label>
          </div>
        </>
      )}

      {req.kind === 'emptyRows' && (
        <div className="dk-tool-options">
          <label className="dk-checkbox">
            <input
              type="checkbox"
              checked={params.whitespaceAsEmpty}
              onChange={(e) => {
                set({ whitespaceAsEmpty: e.target.checked });
              }}
            />
            Contar células só com espaços como vazias
          </label>
        </div>
      )}

      {req.kind === 'convert' && (
        <>
          <div className="dk-form-row">
            <label htmlFor="dk-convert-target">Converter para</label>
            <select
              id="dk-convert-target"
              className="dk-field"
              value={params.target}
              data-autofocus
              onChange={(e) => {
                set({ target: e.target.value as ConvertTarget });
              }}
            >
              {(Object.keys(TARGET_LABELS) as ConvertTarget[]).map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          {params.target === 'number' && (
            <div className="dk-form-row">
              <label htmlFor="dk-convert-number">Formato de origem</label>
              <select
                id="dk-convert-number"
                className="dk-field"
                value={params.source.numberLocale}
                onChange={(e) => {
                  set({
                    source: { ...params.source, numberLocale: e.target.value as 'br' | 'intl' },
                  });
                }}
              >
                <option value="br">Brasileiro (1.234,56)</option>
                <option value="intl">Internacional (1,234.56)</option>
              </select>
            </div>
          )}
          {params.target === 'date' && (
            <div className="dk-form-row">
              <label htmlFor="dk-convert-date">Formato de origem</label>
              <select
                id="dk-convert-date"
                className="dk-field"
                value={params.source.dateFormat}
                onChange={(e) => {
                  set({
                    source: { ...params.source, dateFormat: e.target.value as 'dmy' | 'ymd' },
                  });
                }}
              >
                <option value="dmy">dd/mm/aaaa</option>
                <option value="ymd">aaaa-mm-dd</option>
              </select>
            </div>
          )}
          <p className="dk-tool-desc">
            {params.target === 'text'
              ? 'O texto não muda; os valores deixam de ser lidos como número ou data.'
              : `O resultado é gravado em forma canônica (${params.target === 'number' ? '1.234,56 → 1234.56' : params.target === 'date' ? '31/12/2024 → 2024-12-31' : 'Sim → true'}).`}
          </p>
          {failed > 0 && (
            <p className="dk-tool-warn" role="alert">
              {`${formatInteger(failed)} valores não podem ser convertidos: ficam como estão e são destacados.`}
            </p>
          )}
        </>
      )}

      {req.kind === 'fill' && (
        <div className="dk-form-row">
          <label htmlFor="dk-fill-value">Valor</label>
          <input
            id="dk-fill-value"
            className="dk-field"
            value={params.value}
            data-autofocus
            onChange={(e) => {
              set({ value: e.target.value });
            }}
          />
        </div>
      )}

      {req.kind === 'replaceValue' && (
        <>
          <div className="dk-form-row">
            <label htmlFor="dk-replace-from">Procurar</label>
            <input
              id="dk-replace-from"
              className="dk-field"
              value={params.from}
              data-autofocus
              onChange={(e) => {
                set({ from: e.target.value });
              }}
            />
          </div>
          <div className="dk-form-row">
            <label htmlFor="dk-replace-to">Trocar por</label>
            <input
              id="dk-replace-to"
              className="dk-field"
              value={params.to}
              onChange={(e) => {
                set({ to: e.target.value });
              }}
            />
          </div>
        </>
      )}

      {askScope && (
        <fieldset className="dk-scope">
          <legend>Onde aplicar</legend>
          <label className="dk-checkbox">
            <input
              type="radio"
              name="dk-tool-scope"
              checked={scope === 'all'}
              onChange={() => {
                setScope('all');
              }}
            />
            {`Todas as linhas (${allRows === undefined ? '…' : formatInteger(allRows)} ${unit})`}
          </label>
          <label className="dk-checkbox">
            <input
              type="radio"
              name="dk-tool-scope"
              checked={scope === 'visible'}
              onChange={() => {
                setScope('visible');
              }}
            />
            {`Só as linhas visíveis (${visibleRows === undefined ? '…' : formatInteger(visibleRows)} ${unit})`}
          </label>
        </fieldset>
      )}

      {!missingColumns && <p className="dk-message-single dk-tool-summary">{summary}</p>}
    </Modal>
  );
}
