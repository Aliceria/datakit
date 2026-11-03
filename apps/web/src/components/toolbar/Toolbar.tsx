import { PanelLeft, PanelRight } from 'lucide-react';
import { PRODUCT } from '@datakit/core';
import { ToolbarButton } from './ToolbarButton.tsx';
import './Toolbar.css';

type Props = {
  drawer: 'left' | 'right' | null;
  onToggleDrawer: (side: 'left' | 'right') => void;
};

// Os botões de arquivo e edição (Abrir, Exportar, Desfazer…) entram quando funcionarem (Etapas 3 a 8).
export function Toolbar({ drawer, onToggleDrawer }: Props) {
  return (
    <header className="dk-toolbar">
      <div className="dk-brand">
        <span className="dk-brand-name">{PRODUCT.name}</span>
        <span className="dk-brand-subtitle">{PRODUCT.subtitle}</span>
      </div>
      <div className="dk-toolbar-drawers">
        <ToolbarButton
          icon={PanelLeft}
          label="Informações"
          aria-controls="dk-left-panel"
          aria-expanded={drawer === 'left'}
          onClick={() => {
            onToggleDrawer('left');
          }}
        />
        <ToolbarButton
          icon={PanelRight}
          label="Ferramentas"
          aria-controls="dk-right-panel"
          aria-expanded={drawer === 'right'}
          onClick={() => {
            onToggleDrawer('right');
          }}
        />
      </div>
    </header>
  );
}
