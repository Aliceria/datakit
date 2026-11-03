import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Tabela 5.1 da especificação, caso a caso. O servidor dos testes usa 4 s como prazo depois de
// fechar a aba (em produção, 60 s).

const fixture = (name: string) => path.resolve(import.meta.dirname, '..', 'fixtures', name);
const GRACE_MS = 4000;

const dialog = (page: Page) => page.getByRole('dialog');
const status = (page: Page) => page.getByTestId('session-status');
const sid = (page: Page) => page.evaluate(() => sessionStorage.getItem('dk.sid'));

async function openFixture(page: Page, name: string) {
  await page.getByTestId('file-input').setInputFiles(fixture(name));
  await expect(dialog(page).getByRole('button', { name: 'Abrir' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(status(page)).toHaveText('Salvo');
}

async function openCsv(page: Page, name: string, rows: number) {
  const lines = [
    'id;nome',
    ...Array.from({ length: rows }, (_, i) => `${String(i + 1)};linha ${String(i + 1)}`),
  ];
  await page.getByTestId('file-input').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(lines.join('\n')),
  });
  await expect(dialog(page).getByRole('button', { name: 'Abrir' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Salvo');
}

/**
 * Sai do DataKit nesta aba (dispara o pagehide e o beacon de exclusão agendada) navegando para
 * outra página do mesmo site: o sessionStorage da aba continua, como num Ctrl+Shift+T.
 * Uma navegação para about:blank não serve: no Firefox ela não entrega o beacon.
 */
async function leavePage(page: Page) {
  await page.goto('/api/health');
}

/** Dispara um heartbeat imediato, como ao voltar para a aba. */
async function wakeUp(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('F5 volta ao mesmo arquivo, à mesma aba da planilha e à mesma rolagem', async ({ page }) => {
  await openFixture(page, 'xlsx/multi-sheet.xlsx');
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByRole('tab', { name: 'Oculta (oculta)' }).click();
  await expect(page.getByRole('gridcell', { name: '42' })).toBeVisible();
  const before = await sid(page);

  await page.reload();
  await expect(page.getByRole('tab', { name: 'Oculta (oculta)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('gridcell', { name: '42' })).toBeVisible();
  await expect(status(page)).toHaveText('Salvo');
  expect(await sid(page)).toBe(before);
});

test('F5 restaura a rolagem da grade', async ({ page }) => {
  await openCsv(page, 'longo.csv', 3000);
  await page.getByRole('grid').evaluate((el) => {
    el.scrollTop = 22 * 1500;
  });
  await expect(page.getByRole('gridcell', { name: 'linha 1501' })).toBeVisible();
  // A rolagem é gravada com um pequeno atraso; o pagehide grava o que faltar.
  await page.reload();
  await expect(page.getByRole('gridcell', { name: 'linha 1501' })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: 'linha 1', exact: true })).toHaveCount(0);
});

test('duas abas abertas têm sessões totalmente isoladas', async ({ page, context }) => {
  await openCsv(page, 'primeira.csv', 3);
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByText('Arraste um arquivo aqui')).toBeVisible();
  await openCsv(other, 'segunda.csv', 7);

  expect(await sid(page)).not.toBe(await sid(other));
  await page.reload();
  await other.reload();
  await expect(page.getByRole('status').last()).toContainText('3 linhas');
  await expect(other.getByRole('status').last()).toContainText('7 linhas');
});

test('"Duplicar aba" detecta o token repetido e cria uma cópia independente', async ({
  page,
  context,
}) => {
  await openCsv(page, 'original.csv', 5);
  const originalSid = await sid(page);
  const stored = await page.evaluate(() => ({
    sid: sessionStorage.getItem('dk.sid'),
    view: sessionStorage.getItem('dk.view'),
  }));

  // O navegador copia o sessionStorage ao duplicar: simulamos isso antes de a página carregar.
  const copy = await context.newPage();
  await copy.addInitScript((s) => {
    if (sessionStorage.getItem('dk.copied') === null) {
      sessionStorage.setItem('dk.copied', '1');
      if (s.sid) sessionStorage.setItem('dk.sid', s.sid);
      if (s.view) sessionStorage.setItem('dk.view', s.view);
    }
  }, stored);
  await copy.goto('/');
  await expect(copy.getByRole('status').last()).toContainText('5 linhas');
  await expect(status(copy)).toHaveText('Salvo');

  const copySid = await sid(copy);
  expect(copySid).not.toBeNull();
  expect(copySid).not.toBe(originalSid);

  // A original continua dona da própria sessão.
  await wakeUp(page);
  await expect(status(page)).toHaveText('Salvo');
  expect(await sid(page)).toBe(originalSid);

  // Independentes: fechar a cópia não afeta a original.
  await copy.getByRole('button', { name: 'Fechar o arquivo' }).click();
  await copy.getByRole('button', { name: 'Fechar arquivo' }).click();
  await page.reload();
  await expect(page.getByRole('status').last()).toContainText('5 linhas');
});

test('reabrir a aba fechada dentro do prazo restaura a sessão', async ({ page }) => {
  await openCsv(page, 'reaberto.csv', 4);
  const before = await sid(page);
  // Sair da página dispara o pagehide (beacon de exclusão agendada); o sessionStorage da aba fica.
  await leavePage(page);
  await page.goto('/');
  await expect(page.getByRole('status').last()).toContainText('4 linhas');
  expect(await sid(page)).toBe(before);

  // A exclusão agendada foi cancelada: passado o prazo, a sessão continua viva.
  await page.waitForTimeout(GRACE_MS + 1000);
  await page.reload();
  await expect(page.getByRole('status').last()).toContainText('4 linhas');
});

test('reabrir a aba fora do prazo mostra "Sessão expirada" e volta à tela inicial', async ({
  page,
}) => {
  await openCsv(page, 'perdido.csv', 2);
  await leavePage(page);
  await page.waitForTimeout(GRACE_MS + 1500);
  await page.goto('/');
  await expect(dialog(page)).toContainText('Sessão expirada');
  await expect(dialog(page)).toContainText('Abra o arquivo novamente');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('Arraste um arquivo aqui')).toBeVisible();
  expect(await sid(page)).toBeNull();
});

test('token inexistente: mensagem clara, nunca erro técnico', async ({ page }) => {
  await page.evaluate(() => {
    sessionStorage.setItem('dk.sid', 'A'.repeat(43));
  });
  await page.reload();
  await expect(dialog(page)).toContainText('Sessão expirada');
  await expect(dialog(page)).not.toContainText(/erro|error|500|stack/i);
});

test('sessão expirada com a aba aberta: "Continuar em uma nova sessão" mantém os dados (L14)', async ({
  page,
}) => {
  await openFixture(page, 'csv/cep-cpf.csv');
  const before = await sid(page);
  // Simula a expiração: a sessão some do servidor enquanto a aba está aberta.
  await page.request.delete('/api/session', { headers: { 'x-session-id': before ?? '' } });
  await wakeUp(page);

  await expect(dialog(page)).toContainText('Sessão expirada');
  await expect(status(page)).toHaveText('Sessão expirada');
  // Esc não descarta os dados.
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeVisible();

  await page.getByRole('button', { name: 'Continuar em uma nova sessão' }).click();
  await expect(status(page)).toHaveText('Salvo');
  const after = await sid(page);
  expect(after).not.toBe(before);
  await expect(page.getByRole('gridcell', { name: '012.345.678-90' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('gridcell', { name: '12345678901234567890' })).toBeVisible();
});

test('sessão expirada: "Voltar à tela inicial" descarta', async ({ page }) => {
  await openCsv(page, 'descartar.csv', 2);
  await page.request.delete('/api/session', {
    headers: { 'x-session-id': (await sid(page)) ?? '' },
  });
  await wakeUp(page);
  await page.getByRole('button', { name: 'Voltar à tela inicial' }).click();
  await expect(page.getByText('Arraste um arquivo aqui')).toBeVisible();
  expect(await sid(page)).toBeNull();
});

test('sem conexão: avisa e tenta de novo até voltar', async ({ page, context }) => {
  await openCsv(page, 'rede.csv', 2);
  await context.setOffline(true);
  await wakeUp(page);
  await expect(status(page)).toHaveText('Sem conexão — tentando novamente');
  await context.setOffline(false);
  await expect(status(page)).toHaveText('Salvo', { timeout: 10_000 });
});

test('outra instância assumiu a sessão: esta aba vira uma cópia, sem perder dados', async ({
  page,
}) => {
  await openCsv(page, 'lease.csv', 3);
  const before = await sid(page);
  // Simula uma segunda aba que retomou o mesmo token sem ser detectada (rede de segurança).
  await page.request.post('/api/session/resume', {
    headers: { 'x-session-id': before ?? '', 'content-type': 'application/json' },
    data: { instanceId: crypto.randomUUID() },
  });
  await wakeUp(page);
  await expect(dialog(page)).toContainText('aberta em outra aba');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(status(page)).toHaveText('Salvo');
  expect(await sid(page)).not.toBe(before);
  await page.reload();
  await expect(page.getByRole('status').last()).toContainText('3 linhas');
});
