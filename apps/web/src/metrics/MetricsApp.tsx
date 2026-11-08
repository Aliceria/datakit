import { formatInteger } from '@datakit/core';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  PanelError,
  panelApi,
  type EventRow,
  type Me,
  type Page,
  type Period,
  type Summary,
  type View,
  type VisitRow,
} from './api.ts';
import { Bars, Lines, StackedColumns, type Series } from './charts.tsx';
import {
  PERIOD_LABELS,
  classLabel,
  conversionLabel,
  dateOf,
  formatLabel,
  timeOf,
  toolLabel,
  typeLabel,
} from './labels.ts';

const n = formatInteger;

const VISIT_SERIES: Series[] = [
  { key: 'external', label: 'Externos', color: 'var(--series-1)' },
  { key: 'admin', label: 'Administrativos', color: 'var(--series-2)' },
];
const CUMULATIVE_SERIES: Series[] = [
  { key: 'visits', label: 'Acessos', color: 'var(--series-1)' },
  { key: 'imports', label: 'Arquivos importados', color: 'var(--series-2)' },
  { key: 'exports', label: 'Exportações', color: 'var(--series-3)' },
];

export function MetricsApp() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    panelApi.me().then(setMe, () => {
      setMe(null);
    });
  }, []);

  if (me === undefined) return <p className="dk-m-loading">Carregando…</p>;
  if (me === null) {
    return (
      <Login
        onDone={() => {
          panelApi.me().then(setMe, () => {
            setMe(null);
          });
        }}
      />
    );
  }
  return (
    <Dashboard
      me={me}
      onLogout={() => {
        void panelApi.logout().finally(() => {
          setMe(null);
        });
      }}
      onExpired={() => {
        setMe(null);
      }}
    />
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    panelApi.login(user, password).then(
      () => {
        setPassword('');
        onDone();
      },
      (err: unknown) => {
        setBusy(false);
        setError(err instanceof PanelError ? err.message : 'Não foi possível entrar.');
      },
    );
  };

  return (
    <main className="dk-m-login">
      <form onSubmit={submit} aria-labelledby="dk-m-login-title">
        <h1 id="dk-m-login-title">
          DataKit <span>Métricas de uso</span>
        </h1>
        <label>
          Usuário
          <input
            autoComplete="username"
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
            }}
            required
            autoFocus
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            required
          />
        </label>
        {error && (
          <p className="dk-m-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

function Dashboard({
  me,
  onLogout,
  onExpired,
}: {
  me: Me;
  onLogout: () => void;
  onExpired: () => void;
}) {
  const [period, setPeriod] = useState<Period>('30d');
  const [view, setView] = useState<View>('community');
  const [data, setData] = useState<Summary | undefined>();
  const [error, setError] = useState('');

  const handle = useCallback(
    (err: unknown) => {
      if (err instanceof PanelError && err.status === 401) onExpired();
      else setError(err instanceof Error ? err.message : 'Não foi possível carregar.');
    },
    [onExpired],
  );

  useEffect(() => {
    let alive = true;
    panelApi.summary(period, view).then((s) => {
      if (!alive) return;
      setData(s);
      setError('');
    }, handle);
    return () => {
      alive = false;
    };
  }, [period, view, handle]);

  const c = data?.cards;
  const viewName = view === 'community' ? 'comunidade' : 'administrador';

  return (
    <div className="dk-m-page">
      <header className="dk-m-header">
        <h1>
          DataKit <span>Métricas de uso</span>
        </h1>
        <div className="dk-m-controls" role="group" aria-label="Filtros do painel">
          <label>
            Período
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value as Period);
              }}
            >
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <option key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <div className="dk-m-toggle" role="radiogroup" aria-label="Visão">
            {(['community', 'admin'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => {
                  setView(v);
                }}
              >
                {v === 'community' ? 'Comunidade' : 'Administrador'}
              </button>
            ))}
          </div>
          <a className="dk-m-button" href={panelApi.reportUrl(period, view, 'csv')} download>
            Baixar relatório (CSV)
          </a>
          <a className="dk-m-button" href={panelApi.reportUrl(period, view, 'json')} download>
            JSON
          </a>
          <button type="button" className="dk-m-button" onClick={onLogout}>
            Sair
          </button>
        </div>
      </header>

      <section className="dk-m-notes" aria-label="Avisos">
        <p>
          {data?.since
            ? `Registrando desde ${dateOf(data.since)}, às ${timeOf(data.since)}. Não existem dados anteriores.`
            : 'Ainda não há nenhum registro.'}
        </p>
        {!me.recording && (
          <p className="dk-m-warning" role="alert">
            O registro está desligado: falta METRICS_HMAC_KEY no servidor.
          </p>
        )}
        <p>
          Para seus testes não contarem como uso externo, faça login aqui antes de usar o editor
          neste navegador.
        </p>
      </section>

      {error && (
        <p className="dk-m-error" role="alert">
          {error}
        </p>
      )}

      {c && (
        <>
          <section className="dk-m-cards" aria-label={`Totais: ${PERIOD_LABELS[period]}`}>
            <Card label="Acessos (total)" value={c.visitsTotal} note="externos + administrativos" />
            <Card label="Acessos externos" value={c.visitsExternal} />
            <Card
              label={view === 'community' ? 'Origens externas distintas' : 'Origens distintas'}
              value={c.distinctOrigins}
              note={c.distinctOriginsIsDailySum ? 'soma por dia' : undefined}
            />
            <Card label="Arquivos importados" value={c.filesImported} />
            <Card label="Arquivos exportados" value={c.filesExported} />
            <Card
              label="Sessões completas"
              value={c.completeSessions}
              note={
                c.filesImported > 0
                  ? `${String(Math.round((c.completeSessions / c.filesImported) * 100))}% importaram e exportaram`
                  : 'importaram e exportaram'
              }
            />
            <Card label="Operações realizadas" value={c.operations} />
          </section>
          <p className="dk-m-caption">
            {PERIOD_LABELS[period]} · visão: {viewName}.
            {c.distinctOriginsIsDailySum &&
              ' Em "todo o período", as origens distintas são somadas dia a dia, porque os identificadores são apagados depois de 30 dias.'}
          </p>

          <section className="dk-m-grid2">
            <StackedColumns
              title="Acessos por dia"
              days={data.charts.visitsPerDay.map((d) => d.day)}
              series={VISIT_SERIES}
              values={data.charts.visitsPerDay.map((d) => [d.external, d.admin])}
            />
            <Lines
              title={`Evolução acumulada (${viewName})`}
              days={data.charts.cumulative.map((d) => d.day)}
              series={CUMULATIVE_SERIES}
              values={data.charts.cumulative.map((d) => [d.visits, d.imports, d.exports])}
            />
            <Bars
              title="Formatos importados"
              items={data.charts.importFormats}
              label={formatLabel}
            />
            <Bars
              title="Formatos exportados"
              items={data.charts.exportFormats}
              label={formatLabel}
            />
            <Bars
              title="Conversões (origem → destino)"
              items={data.charts.conversions}
              label={conversionLabel}
            />
            <Bars title="Ferramentas mais usadas" items={data.charts.tools} label={toolLabel} />
          </section>
        </>
      )}

      <VisitsTable retentionDays={me.retentionDays} onError={handle} />
      <EventsTable retentionDays={me.retentionDays} onError={handle} />
    </div>
  );
}

function Card({ label, value, note }: { label: string; value: number; note?: string | undefined }) {
  return (
    <div className="dk-m-card">
      <span className="dk-m-card-label">{label}</span>
      <span className="dk-m-card-value">{n(value)}</span>
      {note && <span className="dk-m-card-note">{note}</span>}
    </div>
  );
}

function Pager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="dk-m-pager">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => {
          onPage(page - 1);
        }}
      >
        Anterior
      </button>
      <span>
        Página {n(page)} de {n(pages)} · {n(total)} registros
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => {
          onPage(page + 1);
        }}
      >
        Próxima
      </button>
    </div>
  );
}

function ClassFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label>
      Classificação
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        <option value="">Todas</option>
        <option value="external">Externo</option>
        <option value="admin">Administrativo</option>
      </select>
    </label>
  );
}

function VisitsTable({
  retentionDays,
  onError,
}: {
  retentionDays: number;
  onError: (err: unknown) => void;
}) {
  const [page, setPage] = useState(1);
  const [classification, setClassification] = useState('');
  const [data, setData] = useState<Page<VisitRow> | undefined>();

  useEffect(() => {
    let alive = true;
    panelApi.visits(page, classification || undefined).then((d) => {
      if (alive) setData(d);
    }, onError);
    return () => {
      alive = false;
    };
  }, [page, classification, onError]);

  return (
    <section className="dk-m-table-section" aria-labelledby="dk-m-visits">
      <div className="dk-m-table-head">
        <h2 id="dk-m-visits">Histórico de acessos</h2>
        <span className="dk-m-muted">últimos {retentionDays} dias · IP parcialmente oculto</span>
        <ClassFilter
          value={classification}
          onChange={(v) => {
            setClassification(v);
            setPage(1);
          }}
        />
      </div>
      <table className="dk-m-table">
        <thead>
          <tr>
            <th>IP (mascarado)</th>
            <th>Data</th>
            <th>Horário</th>
            <th>Classificação</th>
          </tr>
        </thead>
        <tbody>
          {data?.rows.map((r, i) => (
            <tr key={`${r.at}-${String(i)}`}>
              <td className="dk-m-mono">{r.maskedIp ?? '—'}</td>
              <td>{dateOf(r.at)}</td>
              <td>{timeOf(r.at)}</td>
              <td>{classLabel(r.classification)}</td>
            </tr>
          ))}
          {data?.rows.length === 0 && (
            <tr>
              <td colSpan={4} className="dk-m-empty">
                Nenhum acesso registrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {data && (
        <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
      )}
    </section>
  );
}

function EventsTable({
  retentionDays,
  onError,
}: {
  retentionDays: number;
  onError: (err: unknown) => void;
}) {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [format, setFormat] = useState('');
  const [ok, setOk] = useState('');
  const [classification, setClassification] = useState('');
  const [data, setData] = useState<Page<EventRow> | undefined>();

  useEffect(() => {
    let alive = true;
    panelApi
      .events({
        page,
        type: type || undefined,
        format: format || undefined,
        ok: ok || undefined,
        classification: classification || undefined,
      })
      .then((d) => {
        if (alive) setData(d);
      }, onError);
    return () => {
      alive = false;
    };
  }, [page, type, format, ok, classification, onError]);

  const reset =
    (set: (v: string) => void) =>
    (e: React.ChangeEvent<HTMLSelectElement>): void => {
      set(e.target.value);
      setPage(1);
    };

  return (
    <section className="dk-m-table-section" aria-labelledby="dk-m-events">
      <div className="dk-m-table-head">
        <h2 id="dk-m-events">Histórico de operações</h2>
        <span className="dk-m-muted">últimos {retentionDays} dias</span>
        <label>
          Tipo
          <select value={type} onChange={reset(setType)}>
            <option value="">Todos</option>
            <option value="import">Importação</option>
            <option value="edit">Edição</option>
            <option value="export">Exportação</option>
          </select>
        </label>
        <label>
          Formato
          <select value={format} onChange={reset(setFormat)}>
            <option value="">Todos</option>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <label>
          Resultado
          <select value={ok} onChange={reset(setOk)}>
            <option value="">Todos</option>
            <option value="true">Sucesso</option>
            <option value="false">Falha</option>
          </select>
        </label>
        <ClassFilter
          value={classification}
          onChange={(v) => {
            setClassification(v);
            setPage(1);
          }}
        />
      </div>
      <table className="dk-m-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Horário</th>
            <th>Origem (mascarada)</th>
            <th>Operação</th>
            <th>Formato de origem</th>
            <th>Formato de destino</th>
            <th>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {data?.rows.map((r, i) => (
            <tr key={`${r.at}-${String(i)}`}>
              <td>{dateOf(r.at)}</td>
              <td>{timeOf(r.at)}</td>
              <td className="dk-m-mono">
                {r.maskedIp ?? '—'}
                {r.classification !== 'external' && (
                  <span className="dk-m-muted"> · {classLabel(r.classification)}</span>
                )}
              </td>
              <td>
                {typeLabel(r.type)}
                {r.type === 'edit' && r.operation && ` · ${toolLabel(r.operation)}`}
              </td>
              <td>{formatLabel(r.sourceFormat)}</td>
              <td>{formatLabel(r.targetFormat)}</td>
              <td className={r.ok ? undefined : 'dk-m-fail'}>
                {r.ok ? 'Sucesso' : `Falha${r.errorCode ? ` (${r.errorCode})` : ''}`}
              </td>
            </tr>
          ))}
          {data?.rows.length === 0 && (
            <tr>
              <td colSpan={7} className="dk-m-empty">
                Nenhuma operação registrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {data && (
        <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
      )}
    </section>
  );
}
