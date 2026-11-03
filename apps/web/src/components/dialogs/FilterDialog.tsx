import { useState } from 'react';
import {
  DATE_OP_LABELS,
  NUMBER_OP_LABELS,
  STATE_OP_LABELS,
  TEXT_OP_LABELS,
  type DateOp,
  type FilterCondition,
  type NumberOp,
  type StateOp,
  type Table,
  type TextOp,
} from '@datakit/core';
import { appStore, useApp } from '../../state/appStore.ts';
import { setColumnFilter, specOf } from '../../state/view.ts';
import { Modal } from './Modal.tsx';

// Filtro de uma coluna (seção 7.4): texto, número, data, estado e tipo.

type OpKey = `text:${TextOp}` | `number:${NumberOp}` | `date:${DateOp}` | `state:${StateOp}`;

const GROUPS: Array<{ label: string; options: Array<[OpKey, string]> }> = [
  {
    label: 'Texto',
    options: Object.entries(TEXT_OP_LABELS).map(([k, v]) => [`text:${k}` as OpKey, v]),
  },
  {
    label: 'Número',
    options: Object.entries(NUMBER_OP_LABELS).map(([k, v]) => [
      `number:${k}` as OpKey,
      `número ${v}`,
    ]),
  },
  {
    label: 'Data',
    options: Object.entries(DATE_OP_LABELS).map(([k, v]) => [`date:${k}` as OpKey, `data ${v}`]),
  },
  {
    label: 'Estado e tipo',
    options: Object.entries(STATE_OP_LABELS).map(([k, v]) => [`state:${k}` as OpKey, v]),
  },
];

function keyOf(c: FilterCondition): OpKey {
  return `${c.kind}:${c.op}` as OpKey;
}

function build(key: OpKey, value: string, value2: string, caseSensitive: boolean): FilterCondition {
  const [kind, op] = key.split(':') as [FilterCondition['kind'], string];
  if (kind === 'text') return { kind, op: op as TextOp, value, caseSensitive };
  if (kind === 'number') {
    return op === 'between' ? { kind, op, value, value2 } : { kind, op: op as NumberOp, value };
  }
  if (kind === 'date') {
    return op === 'between' ? { kind, op, value, value2 } : { kind, op: op as DateOp, value };
  }
  return { kind: 'state', op: op as StateOp };
}

type Props = { table: Table; colId: string; onClose: () => void };

export function FilterDialog({ table, colId, onClose }: Props) {
  const column = table.columns.find((c) => c.id === colId);
  const inference = useApp((s) => s.doc?.inference[table.id]?.[colId]);
  const existing = specOf(appStore.get(), table.id).filters.find(
    (f) => f.colId === colId,
  )?.condition;

  // Sugestão inicial pelo tipo da coluna.
  const suggested: OpKey =
    inference?.type === 'number'
      ? 'number:gt'
      : inference?.type === 'date'
        ? 'date:after'
        : 'text:contains';
  const [key, setKey] = useState<OpKey>(existing ? keyOf(existing) : suggested);
  const [value, setValue] = useState(existing && 'value' in existing ? existing.value : '');
  const [value2, setValue2] = useState(
    existing && 'value2' in existing ? (existing.value2 ?? '') : '',
  );
  const [caseSensitive, setCaseSensitive] = useState(
    existing?.kind === 'text' ? existing.caseSensitive : false,
  );

  if (!column) return null;
  const kind = key.split(':')[0];
  const between = key.endsWith(':between');
  const needsValue = kind !== 'state';

  const apply = () => {
    if (setColumnFilter(table.id, colId, build(key, value, value2, caseSensitive))) onClose();
  };
  const remove = () => {
    setColumnFilter(table.id, colId, undefined);
    onClose();
  };
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    }
  };

  return (
    <Modal
      title={`Filtrar "${column.name}"`}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button type="button" className="dk-button" onClick={remove}>
              Remover filtro
            </button>
          )}
          <button type="button" className="dk-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="dk-button is-primary" onClick={apply}>
            Aplicar
          </button>
        </>
      }
    >
      <div className="dk-form-row">
        <label htmlFor="dk-filter-op">Condição</label>
        <select
          id="dk-filter-op"
          className="dk-field"
          value={key}
          data-autofocus
          onChange={(e) => {
            setKey(e.target.value as OpKey);
          }}
        >
          {GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {needsValue && (
        <div className="dk-form-row">
          <label htmlFor="dk-filter-value">{between ? 'De' : 'Valor'}</label>
          <input
            id="dk-filter-value"
            className="dk-field"
            value={value}
            placeholder={kind === 'date' ? 'dd/mm/aaaa' : kind === 'number' ? 'ex.: 1.234,56' : ''}
            onChange={(e) => {
              setValue(e.target.value);
            }}
            onKeyDown={onEnter}
          />
        </div>
      )}
      {needsValue && between && (
        <div className="dk-form-row">
          <label htmlFor="dk-filter-value2">Até</label>
          <input
            id="dk-filter-value2"
            className="dk-field"
            value={value2}
            onChange={(e) => {
              setValue2(e.target.value);
            }}
            onKeyDown={onEnter}
          />
        </div>
      )}
      {kind === 'text' && (
        <div className="dk-form-row">
          <span className="dk-form-label">Opções</span>
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
        </div>
      )}
    </Modal>
  );
}
