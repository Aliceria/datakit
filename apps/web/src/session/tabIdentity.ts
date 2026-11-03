// Identidade da aba (docs/PLANO.md, seção 5.1).
// - instanceId: novo a cada carregamento da página; distingue o F5 da página antiga.
// - Web Lock "datakit:<hash do token>": segurado enquanto a página vive. Se outra aba o segura,
//   esta é uma aba duplicada, mesmo que a outra esteja congelada (L12).
// - BroadcastChannel: pergunta "quem usa este token?" (seção 5.2).
// O token nunca circula: lock e canal usam só o hash dele.

export const instanceId: string = crypto.randomUUID();

export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let held: { hash: string; release: () => void } | undefined;

/**
 * Tenta segurar o lock do token. Repete por até `waitMs`: no F5, o lock da página antiga só é
 * solto quando ela é destruída, o que pode acontecer um instante depois de esta começar.
 */
export async function acquireTabLock(hash: string, waitMs = 1000): Promise<boolean> {
  if (held?.hash === hash) return true;
  // Uma aba segura no máximo um lock: o do token que está usando agora.
  if (held) releaseTabLock();
  if (!('locks' in navigator)) return true;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const acquired = await new Promise<boolean>((resolve) => {
      void navigator.locks.request(`datakit:${hash}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        // O lock fica preso até release() ou até a página morrer.
        return new Promise<void>((release) => {
          held = { hash, release };
        });
      });
    });
    if (acquired) return true;
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
}

export function releaseTabLock(): void {
  held?.release();
  held = undefined;
}

type ChannelMessage =
  | { type: 'who-has'; hash: string; nonce: string }
  | { type: 'i-have'; hash: string; nonce: string };

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('datakit') : undefined;
let announcedHash: string | undefined;
const waiting = new Map<string, () => void>();

if (channel) {
  channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
    const msg = event.data;
    if (msg.type === 'who-has' && announcedHash !== undefined && msg.hash === announcedHash) {
      const reply: ChannelMessage = { type: 'i-have', hash: msg.hash, nonce: msg.nonce };
      channel.postMessage(reply);
    } else if (msg.type === 'i-have') {
      waiting.get(msg.nonce)?.();
    }
  };
}

/** Esta aba passa a responder que usa o token (ou para de responder, com undefined). */
export function announce(hash: string | undefined): void {
  announcedHash = hash;
}

/** Pergunta às outras abas abertas se alguma já usa o token. */
export function anotherTabHas(hash: string, waitMs = 300): Promise<boolean> {
  if (!channel) return Promise.resolve(false);
  const nonce = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(nonce);
      resolve(false);
    }, waitMs);
    waiting.set(nonce, () => {
      clearTimeout(timer);
      waiting.delete(nonce);
      resolve(true);
    });
    const ask: ChannelMessage = { type: 'who-has', hash, nonce };
    channel.postMessage(ask);
  });
}
