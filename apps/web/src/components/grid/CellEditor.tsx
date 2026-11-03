import { useLayoutEffect, useRef, useState } from 'react';

export type EditorMove = 'down' | 'up' | 'right' | 'left' | 'none';

type Props = {
  left: number;
  top: number;
  width: number;
  height: number;
  initial: string;
  /** Começou digitando (substitui o valor): o cursor vai para o fim. */
  replace: boolean;
  onCommit: (text: string, move: EditorMove) => void;
  onCancel: () => void;
};

/**
 * Editor de célula (seção 7.2). Enter confirma e desce; Shift+Enter sobe; Tab vai para a direita;
 * Esc cancela; Alt+Enter insere uma quebra de linha. Clicar fora confirma.
 */
export function CellEditor({
  left,
  top,
  width,
  height,
  initial,
  replace,
  onCommit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  // Foco já no commit (não depois da pintura): quem digita rápido não perde as teclas seguintes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    if (replace) el.setSelectionRange(end, end);
    else el.select();
  }, [replace]);

  const finish = (move: EditorMove) => {
    if (done.current) return;
    done.current = true;
    onCommit(ref.current?.value ?? value, move);
  };

  return (
    <textarea
      ref={ref}
      className="dk-cell-editor"
      aria-label="Editar célula"
      spellCheck={false}
      value={value}
      style={{ left, top, width: Math.max(width, 120), minHeight: height }}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      onBlur={() => {
        finish('none');
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          done.current = true;
          onCancel();
        } else if (e.key === 'Enter' && e.altKey) {
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: s, selectionEnd: t } = el;
          const next = `${el.value.slice(0, s)}\n${el.value.slice(t)}`;
          setValue(next);
          requestAnimationFrame(() => {
            el.setSelectionRange(s + 1, s + 1);
          });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.shiftKey ? 'up' : 'down');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(e.shiftKey ? 'left' : 'right');
        }
      }}
    />
  );
}
