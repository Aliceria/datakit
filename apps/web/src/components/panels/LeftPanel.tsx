import { PanelSection } from '../common/PanelSection.tsx';
import { FileInfo } from './FileInfo.tsx';
import './Panel.css';

type Props = { open: boolean };

// Inspetores de coluna e de célula: Etapa 7.
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
        <p className="dk-section-empty">Nenhuma coluna selecionada.</p>
      </PanelSection>
      <PanelSection title="Inspetor de célula">
        <p className="dk-section-empty">Nenhuma célula selecionada.</p>
      </PanelSection>
    </aside>
  );
}
