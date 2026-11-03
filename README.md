# DataKit — Structured Data Editor

Editor web para importar, visualizar, editar, limpar e converter arquivos CSV, XLSX e JSON direto no navegador, sem cadastro.
Endereço oficial: https://datakit.rking.com.br

> **Estado atual:** Etapa 2 concluída (estrutura inicial e esqueleto do layout). Importação, edição e exportação ainda não existem.
> Especificação: [`docs/SPEC.md`](docs/SPEC.md) · Plano: [`docs/PLANO.md`](docs/PLANO.md) · Decisões: [`docs/DECISOES.md`](docs/DECISOES.md)

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

| Comando             | O que faz                                                                |
| ------------------- | ------------------------------------------------------------------------ |
| `npm run dev`       | API + frontend em modo de desenvolvimento                                |
| `npm run build`     | Compila `core`, `api` e `web` (nessa ordem)                              |
| `npm start`         | Roda o build de produção (Express servindo API e frontend)               |
| `npm test`          | Testes de unidade e integração (Vitest)                                  |
| `npm run test:e2e`  | Build + testes de ponta a ponta (Playwright: Chromium, Firefox e WebKit) |
| `npm run lint`      | ESLint                                                                   |
| `npm run typecheck` | Verificação de tipos de todos os pacotes                                 |
| `npm run format`    | Prettier                                                                 |
| `npm run check`     | Formatação, lint, tipos, testes e build, em sequência                    |

Navegadores do Playwright: `npx playwright install chromium firefox webkit`.
Para rodar só alguns: `npx playwright test --project=chromium --project=webkit`.

## Estrutura

```
apps/web        React + TypeScript + Vite (interface)
apps/api        Node.js + Express + Prisma/SQLite (sessões, parsing final, exportação)
packages/core   TypeScript puro, sem DOM e sem Node: regras compartilhadas entre navegador e servidor
e2e/            Testes Playwright
scripts/        dev.mjs (API + Vite juntos), e2e-server.mjs (servidor dos testes E2E)
docs/           Especificação, plano, decisões e (Etapa 10) publicação
```

Em desenvolvimento, `@datakit/core` é usado direto do código-fonte (condição `source` no Node, alias no Vite/Vitest). No build de produção, a API usa o `dist` do core.

## Banco de dados

SQLite via Prisma 7 com o adaptador `better-sqlite3`. A URL vem de `DATABASE_URL` (veja `.env.example`) e é lida por `apps/api/prisma.config.ts`.
Na inicialização a API liga WAL, `secure_delete` e `auto_vacuum` incremental (`apps/api/src/persistence/pragmas.ts`).

```bash
npm run db:migrate -w @datakit/api        # aplica migrations (deploy)
npm run db:migrate:dev -w @datakit/api    # cria uma migration nova a partir do schema
```
