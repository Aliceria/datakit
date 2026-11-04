import fs from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Etapa 8: exportação (seção 10), conferindo o conteúdo do arquivo baixado.

const dialog = (page: Page) => page.getByRole('dialog');
const grid = (page: Page) => page.getByRole('grid');
const status = (page: Page) => page.getByTestId('session-status');
const cell = (page: Page, text: string) =>
  grid(page).getByRole('gridcell', { name: text, exact: true });

async function openFile(page: Page, name: string, content: string, mimeType = 'text/csv') {
  await page
    .getByTestId('file-input')
    .setInputFiles({ name, mimeType, buffer: Buffer.from(content) });
  if (name.endsWith('.csv')) {
    await expect(dialog(page).getByRole('button', { name: 'Abrir' })).toBeFocused();
    await page.keyboard.press('Enter');
  }
  await expect(status(page)).toHaveText('Salvo');
  await expect(grid(page).getByRole('gridcell').first()).toBeVisible();
}

/** Clica em Exportar no diálogo e devolve o nome sugerido e o conteúdo do arquivo baixado. */
async function download(page: Page): Promise<{ name: string; bytes: Buffer }> {
  const pending = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Exportar' }).click();
  const file = await pending;
  const filePath = await file.path();
  return { name: file.suggestedFilename(), bytes: await fs.readFile(filePath) };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('Ctrl+S exporta CSV "Excel Brasil" com a edição; as marcas de alteração somem', async ({
  page,
}) => {
  await openFile(page, 'vendas.csv', 'nome,cidade\nAna,Rio\nBia,=SP\n');
  await cell(page, 'Rio').dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('São Paulo');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('unexported-changes')).toContainText('1');
  await expect(grid(page).locator('.is-edited')).toHaveCount(1);

  await page.keyboard.press('Control+s');
  await expect(dialog(page)).toContainText('Exportar');
  await expect(page.getByLabel('Nome do arquivo')).toHaveValue('vendas.csv');
  await page
    .getByLabel('Predefinição')
    .selectOption({ label: 'Excel Brasil (UTF-8 com BOM, ponto e vírgula)' });
  await expect(dialog(page)).toContainText("recebem um ' na frente");
  const file = await download(page);
  expect(file.name).toBe('vendas.csv');
  expect([...file.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(file.bytes.subarray(3).toString('utf8')).toBe(
    "nome;cidade\r\nAna;São Paulo\r\nBia;'=SP\r\n",
  );

  await expect(page.getByTestId('unexported-changes')).toContainText('0');
  await expect(grid(page).locator('.is-edited')).toHaveCount(0);
  // A limpeza das marcas também está no servidor: continua depois do F5.
  await expect(status(page)).toHaveText('Salvo');
  await page.reload();
  await expect(cell(page, 'São Paulo')).toBeVisible();
  await expect(grid(page).locator('.is-edited')).toHaveCount(0);
});

test('somente linhas visíveis, na ordem atual; nome com acento', async ({ page }) => {
  await openFile(page, 'relatório.csv', 'n;v\na;3\nb;1\nc;2\n');
  await grid(page).getByRole('button', { name: 'Ordenar por v' }).click();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByLabel('Somente linhas visíveis, na ordem atual').check();
  const file = await download(page);
  expect(file.name).toBe('relatório.csv');
  expect(file.bytes.toString('utf8')).toBe('n,v\r\nb,1\r\nc,2\r\na,3\r\n');
  // Exportação parcial não limpa as marcas (L19): não havia nenhuma, mas o contador segue igual.
  await expect(page.getByTestId('unexported-changes')).toContainText('0');
});

test('JSON aninhado volta igual; para CSV, o diálogo avisa da perda de estados', async ({
  page,
}) => {
  const source = '[{"id":1,"end":{"cidade":"Rio"},"n":12345678901234567890,"x":null},{"id":2}]';
  await openFile(page, 'dados.json', source, 'application/json');
  await page.keyboard.press('Control+s');
  await expect(page.getByLabel('Reconstruir objetos aninhados')).toBeChecked();
  await page.getByLabel('Indentado').uncheck();
  const json = await download(page);
  expect(json.name).toBe('dados.json');
  expect(json.bytes.toString('utf8')).toBe(`${source}\n`);

  await page.keyboard.press('Control+s');
  await page.getByLabel('Formato').selectOption('csv');
  await expect(page.getByLabel('Nome do arquivo')).toHaveValue('dados.csv');
  await expect(page.getByRole('list', { name: 'Avisos da exportação' })).toContainText(
    'Nulos, ausentes e vazios ficam iguais no CSV',
  );
  const csv = await download(page);
  expect(csv.bytes.toString('utf8')).toBe(
    'id,end.cidade,n,x\r\n1,Rio,12345678901234567890,\r\n2,,,\r\n',
  );
});

test('XLSX: exporta e reabre o arquivo baixado com os mesmos dados', async ({ page }) => {
  await openFile(page, 'cadastro.csv', 'cep;valor;obs\n01310100;10.5;=1+1\n00012;7;ok\n');
  await page.keyboard.press('Control+s');
  await page.getByLabel('Formato').selectOption('xlsx');
  await expect(page.getByLabel('Nome do arquivo')).toHaveValue('cadastro.xlsx');
  const file = await download(page);
  expect(file.name).toBe('cadastro.xlsx');
  expect(file.bytes.subarray(0, 2).toString('latin1')).toBe('PK');

  await page.getByTestId('file-input').setInputFiles({
    name: 'cadastro.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: file.bytes,
  });
  await expect(dialog(page)).toContainText('Abrir cadastro.xlsx');
  await dialog(page).getByRole('button', { name: 'Abrir' }).click();
  // Abrir outro arquivo com alterações? Não há: abre direto.
  await expect(cell(page, '01310100')).toBeVisible();
  await expect(cell(page, '00012')).toBeVisible();
  await expect(cell(page, '=1+1')).toBeVisible();
  await expect(cell(page, '10.5')).toBeVisible();
});
