import { useCallback, useEffect, useRef, useState } from 'react';
import { SUPPORTED_EXTENSIONS } from '@datakit/core';
import {
  ConfirmDialog,
  ExpiredDialog,
  MessageDialog,
} from './components/dialogs/MessageDialogs.tsx';
import { ToolDialog } from './components/dialogs/ToolDialog.tsx';
import { PreviewDialog } from './components/dialogs/PreviewDialog.tsx';
import { LeftPanel } from './components/panels/LeftPanel.tsx';
import { FOCUS_GOTO_EVENT } from './components/panels/GoTo.tsx';
import { RightPanel } from './components/panels/RightPanel.tsx';
import { FOCUS_SEARCH_EVENT } from './components/panels/SearchReplace.tsx';
import { StatusBar } from './components/statusbar/StatusBar.tsx';
import { Toolbar } from './components/toolbar/Toolbar.tsx';
import { Workspace } from './components/workspace/Workspace.tsx';
import { appStore, showError } from './state/appStore.ts';
import { redo, undo } from './state/editor.ts';
import { openFile } from './state/importFlow.ts';
import './App.css';

type Drawer = 'left' | 'right' | null;

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

export function App() {
  // Abaixo de ~1100 px os painéis viram gavetas; acima disso este estado não tem efeito visual.
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const toggleDrawer = useCallback((side: 'left' | 'right') => {
    setDrawer((current) => (current === side ? null : side));
  }, []);

  const chooseFile = useCallback(() => {
    // Diálogos abertos têm prioridade.
    const { preview, busy } = appStore.get();
    if (preview || busy) return;
    fileInput.current?.click();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drawer !== null) setDrawer(null);
      // Desfazer e refazer (seção 7.2). Dentro de campos de texto, vale o desfazer nativo deles.
      const target = event.target as HTMLElement;
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      const ctrl = event.ctrlKey || event.metaKey;
      const { preview, confirm, message, expired } = appStore.get();
      const dialogOpen =
        preview !== undefined ||
        confirm !== undefined ||
        message !== undefined ||
        expired !== undefined;
      if (ctrl && !inField && !dialogOpen) {
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          undo();
          return;
        }
        if (key === 'y' || (key === 'z' && event.shiftKey)) {
          event.preventDefault();
          redo();
          return;
        }
      }
      // Ctrl+O abre arquivo, no lugar do "abrir" do navegador (seção 7.2).
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        chooseFile();
      }
      // Ctrl+F busca e Ctrl+G ir para (seção 7.2), no lugar dos atalhos do navegador.
      // Abaixo de 1100 px o painel direito é uma gaveta: abre antes de pôr o foco.
      if (ctrl && !dialogOpen && appStore.get().doc) {
        const key = event.key.toLowerCase();
        const target =
          key === 'f' ? FOCUS_SEARCH_EVENT : key === 'g' ? FOCUS_GOTO_EVENT : undefined;
        if (target) {
          event.preventDefault();
          setDrawer((current) => (window.innerWidth < 1100 ? 'right' : current));
          requestAnimationFrame(() => window.dispatchEvent(new Event(target)));
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [drawer, chooseFile]);

  // Arrastar e soltar em qualquer lugar da janela (seção 6.1).
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      if (files.length > 1) {
        showError(
          'Um arquivo por vez',
          'Solte apenas um arquivo. O DataKit abre um arquivo por aba.',
        );
        return;
      }
      const { preview, busy } = appStore.get();
      const file = files[0];
      if (file && !preview && !busy) void openFile(file);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className="dk-app">
      <Toolbar drawer={drawer} onToggleDrawer={toggleDrawer} onOpen={chooseFile} />
      <div className="dk-main">
        <LeftPanel open={drawer === 'left'} />
        <main className="dk-workspace" aria-label="Área de trabalho">
          <Workspace onOpen={chooseFile} />
        </main>
        <RightPanel open={drawer === 'right'} />
        {drawer !== null && (
          <div
            className="dk-drawer-backdrop"
            aria-hidden="true"
            onClick={() => {
              setDrawer(null);
            }}
          />
        )}
      </div>
      <StatusBar />
      <input
        ref={fileInput}
        type="file"
        accept={SUPPORTED_EXTENSIONS.join(',')}
        className="dk-visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void openFile(file);
        }}
      />
      {dragging && <div className="dk-drop-overlay">Solte o arquivo para abrir</div>}
      <PreviewDialog />
      <MessageDialog />
      <ConfirmDialog />
      <ToolDialog />
      <ExpiredDialog />
    </div>
  );
}
