import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) => path.resolve(import.meta.dirname, '..', 'fixtures', name);

async function chooseFile(page: Page, name: string) {
  await page.getByTestId('file-input').setInputFiles(fixture(name));
}

const grid = (page: Page) => page.getByRole('grid');
const dialog = (page: Page) => page.getByRole('dialog');

/** Espera a pré-visualização abrir e confirma com Enter. */
async function confirmWithEnter(page: Page) {
  await expect(dialog(page).getByRole('button', { name: 'Abrir' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('CSV do Excel em português: pré-visualização, Enter confirma e a grade mostra os dados exatos', async ({
  page,
}) => {
  await chooseFile(page, 'csv/excel-br-1252.csv');
  await expect(dialog(page)).toContainText('Abrir excel-br-1252.csv');
  await expect(page.getByLabel('Codificação')).toHaveValue('windows-1252');
  await expect(page.getByLabel('Delimitador')).toHaveValue(';');
  await expect(dialog(page)).toContainText('Açú');

  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeHidden();

  await expect(grid(page)).toContainText('Conceição');
  await expect(grid(page).getByRole('columnheader', { name: /preço/ })).toContainText('123');
  await expect(page.getByRole('gridcell', { name: '1.234,56' })).toHaveClass(/is-number/);
  await expect(page.getByRole('status').last()).toContainText('3 linhas');

  const info = page.getByRole('region', { name: 'Informações do arquivo' });
  await expect(info).toContainText('Windows-1252');
  await expect(info).toContainText('Ponto e vírgula');
});

test('mudar o delimitador na pré-visualização atualiza as colunas', async ({ page }) => {
  await chooseFile(page, 'csv/excel-br-1252.csv');
  await page.getByLabel('Delimitador').selectOption(',');
  // Com vírgula, "1.234,56" é dividido e a primeira coluna passa a ter o cabeçalho inteiro.
  await expect(dialog(page).getByRole('columnheader').nth(1)).toContainText(
    'nome;preço;data;cidade',
  );
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText('Arraste um arquivo aqui')).toBeVisible();
});

test('zeros à esquerda e números grandes não mudam', async ({ page }) => {
  await chooseFile(page, 'csv/cep-cpf.csv');
  await confirmWithEnter(page);
  for (const value of ['01310100', '012.345.678-90', '011987654321', '12345678901234567890']) {
    await expect(page.getByRole('gridcell', { name: value, exact: true })).toBeVisible();
  }
});

test('JSON de objetos abre direto, com nulo, ausente e vazio diferentes', async ({ page }) => {
  await chooseFile(page, 'json/nested-heterogeneous.json');
  await expect(grid(page)).toBeVisible();
  await expect(dialog(page)).toBeHidden();

  await expect(grid(page).getByRole('columnheader', { name: /endereco\.cidade/ })).toBeVisible();
  const nullCell = page.locator('.dk-cell-null').first();
  await expect(nullCell).toHaveText('null');
  await expect(nullCell).toHaveCSS('font-style', 'italic');
  await expect(page.locator('.dk-cell-absent').first()).toHaveText('—');
  // "123" (texto) e 123 (número) seguem como estavam.
  await expect(page.getByRole('gridcell', { name: '123', exact: true })).toHaveCount(2);
});

test('JSON com inteiros acima de 2^53', async ({ page }) => {
  await chooseFile(page, 'json/bigint.json');
  await expect(page.getByRole('gridcell', { name: '12345678901234567890' })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: '9007199254740993' })).toBeVisible();
});

test('JSON com raiz objeto pergunta qual array importar', async ({ page }) => {
  await chooseFile(page, 'json/root-object.json');
  await expect(page.getByLabel('Array a importar')).toHaveValue('["clientes"]');
  await page.getByLabel('Array a importar').selectOption({ label: 'pedidos' });
  await expect(dialog(page)).toContainText('10');
  await dialog(page).getByRole('button', { name: 'Abrir' }).click();
  await expect(dialog(page)).toContainText('Só o array "pedidos" foi importado');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(grid(page).getByRole('columnheader', { name: /^n/ })).toBeVisible();
});

test('XLSX: pré-visualização no servidor, todas as abas, oculta marcada e avisos', async ({
  page,
}) => {
  await chooseFile(page, 'xlsx/multi-sheet.xlsx');
  await expect(dialog(page).getByRole('tab', { name: 'Oculta (oculta)' })).toBeVisible();
  await expect(dialog(page)).toContainText('mesclada');
  await page.keyboard.press('Enter');

  await expect(dialog(page)).toContainText('células tinham fórmula');
  await expect(dialog(page)).toContainText('células mescladas');
  await page.getByRole('button', { name: 'OK' }).click();

  const tabs = page.getByRole('tablist', { name: 'Abas da planilha' });
  await expect(tabs.getByRole('tab')).toHaveText(['Clientes', 'Vazia', 'Oculta (oculta)']);
  await expect(page.getByRole('gridcell', { name: '#DIV/0!' }).first()).toBeVisible();

  await tabs.getByRole('tab', { name: 'Vazia' }).click();
  await expect(page.getByText('Esta aba está vazia.')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Oculta (oculta)' }).click();
  await expect(page.getByRole('gridcell', { name: '42' })).toBeVisible();
});

test('erros têm mensagem clara em português', async ({ page }) => {
  await chooseFile(page, 'invalid/syntax-error.json');
  await expect(dialog(page)).toContainText('JSON inválido na linha 3, coluna 8');
  await page.getByRole('button', { name: 'OK' }).click();

  await chooseFile(page, 'invalid/csv-content.xlsx');
  await expect(dialog(page)).toContainText('extensão .xlsx, mas o conteúdo é texto');
  await page.getByRole('button', { name: 'OK' }).click();

  await chooseFile(page, 'invalid/zip-bomb.xlsx');
  await expect(dialog(page)).toContainText('limites de segurança');
});

test('fechar o arquivo pede confirmação e volta à tela inicial', async ({ page }) => {
  await chooseFile(page, 'csv/utf8-bom.csv');
  await confirmWithEnter(page);
  await expect(grid(page)).toContainText('Ana');
  await page.getByRole('button', { name: 'Fechar o arquivo' }).click();
  await expect(dialog(page)).toContainText('dados temporários serão apagados');
  await page.getByRole('button', { name: 'Fechar arquivo' }).click();
  await expect(page.getByText('Arraste um arquivo aqui')).toBeVisible();
});

test('arrastar e soltar abre o arquivo', async ({ page }) => {
  // O listener de soltar é registrado num efeito do React, que roda depois da primeira pintura:
  // repete o disparo até ele existir (um segundo arquivo com a pré-visualização aberta é ignorado).
  await expect(async () => {
    await page.evaluate(() => {
      const file = new File(['id,valor\n1,10\n'], 'solto.csv', { type: 'text/csv' });
      const dt = new DataTransfer();
      dt.items.add(file);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        window.dispatchEvent(
          new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
      }
    });
    await expect(dialog(page)).toContainText('Abrir solto.csv', { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
});

test('desempenho: CSV de 100.000 linhas × 20 colunas abre e rola', async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);
  const started = Date.now();
  await chooseFile(page, 'large/100k.csv');
  await expect(dialog(page)).toContainText('Mostrando as primeiras 20 linhas');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').last()).toContainText('100.000 linhas', {
    timeout: 15_000,
  });
  const elapsed = Date.now() - started;
  console.log(`[${browserName}] importação de 100k linhas: ${String(elapsed)} ms`);
  // Meta da seção 13: ~5 s num notebook comum (com folga para CI).
  expect(elapsed).toBeLessThan(15_000);

  const gridEl = grid(page);
  await gridEl.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByRole('rowheader', { name: '100000' })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: 'Pessoa 100000' })).toBeVisible();
  // Só as linhas visíveis existem no DOM.
  expect(await page.getByRole('row').count()).toBeLessThan(120);
});
