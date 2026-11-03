import { expect, test, type ConsoleMessage } from '@playwright/test';

test.describe('esqueleto do layout', () => {
  test('mostra identidade, painéis e tela inicial sem erros de console', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' || msg.type() === 'warning') problems.push(msg.text());
    });
    page.on('pageerror', (err) => problems.push(err.message));

    await page.goto('/');

    await expect(page).toHaveTitle('DataKit — Structured Data Editor');
    const header = page.getByRole('banner');
    await expect(header.getByText('DataKit', { exact: true })).toBeVisible();
    await expect(header.getByText('Structured Data Editor')).toBeVisible();

    for (const title of ['Informações do arquivo', 'Inspetor de coluna', 'Inspetor de célula']) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }
    for (const title of ['Ir para', 'Pesquisar e substituir', 'Filtros e ordenação']) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }

    const main = page.getByRole('main');
    await expect(main.getByText('20 MB')).toBeVisible();
    await expect(main.getByText('100.000')).toBeVisible();
    await expect(main.getByText(/apagados quando você fecha a aba/)).toBeVisible();

    // Nada de CSP bloqueando recursos nem erros de JavaScript.
    expect(problems).toEqual([]);
  });

  test('recolhe e expande uma seção de painel', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Recolher Inspetor de coluna' });
    await toggle.click();
    await expect(page.getByText('Nenhuma coluna selecionada.')).toBeHidden();

    const expand = page.getByRole('button', { name: 'Expandir Inspetor de coluna' });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expand.click();
    await expect(page.getByText('Nenhuma coluna selecionada.')).toBeVisible();
  });

  test('abaixo de 1100 px os painéis viram gavetas', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto('/');

    const leftHeading = page.getByRole('heading', { name: 'Informações do arquivo' });
    await expect(leftHeading).toBeHidden();

    await page.getByRole('button', { name: 'Informações', exact: true }).click();
    await expect(leftHeading).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(leftHeading).toBeHidden();

    await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ir para' })).toBeVisible();
  });

  test('acima de 1100 px os botões de gaveta não aparecem', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Informações', exact: true })).toBeHidden();
  });
});

test('GET /api/health responde ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok' });
});
