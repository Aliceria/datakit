import { LIMIT_ROWS, STORAGE_NOTICE } from '../workspace/EmptyState.tsx';
import { Modal } from './Modal.tsx';
import './HelpDialog.css';

// Ajuda (seção 11.3): atalhos de teclado, formatos e limites, e o aviso de armazenamento temporário.

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl+O', 'Abrir arquivo'],
  ['Ctrl+S', 'Exportar'],
  ['Ctrl+Z', 'Desfazer'],
  ['Ctrl+Y ou Ctrl+Shift+Z', 'Refazer'],
  ['Ctrl+F', 'Pesquisar e substituir'],
  ['Ctrl+G', 'Ir para linha e coluna'],
  ['Setas, Tab, Shift+Tab', 'Mover a seleção'],
  ['Shift+setas', 'Estender a seleção'],
  ['Ctrl+setas', 'Ir até a borda dos dados'],
  ['Home / End', 'Início ou fim da linha (com Ctrl, da tabela)'],
  ['PageUp / PageDown', 'Uma página para cima ou para baixo'],
  ['Ctrl+A', 'Selecionar tudo'],
  ['Enter ou F2', 'Editar a célula'],
  ['Digitar', 'Substituir o conteúdo da célula'],
  ['Enter / Shift+Enter', 'Confirmar e descer / subir'],
  ['Alt+Enter', 'Quebra de linha dentro da célula'],
  ['Esc', 'Cancelar a edição ou fechar o diálogo'],
  ['Delete', 'Deixar a célula vazia'],
  ['Backspace', 'Apagar e começar a editar'],
  ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copiar, recortar e colar (formato do Excel)'],
  ['Shift+clique na seta', 'Ordenar por mais de uma coluna'],
  ['Clique direito ou Shift+F10', 'Menu da célula, da linha ou da coluna'],
];

type Props = { onClose: () => void };

export function HelpDialog({ onClose }: Props) {
  return (
    <Modal
      title="Ajuda"
      wide
      onClose={onClose}
      footer={
        <button type="button" className="dk-button is-primary" onClick={onClose} data-autofocus>
          Fechar
        </button>
      }
    >
      <div className="dk-help">
        <section aria-labelledby="dk-help-keys">
          <h3 id="dk-help-keys" className="dk-tools-title">
            Atalhos de teclado
          </h3>
          <dl className="dk-help-list">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="dk-help-row">
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="dk-help-limits">
          <h3 id="dk-help-limits" className="dk-tools-title">
            Formatos e limites
          </h3>
          <dl className="dk-help-list">
            {LIMIT_ROWS.map(([label, value]) => (
              <div key={label} className="dk-help-row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3 className="dk-tools-title">Armazenamento temporário</h3>
          <p className="dk-help-notice">{STORAGE_NOTICE}</p>
          <p className="dk-help-notice">
            Não há cadastro. A sessão é desta aba: outra aba abre uma sessão separada, e o F5 volta
            ao mesmo ponto.
          </p>
          <h3 className="dk-tools-title">Privacidade e estatísticas de uso</h3>
          <p className="dk-help-notice">
            Para medir o uso do projeto, o DataKit registra dados de acesso e de uso: quando o
            editor foi aberto, a origem de rede (o IP com o final oculto e um código que não permite
            recuperá-lo), o formato e o tamanho dos arquivos abertos, as ferramentas usadas e os
            formatos exportados.
          </p>
          <p className="dk-help-notice">
            O conteúdo dos arquivos, os nomes dos arquivos e das colunas e as linhas editadas não
            são guardados para as estatísticas. A origem de rede é apagada em até 30 dias; depois
            disso ficam só os totais por dia, sem identificação.
          </p>
        </section>
      </div>
    </Modal>
  );
}
