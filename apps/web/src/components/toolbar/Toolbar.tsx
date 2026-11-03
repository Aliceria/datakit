import { FolderOpen, PanelLeft, PanelRight, Redo2, Undo2 } from 'lucide-react';
import { PRODUCT } from '@datakit/core';
import { useApp } from '../../state/appStore.ts';
import { redo, undo } from '../../state/editor.ts';
import { ToolbarButton } from './ToolbarButton.tsx';
import './Toolbar.css';

type Props = {
  drawer: 'left' | 'right' | null;
  onToggleDrawer: (side: 'left' | 'right') => void;
  onOpen: () => void;
};

// Exportar, Ferramentas e Ajuda entram junto com as funcionalidades (Etapas 6 a 8).
export function Toolbar({ drawer, onToggleDrawer, onOpen }: Props) {
  // A revisão muda a cada operação: os rótulos e o estado dos botões acompanham.
  const undoLabel = useApp((s) =>
    s.revision >= 0 && s.sessionStatus !== 'expired'
      ? s.doc?.history.undo.at(-1)?.label
      : undefined,
  );
  const redoLabel = useApp((s) =>
    s.revision >= 0 && s.sessionStatus !== 'expired'
      ? s.doc?.history.redo.at(-1)?.label
      : undefined,
  );
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
      <ToolbarButton
        icon={Undo2}
        label="Desfazer"
        title={undoLabel ? `Desfazer: ${undoLabel} (Ctrl+Z)` : 'Nada para desfazer'}
        disabled={!undoLabel}
        onClick={undo}
      />
      <ToolbarButton
        icon={Redo2}
        label="Refazer"
        title={redoLabel ? `Refazer: ${redoLabel} (Ctrl+Y)` : 'Nada para refazer'}
        disabled={!redoLabel}
        onClick={redo}
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
