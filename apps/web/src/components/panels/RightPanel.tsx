import { PanelSection } from '../common/PanelSection.tsx';
import './Panel.css';

type Props = { open: boolean };

// Conteúdo das seções: Etapas 5 a 7.
export function RightPanel({ open }: Props) {
  return (
    <aside
      id="dk-right-panel"
      className={open ? 'dk-panel dk-panel-right is-open' : 'dk-panel dk-panel-right'}
      aria-label="Navegação, busca e tratamento"
    >
      <PanelSection title="Ir para">
        <p className="dk-section-empty">Nenhum arquivo aberto.</p>
      </PanelSection>
      <PanelSection title="Pesquisar e substituir">
        <p className="dk-section-empty">Nenhum arquivo aberto.</p>
      </PanelSection>
      <PanelSection title="Filtros e ordenação">
        <p className="dk-section-empty">Nenhum filtro ativo.</p>
      </PanelSection>
      <PanelSection title="Tratamento de dados">
        <p className="dk-section-empty">Nenhum arquivo aberto.</p>
      </PanelSection>
    </aside>
  );
}
