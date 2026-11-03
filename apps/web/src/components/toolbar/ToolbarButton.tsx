import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> & {
  icon: LucideIcon;
  label: string;
};

/** Botão grande da barra: ícone de ~24 px com rótulo pequeno embaixo (seção 11.1). */
export function ToolbarButton({ icon: Icon, label, className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={className ? `dk-toolbar-button ${className}` : 'dk-toolbar-button'}
      {...rest}
    >
      <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
      <span className="dk-toolbar-button-label">{label}</span>
    </button>
  );
}
