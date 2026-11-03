import { useId, useState, type ReactNode } from 'react';
import './PanelSection.css';

type Props = {
  title: string;
  children: ReactNode;
  defaultCollapsed?: boolean;
};

/** Seção de painel: faixa de título centralizada em negrito com botão de recolher à direita (seção 11.1). */
export function PanelSection({ title, children, defaultCollapsed = false }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const bodyId = useId();

  return (
    <section className="dk-section" aria-label={title}>
      <h2 className="dk-section-title">
        <span>{title}</span>
        <button
          type="button"
          className="dk-section-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? `Expandir ${title}` : `Recolher ${title}`}
          onClick={() => {
            setCollapsed((c) => !c);
          }}
        >
          {collapsed ? '+' : '—'}
        </button>
      </h2>
      <div id={bodyId} className="dk-section-body" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
