# DataKit — Structured Data Editor

Editor web para importar, visualizar, editar, limpar e converter arquivos CSV, XLSX e JSON direto no navegador, sem cadastro.
Endereço oficial: https://datakit.rking.com.br

> **Estado atual:** importação de CSV, XLSX e JSON, grade editável (seleção, teclado, copiar e colar, linhas e colunas, desfazer e refazer persistentes) sessão temporária completa, filtros, ordenação, busca e substituição, tratamento de dados, inspetores de coluna e de célula e exportação para CSV, XLSX e JSON.

## Requisitos

- Node.js 24 ou mais novo (desenvolvido com Node 26.6)
- npm 11

## Primeiros passos

```bash
npm install
```

O npm 11 só roda scripts de instalação de pacotes liberados em `allowScripts` no `package.json` (`better-sqlite3`, `prisma`, `@prisma/engines`).

```bash
npm run dev
```

Sobe a API em http://127.0.0.1:3000 (aplica as migrations antes) e o Vite em http://localhost:5173, com proxy de `/api` para a API. O banco de desenvolvimento fica em `data/datakit.db`.

## Scripts

| Comando             | O que faz                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`       | API + frontend em modo de desenvolvimento                                                    |
| `npm run build`     | Compila `core`, `api` e `web` (nessa ordem)                                                  |
| `npm start`         | Roda o build de produção (Express servindo API e frontend)                                   |
| `npm test`          | Testes de unidade e integração (Vitest)                                                      |
| `npm run test:e2e`  | Build + testes de ponta a ponta (Playwright: Chromium, Firefox e WebKit)                     |
| `npm run test:perf` | Build + testes de desempenho isolados com 100.000 linhas, com as metas da seção 13 sem folga |
| `npm run lint`      | ESLint                                                                                       |
| `npm run typecheck` | Verificação de tipos de todos os pacotes                                                     |
| `npm run format`    | Prettier                                                                                     |
| `npm run check`     | Formatação, lint, tipos, testes e build, em sequência                                        |

Fixtures: `node scripts/generate-fixtures.ts` recria os pequenos; com `--large`, também o CSV de 100.000 linhas (o Playwright gera esse sozinho se faltar).

Navegadores do Playwright: `npx playwright install chromium firefox webkit`.
Para rodar só alguns: `npx playwright test --project=chromium --project=webkit`.

## Estrutura

```
apps/web        React + TypeScript + Vite (interface)
apps/api        Node.js + Express + Prisma/SQLite (sessões, parsing final, exportação)
packages/core   TypeScript puro, sem DOM e sem Node: regras compartilhadas entre navegador e servidor
e2e/            Testes Playwright
fixtures/       Arquivos de teste (CSV, XLSX, JSON, inválidos); os grandes ficam em fixtures/large, fora do git
scripts/        dev.mjs (API + Vite juntos), e2e-server.mjs (servidor dos E2E), generate-fixtures.ts
```

Em desenvolvimento, `@datakit/core` é usado direto do código-fonte (condição `source` no Node, alias no Vite/Vitest). No build de produção, a API usa o `dist` do core.

## Banco de dados

SQLite via Prisma 7 com o adaptador `better-sqlite3`. A URL vem de `DATABASE_URL` (veja `.env.example`) e é lida por `apps/api/prisma.config.ts`.
Na inicialização a API liga WAL, `secure_delete` e `auto_vacuum` incremental (`apps/api/src/persistence/pragmas.ts`).

```bash
npm run db:migrate -w @datakit/api        # aplica migrations (deploy)
npm run db:migrate:dev -w @datakit/api    # cria uma migration nova a partir do schema
```

## Métricas de uso

A API registra metadados de uso para o painel `/metrics`: acessos ao editor (um por origem a cada 10 minutos), importações, edições (pela ferramenta usada), desfazer, refazer e exportações, com formato e resultado. Não registra conteúdo, nome de arquivo, nome de coluna nem linhas. O IP fica só como HMAC e mascarado, e os dois são apagados depois de `METRICS_RETENTION_DAYS` dias (no máximo 30). O que fica depois disso são os totais por dia.

O registro só liga com `METRICS_HMAC_KEY` no `.env`, e só em produção um acesso conta como externo. O IP real vem do `TRUST_PROXY`. O código fica em `apps/api/src/metrics/`.

As consultas do painel ficam em `/api/metrics/admin/*` e exigem login com `METRICS_ADMIN_USER` e `METRICS_ADMIN_PASSWORD`. Sem os dois no `.env`, o painel não existe. O login fica num cookie `HttpOnly` que vale 12 horas, e são aceitas 5 tentativas erradas a cada 15 minutos.

O painel é uma página separada do editor (`apps/web/metrics.html`, código em `apps/web/src/metrics/`), servida em `/metrics`. Para os seus testes não contarem como uso externo, faça login no painel antes de usar o editor no mesmo navegador. A Ajuda do editor explica aos usuários o que é coletado.

## Integração contínua

O GitHub Actions (`.github/workflows/ci.yml`) roda a cada envio para `main` e em pull requests: `npm run check` e os testes de ponta a ponta em Chromium, Firefox e WebKit.
