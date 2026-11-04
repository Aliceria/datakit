import { expect, test, type Page } from '@playwright/test';

// Painel de métricas (/metrics), no servidor próprio dos testes, com banco descartável e fora de
// produção (todo uso é registrado como "Desenvolvimento", nunca como externo).

/** Porta do segundo servidor de playwright.config.ts (METRICS_PORT). */
const PANEL = 'http://127.0.0.1:3101';
const USER = 'admin-e2e';
const PASSWORD = 'senha-do-painel-e2e';

// Uma origem de rede diferente por teste (o servidor confia em um proxy na frente).
test.beforeEach(async ({ page }, info) => {
  const n = (info.workerIndex * 1000 + info.repeatEachIndex * 10 + info.retry) % 250;
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `198.51.${String(info.parallelIndex + 1)}.${String(n + 1)}`,
  });
});

async function login(page: Page, password = PASSWORD) {
  await page.goto(`${PANEL}/metrics`);
  await page.getByLabel('Usuário').fill(USER);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('sem usuário e senha configurados, /metrics não existe', async ({ page }) => {
  const res = await page.goto('/metrics');
  expect(res?.status()).toBe(404);
});

test('login: senha errada avisa; a certa abre o painel; sair volta ao login', async ({ page }) => {
  await login(page, 'senha-errada-errada');
  await expect(page.getByRole('alert')).toHaveText('Usuário ou senha incorretos.');

  await login(page);
  await expect(page.getByRole('heading', { name: /Métricas de uso/ })).toBeVisible();
  await expect(page.getByText('Acessos externos', { exact: true })).toBeVisible();
  await expect(page.getByText(/faça login aqui antes de usar o editor/)).toBeVisible();
  await expect(page.getByRole('figure', { name: 'Acessos por dia' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Histórico de acessos' })).toBeVisible();

  // A senha não fica em nenhum lugar da página.
  expect(await page.content()).not.toContain(PASSWORD);

  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
});

test('o uso real do editor aparece no histórico, sem nome nem conteúdo do arquivo', async ({
  page,
}) => {
  // Usa o editor: abre um CSV e exporta (botão Exportar → CSV).
  await page.goto(`${PANEL}/`);
  await page.getByTestId('file-input').setInputFiles({
    name: 'planilha-confidencial.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('nome,cpf\nAna,123.456.789-00\n'),
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir' }).click();
  await expect(page.getByTestId('session-status')).toHaveText('Salvo');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Exportar' }).click();
  await pending;

  await login(page);
  const events = page.getByRole('region', { name: 'Histórico de operações' });
  const row = events.getByRole('row').filter({ hasText: 'Exportação' }).first();
  // O registro roda em segundo plano, depois da resposta: o painel pode abrir antes dele.
  await expect(async () => {
    await page.reload();
    await events.getByLabel('Tipo').selectOption('export');
    await expect(row).toContainText('Sucesso', { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(row).toContainText('Desenvolvimento');
  await expect(row).toContainText('CSV');

  const visits = page.getByRole('region', { name: 'Histórico de acessos' });
  await expect(visits.getByRole('cell', { name: 'Desenvolvimento' }).first()).toBeVisible();

  // Nada do arquivo chega ao painel.
  const html = await page.content();
  for (const secret of ['planilha-confidencial', 'Ana', '123.456']) {
    expect(html).not.toContain(secret);
  }

  // Relatório para baixar.
  const report = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Baixar relatório (CSV)' }).click();
  expect((await report).suggestedFilename()).toBe('datakit-metricas-30d.csv');
});

test('a Ajuda explica o que é coletado para as estatísticas', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajuda' }).click();
  const help = page.getByRole('dialog');
  await expect(help.getByText('Privacidade e estatísticas de uso')).toBeVisible();
  await expect(help.getByText(/apagada em até 30 dias/)).toBeVisible();
});
