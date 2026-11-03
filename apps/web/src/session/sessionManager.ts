import { SESSION_TIMING, emptyHistory, encodeDocument, serializeMarks } from '@datakit/core';
import {
  ApiError,
  forkSession,
  getSessionToken,
  restoreSession,
  resumeSession,
  sendHeartbeat,
  sendRelease,
  setSessionToken,
} from '../api/client.ts';
import { appStore, showError, type SessionStatus } from '../state/appStore.ts';
import { loadDocument } from '../state/importFlow.ts';
import { hasPending, pendingOps, retrySoon, stopQueue, type QueueEvents } from './opQueue.ts';
import {
  acquireTabLock,
  announce,
  anotherTabHas,
  releaseTabLock,
  tokenHash,
} from './tabIdentity.ts';
import { clearViewState, flushViewState } from './viewState.ts';

// Ciclo de vida da sessão no navegador (docs/PLANO.md, seção 5). Cada caso da tabela 5.1:
// - F5 / Ctrl+Shift+T: token no sessionStorage, lock livre, ninguém responde → retomar.
// - Duplicar aba: o navegador copiou o token; outra aba segura o lock ou responde → copiar (fork).
// - Fechar: pagehide manda o beacon de exclusão agendada; ninguém retoma → apagada no prazo.
// - Travar: sem heartbeat → expira por inatividade no servidor.
// - Expirada: mensagem clara; com dados na memória, oferece "Continuar em uma nova sessão" (L14).

const RETRY_MAX_MS = 30_000;

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 1000;

function setStatus(sessionStatus: SessionStatus): void {
  appStore.set({ sessionStatus });
}

/** "Salvo" só quando a fila de operações está vazia. */
const syncedStatus = (): SessionStatus => (hasPending() ? 'saving' : 'saved');

/** Esta aba passa a ser a dona do token: segura o lock e responde no canal. */
async function claim(token: string): Promise<void> {
  const hash = await tokenHash(token);
  await acquireTabLock(hash, 0);
  announce(hash);
}

function forget(): void {
  stopHeartbeat();
  releaseTabLock();
  announce(undefined);
}

// --- Heartbeat --------------------------------------------------------------------------------

function startHeartbeat(): void {
  stopHeartbeat();
  // O navegador espaça timers de abas em segundo plano; o prazo de 2 h tem folga de sobra.
  heartbeatTimer = setInterval(() => void beat(), SESSION_TIMING.heartbeatIntervalMs);
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
  if (retryTimer !== undefined) clearTimeout(retryTimer);
  heartbeatTimer = undefined;
  retryTimer = undefined;
}

async function beat(): Promise<void> {
  if (!getSessionToken() || heartbeatTimer === undefined) return;
  try {
    await sendHeartbeat();
    retryDelay = 1000;
    setStatus(syncedStatus());
    // A conexão voltou: a fila tenta de novo na hora.
    retrySoon();
  } catch (err) {
    await handleSessionError(err);
  }
}

/** Erro de qualquer chamada da sessão: rede, expirada ou instância substituída. */
export async function handleSessionError(err: unknown): Promise<boolean> {
  if (!(err instanceof ApiError)) return false;
  if (err.code === 'NETWORK') {
    setStatus('offline');
    if (retryTimer === undefined && heartbeatTimer !== undefined) {
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void beat();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    }
    return true;
  }
  if (err.code === 'SESSION_EXPIRED') {
    onExpired();
    return true;
  }
  if (err.code === 'INSTANCE_REPLACED') {
    // A mesma sessão foi aberta noutra aba e assumida por ela: esta vira cópia independente.
    await becomeCopy(err.message);
    return true;
  }
  return false;
}

// --- Fila de operações ------------------------------------------------------------------------

export const queueHandlers: QueueEvents = {
  onSaved: () => {
    if (appStore.get().sessionStatus !== 'expired') setStatus('saved');
  },
  onPending: () => {
    const status = appStore.get().sessionStatus;
    if (status !== 'offline' && status !== 'expired') setStatus('saving');
  },
  onSessionError: async (err) => {
    await handleSessionError(err);
  },
  onDiverged: () => {
    void resyncFromServer();
  },
};

/**
 * O servidor e esta aba divergiram (sequência em conflito): o servidor é a fonte da verdade.
 * Recarrega de lá e avisa, em vez de perder dados em silêncio.
 */
async function resyncFromServer(): Promise<void> {
  stopQueue(true);
  try {
    await loadDocument();
    setStatus(syncedStatus());
    appStore.set({
      message: {
        title: 'Dados recarregados do servidor',
        tone: 'warning',
        lines: [
          'Algumas alterações desta aba não chegaram ao servidor e foram desfeitas. ' +
            'Os dados mostrados agora são os que estão salvos.',
        ],
      },
    });
  } catch (err) {
    if (!(await handleSessionError(err))) showError('Não foi possível recarregar', errorText(err));
  }
}

// --- Inicialização ----------------------------------------------------------------------------

/** Ao carregar a página: retomar, copiar (aba duplicada) ou ficar na tela inicial. */
export async function startSession(): Promise<void> {
  const token = getSessionToken();
  if (!token) return;
  appStore.set({ busy: 'Recuperando a sessão…' });
  const hash = await tokenHash(token);
  const [lockFree, otherAnswered] = await Promise.all([acquireTabLock(hash), anotherTabHas(hash)]);

  if (!lockFree || otherAnswered) {
    if (lockFree) releaseTabLock();
    await copyFromCurrent();
    return;
  }

  try {
    announce(hash);
    await resumeSession();
    await loadDocument();
    setStatus(syncedStatus());
    startHeartbeat();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'SESSION_EXPIRED') {
      expiredWithoutData();
      return;
    }
    forget();
    showError('Não foi possível recuperar a sessão', errorText(err));
  }
}

/** Aba duplicada: cria uma sessão nova com cópia dos dados atuais. */
async function copyFromCurrent(): Promise<void> {
  try {
    const copy = await forkSession();
    setSessionToken(copy);
    await claim(copy);
    // A fila copiada do sessionStorage vale para a cópia: o servidor ignora as operações que a
    // aba original já tinha entregado (mesmo opId).
    await loadDocument();
    setStatus(syncedStatus());
    startHeartbeat();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'SESSION_EXPIRED') {
      expiredWithoutData();
      return;
    }
    // Sem cópia, esta aba não pode usar o token da outra: volta à tela inicial.
    stopQueue(true);
    setSessionToken(null);
    clearViewState();
    forget();
    showError('Não foi possível abrir a cópia desta aba', errorText(err));
  }
}

async function becomeCopy(message: string): Promise<void> {
  stopHeartbeat();
  setStatus('saving');
  try {
    const copy = await forkSession();
    setSessionToken(copy);
    await claim(copy);
    setStatus(syncedStatus());
    startHeartbeat();
    // As operações pendentes seguem para a cópia, com a mesma sequência.
    retrySoon();
    appStore.set({
      message: { title: 'Sessão aberta em outra aba', tone: 'info', lines: [message] },
    });
  } catch (err) {
    if (!(await handleSessionError(err))) showError('Não foi possível continuar', errorText(err));
  }
}

/** Depois de uma importação que criou sessão nova (ou substituiu a atual). */
export async function adoptSession(token: string): Promise<void> {
  await claim(token);
  setStatus('saved');
  startHeartbeat();
}

/** "×" do arquivo: a sessão foi apagada no servidor. */
export function endSession(): void {
  forget();
  stopQueue(true);
  setSessionToken(null);
  clearViewState();
  setStatus('none');
}

// --- Expiração --------------------------------------------------------------------------------

function expiredWithoutData(): void {
  forget();
  stopQueue(true);
  setSessionToken(null);
  clearViewState();
  appStore.set({
    busy: undefined,
    doc: undefined,
    activeTableId: undefined,
    selection: undefined,
    editing: undefined,
    sessionStatus: 'none',
    message: {
      title: 'Sessão expirada',
      tone: 'warning',
      lines: [
        'A sessão expirou e os dados temporários foram apagados do servidor. Abra o arquivo novamente.',
      ],
    },
  });
}

function onExpired(): void {
  forget();
  const { doc } = appStore.get();
  if (!doc) {
    expiredWithoutData();
    return;
  }
  appStore.set({
    sessionStatus: 'expired',
    expired: { canRestore: true },
    busy: undefined,
    editing: undefined,
  });
}

/**
 * L14: envia o documento que a aba ainda tem e continua numa sessão nova. As marcas de alteração
 * vão junto (continuam "não exportadas"); o histórico de desfazer recomeça.
 */
export async function continueInNewSession(): Promise<void> {
  const { doc } = appStore.get();
  if (!doc) return;
  appStore.set({ expired: undefined, busy: 'Criando uma nova sessão…', sessionStatus: 'saving' });
  try {
    // O documento enviado já inclui as operações pendentes; a fila antiga não pode ser reaplicada.
    stopQueue(true);
    const encoded = encodeDocument(
      { source: doc.manifest.source, tables: doc.tables, warnings: [] },
      { snapshotSeq: 0, history: emptyHistory(), marks: serializeMarks(doc.marks) },
    );
    const json = new Blob([JSON.stringify(encoded)]);
    const gzipped = await new Response(
      json.stream().pipeThrough(new CompressionStream('gzip')),
    ).blob();
    setSessionToken(null);
    const result = await restoreSession(gzipped);
    if (!result.sessionId) throw new Error('Resposta sem sessão');
    setSessionToken(result.sessionId);
    await adoptSession(result.sessionId);
    await loadDocument();
  } catch (err) {
    appStore.set({ sessionStatus: 'expired', expired: { canRestore: true }, busy: undefined });
    showError('Não foi possível criar a nova sessão', errorText(err));
  }
}

export function leaveExpired(): void {
  stopQueue(true);
  setSessionToken(null);
  clearViewState();
  appStore.set({
    expired: undefined,
    doc: undefined,
    activeTableId: undefined,
    selection: undefined,
    sessionStatus: 'none',
  });
}

// --- Eventos da página ------------------------------------------------------------------------

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Ocorreu um erro inesperado. Tente novamente.';
}

/** Registra pagehide, pageshow e visibilitychange. Chamado uma vez, na inicialização. */
export function installPageLifecycle(): void {
  // Fechar e recarregar são indistinguíveis aqui: os dois agendam a exclusão, e a página nova
  // (se houver) cancela ao retomar (seção 5.2). Não há aviso nativo de "sair do site?".
  // As operações pendentes vão no beacon se couberem; de qualquer forma, estão no sessionStorage.
  window.addEventListener('pagehide', () => {
    flushViewState();
    if (appStore.get().doc && appStore.get().sessionStatus !== 'expired') sendRelease(pendingOps());
  });

  // Volta pelo bfcache: a página não recarregou, então retoma a sessão por conta própria.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || !getSessionToken() || !appStore.get().doc) return;
    void resumeSession()
      .then(() => {
        setStatus(syncedStatus());
        startHeartbeat();
        retrySoon();
      })
      .catch((err: unknown) => handleSessionError(err));
  });

  // Ao voltar para a aba, um sinal imediato: descobre logo se a sessão expirou enquanto ela
  // estava congelada ou em segundo plano.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && heartbeatTimer !== undefined) void beat();
  });
}
