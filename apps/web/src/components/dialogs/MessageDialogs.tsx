import { continueInNewSession, leaveExpired } from '../../session/sessionManager.ts';
import { appStore, useApp } from '../../state/appStore.ts';
import { Modal } from './Modal.tsx';

/** Erros e avisos (ex.: avisos da importação). */
export function MessageDialog() {
  const message = useApp((s) => s.message);
  if (!message) return null;
  const close = () => {
    appStore.set({ message: undefined });
  };
  return (
    <Modal
      title={message.title}
      onClose={close}
      onEnter={close}
      footer={
        <button type="button" className="dk-button is-primary" onClick={close} data-autofocus>
          OK
        </button>
      }
    >
      {message.lines.length === 1 ? (
        <p className={`dk-message-single dk-tone-${message.tone}`}>{message.lines[0]}</p>
      ) : (
        <ul className="dk-message-list">
          {message.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function ConfirmDialog() {
  const confirm = useApp((s) => s.confirm);
  if (!confirm) return null;
  const cancel = () => {
    appStore.set({ confirm: undefined });
  };
  return (
    <Modal
      title={confirm.title}
      onClose={cancel}
      footer={
        <>
          <button type="button" className="dk-button" onClick={cancel} data-autofocus>
            Cancelar
          </button>
          <button type="button" className="dk-button is-danger" onClick={confirm.onConfirm}>
            {confirm.confirmLabel}
          </button>
        </>
      }
    >
      <p className="dk-message-single">{confirm.message}</p>
    </Modal>
  );
}

/** Sessão expirou com a aba aberta e os dados ainda na memória (L14). */
export function ExpiredDialog() {
  const expired = useApp((s) => s.expired);
  if (!expired) return null;
  return (
    <Modal
      title="Sessão expirada"
      // Esc não descarta os dados da memória: isso exige escolher um dos botões.
      onClose={() => undefined}
      footer={
        <>
          <button type="button" className="dk-button" onClick={leaveExpired}>
            Voltar à tela inicial
          </button>
          {expired.canRestore && (
            <button
              type="button"
              className="dk-button is-primary"
              onClick={() => void continueInNewSession()}
              data-autofocus
            >
              Continuar em uma nova sessão
            </button>
          )}
        </>
      }
    >
      <p className="dk-message-single">
        A sessão expirou e os dados temporários foram apagados do servidor. Esta aba ainda tem os
        dados na memória: dá para continuar trabalhando com eles numa sessão nova.
      </p>
    </Modal>
  );
}
