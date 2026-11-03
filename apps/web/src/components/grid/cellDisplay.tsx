import { STATE_ABSENT, STATE_NULL, type CellState } from '@datakit/core';
import type { ReactNode } from 'react';

// Como cada estado aparece na grade (seção 7.1). Sempre texto, nunca HTML.

const EDGE_WHITESPACE = /^(\s*)([\s\S]*?)(\s*)$/;

/** Quebras de linha e tabulações ficam visíveis numa célula de uma linha só. */
function visibleControls(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '↵').replaceAll('\t', '→');
}

const dots = (s: string) => '·'.repeat(s.length);

export function renderCell(state: CellState, raw: string): ReactNode {
  if (state === STATE_NULL) return <span className="dk-cell-null">null</span>;
  if (state === STATE_ABSENT) return <span className="dk-cell-absent">—</span>;
  if (raw === '') return null;
  if (raw.trim() === '') return <span className="dk-cell-ws">{dots(raw)}</span>;

  const m = EDGE_WHITESPACE.exec(raw);
  const [, lead = '', body = raw, trail = ''] = m ?? [];
  if (lead === '' && trail === '') return visibleControls(raw);
  return (
    <>
      {lead && <span className="dk-cell-edge">{dots(lead)}</span>}
      {visibleControls(body)}
      {trail && <span className="dk-cell-edge">{dots(trail)}</span>}
    </>
  );
}

/** Texto para o atributo title (dica ao passar o mouse). */
export function cellTitle(state: CellState, raw: string): string | undefined {
  if (state === STATE_NULL) return 'nulo';
  if (state === STATE_ABSENT) return 'ausente (a chave não existia)';
  if (raw === '') return undefined;
  return raw.length > 40 || raw !== raw.trim() ? raw : undefined;
}
