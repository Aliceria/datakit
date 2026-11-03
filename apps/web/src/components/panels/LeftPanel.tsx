import { PanelSection } from '../common/PanelSection.tsx';
import { FileInfo } from './FileInfo.tsx';
import { CellInspector, ColumnInspector } from './Inspectors.tsx';
import './Panel.css';

type Props = { open: boolean };

export function LeftPanel({ open }: Props) {
  return (
    <aside
      id="dk-left-panel"
      className={open ? 'dk-panel dk-panel-left is-open' : 'dk-panel dk-panel-left'}
      aria-label="Informações e inspetores"
    >
      <PanelSection title="Informações do arquivo">
        <FileInfo />
      </PanelSection>
      <PanelSection title="Inspetor de coluna">
        <ColumnInspector />
      </PanelSection>
      <PanelSection title="Inspetor de célula">
        <CellInspector />
      </PanelSection>
    </aside>
  );
}
