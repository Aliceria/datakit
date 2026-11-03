import './StatusBar.css';

// Formato, linhas, seleção e estado da sessão entram nas Etapas 3 e 4.
export function StatusBar() {
  return (
    <footer className="dk-statusbar" role="status">
      <span>Nenhum arquivo aberto</span>
    </footer>
  );
}
