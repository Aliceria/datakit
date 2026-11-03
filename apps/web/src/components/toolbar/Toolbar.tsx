import { FolderOpen, PanelLeft, PanelRight } from 'lucide-react';
import { PRODUCT } from '@datakit/core';
import { ToolbarButton } from './ToolbarButton.tsx';
import './Toolbar.css';

type Props = {
  drawer: 'left' | 'right' | null;
  onToggleDrawer: (side: 'left' | 'right') => void;
  onOpen: () => void;
};

// Exportar, Desfazer, Refazer, Ferramentas e Ajuda entram junto com as funcionalidades (Etapas 5 a 8).
export function Toolbar({ drawer, onToggleDrawer, onOpen }: Props) {
  return (
    <header className="dk-toolbar">
      <div className="dk-brand">
        <span className="dk-brand-name">{PRODUCT.name}</span>
        <span className="dk-brand-subtitle">{PRODUCT.subtitle}</span>
      </div>
      <ToolbarButton
        icon={FolderOpen}
        label="Abrir"
        title="Abrir arquivo (Ctrl+O)"
        onClick={onOpen}
      />
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
