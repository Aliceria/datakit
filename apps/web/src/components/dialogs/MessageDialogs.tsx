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
