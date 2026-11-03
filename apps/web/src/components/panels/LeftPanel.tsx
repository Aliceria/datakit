import { PanelSection } from '../common/PanelSection.tsx';
import './Panel.css';

type Props = { open: boolean };

// Conteúdo das seções: Etapa 3 (informações do arquivo) e Etapa 7 (inspetores).
export function LeftPanel({ open }: Props) {
  return (
    <aside
      id="dk-left-panel"
      className={open ? 'dk-panel dk-panel-left is-open' : 'dk-panel dk-panel-left'}
      aria-label="Informações e inspetores"
    >
      <PanelSection title="Informações do arquivo">
        <p className="dk-section-empty">Nenhum arquivo aberto.</p>
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
