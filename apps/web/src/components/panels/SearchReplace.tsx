import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { formatInteger, type SearchOptions } from '@datakit/core';
import { rememberSearch, savedSearch } from '../../session/viewState.ts';
import { activeTable, useApp } from '../../state/appStore.ts';
import {
  COUNT_CAP,
  findNext,
  goToHit,
  planReplaceAll,
  replaceCurrent,
  scanMatches,
  type SearchScope,
} from '../../state/search.ts';
import { Modal } from '../dialogs/Modal.tsx';
import './SearchReplace.css';

/** Evento que o Ctrl+F dispara para pôr o foco na busca. */
export const FOCUS_SEARCH_EVENT = 'dk:focus-search';

/** Pesquisar e substituir (seção 7.4). */
export function SearchReplace() {
  const doc = useApp((s) => s.doc);
  const table = useApp(activeTable);
  const revision = useApp((s) => s.revision);
  const view = useApp((s) => (table ? s.views[table.id] : undefined));
  const readOnly = useApp((s) => s.sessionStatus === 'expired');
  const saved = savedSearch();
  const [query, setQuery] = useState(saved?.query ?? '');
  const [colId, setColId] = useState<string | null>(saved?.colId ?? null);
  const [caseSensitive, setCaseSensitive] = useState(saved?.caseSensitive ?? false);
  const [ignoreAccents, setIgnoreAccents] = useState(saved?.ignoreAccents ?? false);
  const [wholeCell, setWholeCell] = useState(saved?.wholeCell ?? false);
  const [listAll, setListAll] = useState(false);
  const [replaceOn, setReplaceOn] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [confirming, setConfirming] = useState<
    { all: number; visible: number | undefined; scope: 'all' | 'visible' } | undefined
  >();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => {
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, focus);
    return () => {
      window.removeEventListener(FOCUS_SEARCH_EVENT, focus);
    };
  }, []);

  const options: SearchOptions = { query, caseSensitive, ignoreAccents, wholeCell };
  const validColId = colId !== null && table?.data.has(colId) ? colId : null;
  const scope: SearchScope = { options, colId: validColId };

  useEffect(() => {
    rememberSearch({ query, colId: validColId, caseSensitive, ignoreAccents, wholeCell });
  }, [query, validColId, caseSensitive, ignoreAccents, wholeCell]);

  // A contagem percorre a tabela inteira: roda com prioridade baixa enquanto se digita.
  const deferred = useDeferredValue({ ...scope, revision, view });
  const result = useMemo(
    () => (table && deferred.options.query !== '' ? scanMatches(table, deferred) : undefined),
    [table, deferred],
  );

  if (!doc || !table) return <p className="dk-section-empty">Nenhum arquivo aberto.</p>;

  const go = (direction: 1 | -1) => {
    const hit = findNext(scope, direction);
    if (hit) goToHit(hit);
  };

  const askReplaceAll = () => {
    const all = planReplaceAll(scope, replacement, 'all').cells;
    const visible = view?.spec.filters.length
      ? planReplaceAll(scope, replacement, 'visible').cells
      : undefined;
    setConfirming({ all, visible, scope: 'all' });
  };

  const countText = !result
    ? ''
    : result.count === 0
      ? 'Nenhum resultado'
      : result.capped
        ? `Mais de ${formatInteger(COUNT_CAP)} células`
        : `${formatInteger(result.count)} ${result.count === 1 ? 'célula' : 'células'}`;

  return (
    <div className="dk-search">
      <div className="dk-form-row">
        <label htmlFor="dk-search-query">Pesquisar</label>
        <input
          id="dk-search-query"
          ref={input}
          className="dk-field"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            }
          }}
        />
      </div>
      <div className="dk-form-row">
        <label htmlFor="dk-search-col">Em</label>
        <select
          id="dk-search-col"
          className="dk-field"
          value={validColId ?? ''}
          onChange={(e) => {
            setColId(e.target.value === '' ? null : e.target.value);
          }}
        >
          <option value="">Todas as colunas</option>
          {table.columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="dk-form-row">
        <span className="dk-form-label">Opções</span>
        <div className="dk-search-options">
          <label className="dk-checkbox">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => {
                setCaseSensitive(e.target.checked);
              }}
            />
            Diferenciar maiúsculas
          </label>
          <label className="dk-checkbox">
            <input
              type="checkbox"
              checked={ignoreAccents}
              onChange={(e) => {
                setIgnoreAccents(e.target.checked);
              }}
            />
            Ignorar acentos
          </label>
          <label className="dk-checkbox">
            <input
              type="checkbox"
              checked={wholeCell}
              onChange={(e) => {
                setWholeCell(e.target.checked);
              }}
            />
            Célula inteira
          </label>
          <label className="dk-checkbox">
            <input
              type="checkbox"
              checked={listAll}
              onChange={(e) => {
                setListAll(e.target.checked);
              }}
            />
            Listar todas
          </label>
          <label className="dk-checkbox">
            <input
              type="checkbox"
              checked={replaceOn}
              disabled={readOnly}
              onChange={(e) => {
                setReplaceOn(e.target.checked);
              }}
            />
            Ativar substituição
          </label>
        </div>
      </div>
      {replaceOn && (
        <div className="dk-form-row">
          <label htmlFor="dk-search-replacement">Substituir por</label>
          <input
            id="dk-search-replacement"
            className="dk-field"
            value={replacement}
            onChange={(e) => {
              setReplacement(e.target.value);
            }}
          />
        </div>
      )}
      <p className="dk-search-count" role="status" aria-live="polite">
        {countText}
      </p>
      <div className="dk-search-buttons">
        <button
          type="button"
          className="dk-button"
          disabled={!result?.count}
          onClick={() => {
            go(-1);
          }}
        >
          Anterior
        </button>
        <button
          type="button"
          className="dk-button"
          disabled={!result?.count}
          onClick={() => {
            go(1);
          }}
        >
          Próximo
        </button>
      </div>
      {replaceOn && (
        <div className="dk-search-buttons">
          <button
            type="button"
            className="dk-button"
            disabled={!result?.count || readOnly}
            onClick={() => {
              replaceCurrent(scope, replacement);
            }}
          >
            Substituir
          </button>
          <button
            type="button"
            className="dk-button"
            disabled={!result?.count || readOnly}
            onClick={askReplaceAll}
          >
            Substituir todas
          </button>
        </div>
      )}
      {listAll && result && result.first.length > 0 && (
        <ol className="dk-search-list" aria-label="Resultados da busca">
          {result.first.map((hit) => {
            const rowId = (view?.rowIds ?? table.rowOrder)[hit.r];
            const column = table.columns[hit.c];
            const data = column && table.data.get(column.id);
            const raw = rowId === undefined || !data ? '' : (data.raw[rowId] ?? '');
            return (
              <li key={`${String(hit.r)}:${String(hit.c)}`}>
                <button
                  type="button"
                  className="dk-search-hit"
                  onClick={() => {
                    goToHit(hit);
                  }}
                >
                  <span className="dk-search-hit-pos">
                    L{(rowId === undefined ? hit.r : table.rowOrder.indexOf(rowId)) + 1} ·{' '}
                    {column?.name}
                  </span>
                  <span className="dk-search-hit-text">{raw}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {confirming && (
        <Modal
          title="Substituir todas"
          onClose={() => {
            setConfirming(undefined);
          }}
          footer={
            <>
              <button
                type="button"
                className="dk-button"
                onClick={() => {
                  setConfirming(undefined);
                }}
                data-autofocus
              >
                Cancelar
              </button>
              <button
                type="button"
                className="dk-button is-primary"
                disabled={
                  (confirming.scope === 'all' ? confirming.all : (confirming.visible ?? 0)) === 0
                }
                onClick={() => {
                  planReplaceAll(scope, replacement, confirming.scope).run();
                  setConfirming(undefined);
                }}
              >
                Substituir
              </button>
            </>
          }
        >
          {confirming.visible !== undefined && (
            <fieldset className="dk-scope">
              <legend>Onde substituir</legend>
              <label className="dk-checkbox">
                <input
                  type="radio"
                  name="dk-replace-scope"
                  checked={confirming.scope === 'all'}
                  onChange={() => {
                    setConfirming({ ...confirming, scope: 'all' });
                  }}
                />
                Todas as linhas ({formatInteger(confirming.all)} células)
              </label>
              <label className="dk-checkbox">
                <input
                  type="radio"
                  name="dk-replace-scope"
                  checked={confirming.scope === 'visible'}
                  onChange={() => {
                    setConfirming({ ...confirming, scope: 'visible' });
                  }}
                />
                Só as linhas visíveis ({formatInteger(confirming.visible)} células)
              </label>
            </fieldset>
          )}
          <p className="dk-message-single">
            {`${formatInteger(confirming.scope === 'all' ? confirming.all : (confirming.visible ?? 0))} células serão alteradas. Dá para desfazer depois.`}
          </p>
        </Modal>
      )}
    </div>
  );
}
