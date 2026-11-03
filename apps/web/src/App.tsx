import { useCallback, useEffect, useState } from 'react';
import { LeftPanel } from './components/panels/LeftPanel.tsx';
import { RightPanel } from './components/panels/RightPanel.tsx';
import { StatusBar } from './components/statusbar/StatusBar.tsx';
import { Toolbar } from './components/toolbar/Toolbar.tsx';
import { EmptyState } from './components/workspace/EmptyState.tsx';
import './App.css';

type Drawer = 'left' | 'right' | null;

export function App() {
  // Abaixo de ~1100 px os painéis viram gavetas; acima disso este estado não tem efeito visual.
  const [drawer, setDrawer] = useState<Drawer>(null);

  const toggleDrawer = useCallback((side: 'left' | 'right') => {
    setDrawer((current) => (current === side ? null : side));
  }, []);

  useEffect(() => {
    if (drawer === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [drawer]);

  return (
    <div className="dk-app">
      <Toolbar drawer={drawer} onToggleDrawer={toggleDrawer} />
      <div className="dk-main">
        <LeftPanel open={drawer === 'left'} />
        <main className="dk-workspace" aria-label="Área de trabalho">
          <EmptyState />
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
    </div>
  );
}
