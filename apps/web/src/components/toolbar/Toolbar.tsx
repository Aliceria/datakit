import { useState } from 'react';
import {
  CircleHelp,
  Download,
  FolderOpen,
  PanelLeft,
  PanelRight,
  Redo2,
  Undo2,
  Wrench,
} from 'lucide-react';
import { PRODUCT } from '@datakit/core';
import { activeTable, appStore, useApp } from '../../state/appStore.ts';
import {
  COLUMN_TOOLS,
  identifyInconsistent,
  locateBlanks,
  openTool,
  TOOL_TITLES,
} from '../../state/tools.ts';
import { ContextMenu, type MenuItem } from '../common/ContextMenu.tsx';
import { HelpDialog } from '../dialogs/HelpDialog.tsx';
import { redo, undo } from '../../state/editor.ts';
import { openExport } from '../../state/exportFlow.ts';
import { ToolbarButton } from './ToolbarButton.tsx';
import './Toolbar.css';

type Props = {
  drawer: 'left' | 'right' | null;
  onToggleDrawer: (side: 'left' | 'right') => void;
  onOpen: () => void;
};

/** Itens do menu Ferramentas (seção 8); os mesmos da seção "Tratamento de dados". */
function toolItems(): MenuItem[] {
  const state = appStore.get();
  const table = activeTable(state);
  const off = !table || state.sessionStatus === 'expired';
  const hasCols = state.selection !== undefined;
  const item = (label: string, onSelect: () => void, disabled = off): MenuItem => ({
    kind: 'item',
    label,
    onSelect,
    disabled,
  });
  return [
    item(`${TOOL_TITLES.duplicates}…`, () => {
      openTool('duplicates');
    }),
    item(`${TOOL_TITLES.emptyRows}…`, () => {
      openTool('emptyRows');
    }),
    item(
      'Localizar vazios',
      () => {
        if (table) locateBlanks(table.id, undefined);
      },
      !table,
    ),
    item(
      'Identificar inconsistentes',
      () => {
        if (table) identifyInconsistent(table.id);
      },
      !table,
    ),
    { kind: 'separator' },
    ...COLUMN_TOOLS.map((kind) =>
      item(
        `${TOOL_TITLES[kind]}…`,
        () => {
          openTool(kind);
        },
        off || !hasCols,
      ),
    ),
  ];
}

export function Toolbar({ drawer, onToggleDrawer, onOpen }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | undefined>(undefined);
  const [help, setHelp] = useState(false);
  const hasDoc = useApp((s) => s.doc !== undefined);
  const canExport = useApp((s) => s.doc !== undefined && s.sessionStatus !== 'expired');
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
        icon={Download}
        label="Exportar"
        title="Exportar para CSV, XLSX ou JSON (Ctrl+S)"
        disabled={!canExport}
        onClick={openExport}
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
      <ToolbarButton
        icon={Wrench}
        label="Ferramentas"
        className="dk-toolbar-wide"
        title="Ferramentas de tratamento de dados"
        aria-haspopup="menu"
        aria-expanded={menu !== undefined}
        disabled={!hasDoc}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom });
        }}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Ferramentas"
          items={toolItems()}
          onClose={() => {
            setMenu(undefined);
          }}
        />
      )}
      <ToolbarButton
        icon={CircleHelp}
        label="Ajuda"
        title="Atalhos, formatos e limites"
        onClick={() => {
          setHelp(true);
        }}
      />
      {help && (
        <HelpDialog
          onClose={() => {
            setHelp(false);
          }}
        />
      )}
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
