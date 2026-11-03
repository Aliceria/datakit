import { PanelSection } from '../common/PanelSection.tsx';
import { FiltersSort } from './FiltersSort.tsx';
import { GoTo } from './GoTo.tsx';
import { SearchReplace } from './SearchReplace.tsx';
import './Panel.css';

type Props = { open: boolean };

// A seção "Tratamento de dados" entra com as ferramentas (Etapa 7).
export function RightPanel({ open }: Props) {
  return (
    <aside
      id="dk-right-panel"
      className={open ? 'dk-panel dk-panel-right is-open' : 'dk-panel dk-panel-right'}
      aria-label="Navegação, busca e tratamento"
    >
      <PanelSection title="Ir para">
        <GoTo />
      </PanelSection>
      <PanelSection title="Pesquisar e substituir">
        <SearchReplace />
      </PanelSection>
      <PanelSection title="Filtros e ordenação">
        <FiltersSort />
      </PanelSection>
    </aside>
  );
}
