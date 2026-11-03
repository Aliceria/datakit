// Log estruturado em JSON por linha (journald/PM2 capturam a saída padrão).
// Regra da seção 12: nunca registrar conteúdo de arquivos nem IDs de sessão completos.

type Fields = Record<string, string | number | boolean | undefined>;

function write(level: 'info' | 'warn' | 'error', message: string, fields?: Fields): void {
  if (process.env['NODE_ENV'] === 'test' && level === 'info') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, message, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const log = {
  info: (message: string, fields?: Fields) => {
    write('info', message, fields);
  },
  warn: (message: string, fields?: Fields) => {
    write('warn', message, fields);
  },
  error: (message: string, fields?: Fields) => {
    write('error', message, fields);
  },
};
