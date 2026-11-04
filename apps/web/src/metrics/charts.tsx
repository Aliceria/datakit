import { formatInteger } from '@datakit/core';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { fullDay, shortDay } from './labels.ts';

// Gráficos em SVG próprio, sem biblioteca: colunas empilhadas por dia, linhas da evolução
// acumulada e barras horizontais para formatos e ferramentas. Paleta validada para o fundo
// escuro (variáveis --series-* em metrics.css); textos sempre nas cores de texto, nunca na da
// série; toda série tem legenda e todo gráfico tem a tabela com os mesmos números.

const n = formatInteger;

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setWidth(el.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width];
}

/** Topo "redondo" para o eixo: 0, 1, 2, 5, 10, 20, 50… */
function niceMax(value: number): number {
  if (value <= 4) return Math.max(1, value);
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (value <= m * pow) return m * pow;
  return 10 * pow;
}

/** Retângulo com cantos de 4 px só em cima (a ponta do dado); a base fica reta. */
function topRounded(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  return `M${String(x)},${String(y + h)}V${String(y + rr)}Q${String(x)},${String(y)} ${String(x + rr)},${String(y)}H${String(x + w - rr)}Q${String(x + w)},${String(y)} ${String(x + w)},${String(y + rr)}V${String(y + h)}Z`;
}

export type Series = { key: string; label: string; color: string };

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="dk-m-legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className="dk-m-swatch" style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ x, children }: { x: number; children: ReactNode }) {
  return (
    <div className="dk-m-tooltip" style={{ left: x }} role="status">
      {children}
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="dk-m-datatable">
      <summary>Ver como tabela</summary>
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{typeof c === 'number' ? n(c) : c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 22, left: 36 };

function YAxis({ max, width }: { max: number; width: number }) {
  const ticks = [0, max / 2, max].filter((t, i, a) => Number.isInteger(t) && a.indexOf(t) === i);
  const h = HEIGHT - PAD.top - PAD.bottom;
  return (
    <g>
      {ticks.map((t) => {
        const y = PAD.top + h - (t / max) * h;
        return (
          <g key={t}>
            <line className="dk-m-grid" x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} />
            <text className="dk-m-tick" x={PAD.left - 6} y={y} textAnchor="end" dy="0.32em">
              {n(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Rótulos de dia no eixo de baixo, espaçados para não se encostarem. */
function XLabels({ days, x, width }: { days: string[]; x: (i: number) => number; width: number }) {
  const room = Math.max(1, Math.floor((width - PAD.left - PAD.right) / 48));
  const step = Math.max(1, Math.ceil(days.length / room));
  return (
    <g>
      {days.map((d, i) =>
        i % step === 0 || i === days.length - 1 ? (
          <text key={d} className="dk-m-tick" x={x(i)} y={HEIGHT - 6} textAnchor="middle">
            {shortDay(d)}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** Colunas empilhadas por dia (ex.: acessos externos e administrativos). */
export function StackedColumns({
  title,
  days,
  series,
  values,
}: {
  title: string;
  days: string[];
  series: Series[];
  /** values[i][s] = valor do dia i na série s */
  values: number[][];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | undefined>();
  const totals = values.map((v) => v.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const band = days.length > 0 ? plotW / days.length : 0;
  const barW = Math.max(2, Math.min(24, band * 0.6));
  const h = HEIGHT - PAD.top - PAD.bottom;
  const xCenter = (i: number) => PAD.left + band * i + band / 2;
  const scale = (v: number) => (v / max) * h;

  return (
    <figure className="dk-m-chart">
      <figcaption>{title}</figcaption>
      <Legend series={series} />
      <div
        ref={ref}
        className="dk-m-plot"
        onMouseLeave={() => {
          setHover(undefined);
        }}
      >
        {width > 0 && days.length > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={title}>
            <YAxis max={max} width={width} />
            {values.map((v, i) => {
              let y = PAD.top + h;
              const segs = v
                .map((val, s) => ({ val, s }))
                .filter((seg) => seg.val > 0)
                .map((seg, k, arr) => {
                  const segH = scale(seg.val);
                  // 2 px de fundo entre os segmentos empilhados.
                  const gap = k > 0 ? 2 : 0;
                  y -= segH;
                  const top = y;
                  const isTop = k === arr.length - 1;
                  const x = xCenter(i) - barW / 2;
                  const height = Math.max(0, segH - gap);
                  const color = series[seg.s]?.color ?? 'currentColor';
                  return isTop ? (
                    <path key={seg.s} d={topRounded(x, top, barW, height)} fill={color} />
                  ) : (
                    <rect key={seg.s} x={x} y={top} width={barW} height={height} fill={color} />
                  );
                });
              return (
                <g key={days[i]}>
                  {segs}
                  {/* Área de hover maior que a coluna. */}
                  <rect
                    className="dk-m-hit"
                    x={PAD.left + band * i}
                    y={PAD.top}
                    width={band}
                    height={h}
                    onMouseEnter={() => {
                      setHover(i);
                    }}
                  />
                </g>
              );
            })}
            <XLabels days={days} x={xCenter} width={width} />
          </svg>
        )}
        {hover !== undefined && days[hover] && (
          <Tooltip x={Math.min(Math.max(xCenter(hover), 70), width - 70)}>
            <strong>{fullDay(days[hover])}</strong>
            {series.map((s, k) => (
              <span key={s.key}>
                <span className="dk-m-swatch" style={{ background: s.color }} aria-hidden="true" />
                {s.label}: {n(values[hover]?.[k] ?? 0)}
              </span>
            ))}
          </Tooltip>
        )}
        {days.length === 0 && <p className="dk-m-empty">Nenhum registro no período.</p>}
      </div>
      <DataTable
        head={['Dia', ...series.map((s) => s.label)]}
        rows={days.map((d, i) => [fullDay(d), ...(values[i] ?? [])])}
      />
    </figure>
  );
}

/** Linhas acumuladas (um eixo só, mesma unidade: quantidade). */
export function Lines({
  title,
  days,
  series,
  values,
}: {
  title: string;
  days: string[];
  series: Series[];
  values: number[][];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | undefined>();
  const max = niceMax(Math.max(0, ...values.flat()));
  const plotW = Math.max(0, width - PAD.left - PAD.right - 28);
  const h = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (days.length > 1 ? (plotW * i) / (days.length - 1) : plotW / 2);
  const y = (v: number) => PAD.top + h - (v / max) * h;

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - box.left;
    const i = days.length > 1 ? Math.round((rel / plotW) * (days.length - 1)) : 0;
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  };

  return (
    <figure className="dk-m-chart">
      <figcaption>{title}</figcaption>
      <Legend series={series} />
      <div
        ref={ref}
        className="dk-m-plot"
        onMouseLeave={() => {
          setHover(undefined);
        }}
      >
        {width > 0 && days.length > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={title}>
            <YAxis max={max} width={width} />
            {series.map((s, k) => {
              const pts = values.map((v, i) => `${String(x(i))},${String(y(v[k] ?? 0))}`);
              const last = values.length - 1;
              const lastV = values[last]?.[k] ?? 0;
              return (
                <g key={s.key}>
                  <polyline
                    points={pts.join(' ')}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <circle
                    cx={x(last)}
                    cy={y(lastV)}
                    r={4}
                    fill={s.color}
                    className="dk-m-ring"
                    strokeWidth={2}
                  />
                </g>
              );
            })}
            {hover !== undefined && (
              <line
                className="dk-m-crosshair"
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + h}
              />
            )}
            <rect
              className="dk-m-hit"
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={h}
              onMouseMove={onMove}
            />
            <XLabels days={days} x={x} width={width} />
          </svg>
        )}
        {hover !== undefined && days[hover] && (
          <Tooltip x={Math.min(Math.max(x(hover), 70), width - 70)}>
            <strong>{fullDay(days[hover])}</strong>
            {series.map((s, k) => (
              <span key={s.key}>
                <span className="dk-m-swatch" style={{ background: s.color }} aria-hidden="true" />
                {s.label}: {n(values[hover]?.[k] ?? 0)}
              </span>
            ))}
          </Tooltip>
        )}
        {days.length === 0 && <p className="dk-m-empty">Nenhum registro no período.</p>}
      </div>
      <DataTable
        head={['Dia', ...series.map((s) => s.label)]}
        rows={days.map((d, i) => [fullDay(d), ...(values[i] ?? [])])}
      />
    </figure>
  );
}

/** Barras horizontais de uma série só (o título diz o que é; sem legenda). */
export function Bars({
  title,
  items,
  label,
}: {
  title: string;
  items: { key: string; count: number }[];
  label: (key: string) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const total = items.reduce((a, b) => a + b.count, 0);
  return (
    <figure className="dk-m-chart">
      <figcaption>{title}</figcaption>
      {items.length === 0 ? (
        <p className="dk-m-empty">Nenhum registro no período.</p>
      ) : (
        <ul className="dk-m-bars">
          {items.map((item) => {
            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
            return (
              <li key={item.key} title={`${label(item.key)}: ${n(item.count)} (${String(pct)}%)`}>
                <span className="dk-m-bar-label">{label(item.key)}</span>
                <span className="dk-m-bar-track">
                  <span
                    className="dk-m-bar"
                    style={{ width: `${String((item.count / max) * 100)}%` }}
                  />
                </span>
                <span className="dk-m-bar-value">
                  {n(item.count)} <span className="dk-m-muted">({pct}%)</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}
