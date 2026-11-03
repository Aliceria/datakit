import { useEffect, useId, useRef, type ReactNode } from 'react';
import './Modal.css';

type Props = {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  /** Enter confirma (fora de campos de texto e de botões). */
  onEnter?: () => void;
  wide?: boolean;
};

/** Diálogo modal: foco preso dentro dele, Esc fecha e o foco volta para onde estava. */
export function Modal({ title, children, footer, onClose, onEnter, wide = false }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current;
    first?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const target = event.target as HTMLElement;
    if (
      event.key === 'Enter' &&
      onEnter &&
      !['BUTTON', 'SELECT', 'TEXTAREA', 'INPUT'].includes(target.tagName)
    ) {
      event.preventDefault();
      onEnter();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = ref.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  return (
    <div className="dk-modal-backdrop">
      <div
        ref={ref}
        className={wide ? 'dk-modal is-wide' : 'dk-modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="dk-modal-title">
          {title}
        </h2>
        <div className="dk-modal-body">{children}</div>
        <div className="dk-modal-footer">{footer}</div>
      </div>
    </div>
  );
}
