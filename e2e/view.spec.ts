import { expect, test, type Page } from '@playwright/test';

// Etapa 6: filtros, ordenação, busca, substituição e "ir para".

const dialog = (page: Page) => page.getByRole('dialog');
const grid = (page: Page) => page.getByRole('grid');
const status = (page: Page) => page.getByTestId('session-status');
const footer = (page: Page) => page.getByRole('status').last();
const cell = (page: Page, text: string) =>
  grid(page).getByRole('gridcell', { name: text, exact: true });
const header = (page: Page, name: string) =>
  grid(page).getByRole('columnheader', { name: new RegExp(`^${name}`) });

const CSV =
  'nome;preço;cidade\nAna;1.234,56;São Paulo\nBia;89,90;Rio\nCaio;10,00;São Paulo\nDani;500,00;Belém\nEdu;;Rio\n';

async function openCsv(page: Page, content = CSV) {
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'dados.csv', mimeType: 'text/csv', buffer: Buffer.from(content) });
  await expect(dialog(page).getByRole('button', { name: 'Abrir' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Salvo');
}

/** Coluna da grade, de cima para baixo (texto das células visíveis). */
async function column(page: Page, index: number): Promise<string[]> {
  return grid(page)
    .getByRole('row')
    .evaluateAll(
      (rows, i) =>
        rows
          .filter((r) => r.querySelector('[role="gridcell"]'))
          .sort(
            (a, b) =>
              Number(a.getAttribute('aria-rowindex')) - Number(b.getAttribute('aria-rowindex')),
          )
          .map(
            (r) =>
              r.querySelector(`[role="gridcell"][aria-colindex="${String(i + 1)}"]`)?.textContent ??
              '',
          ),
      index,
    );
}

async function rowNumbers(page: Page): Promise<string[]> {
  return grid(page)
    .getByRole('rowheader')
    .evaluateAll((els) =>
      els
        .sort(
          (a, b) =>
            Number(a.parentElement?.getAttribute('aria-rowindex')) -
            Number(b.parentElement?.getAttribute('aria-rowindex')),
        )
        .map((e) => e.textContent),
    );
}

async function filterColumn(page: Page, name: string, condition: string, value?: string) {
  await header(page, name).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Filtrar…' }).click();
  await page.getByLabel('Condição').selectOption({ label: condition });
  if (value !== undefined)
    await dialog(page).getByRole('textbox', { name: 'Valor', exact: true }).fill(value);
  await dialog(page).getByRole('button', { name: 'Aplicar' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('ordenação pela seta do cabeçalho: crescente, decrescente, sem; vazios no fim', async ({
  page,
}) => {
  await openCsv(page);
  const sortPrice = grid(page).getByRole('button', { name: /por preço/ });
  await sortPrice.click();
  await expect.poll(() => column(page, 1)).toEqual(['10,00', '89,90', '500,00', '1.234,56', '']);
  // Os números das linhas mostram a posição original nos dados.
  await expect.poll(() => rowNumbers(page)).toEqual(['3', '2', '4', '1', '5']);
  await sortPrice.click();
  await expect.poll(() => column(page, 1)).toEqual(['1.234,56', '500,00', '89,90', '10,00', '']);
  await sortPrice.click();
  await expect.poll(() => column(page, 0)).toEqual(['Ana', 'Bia', 'Caio', 'Dani', 'Edu']);
});

test('critério secundário com Shift+clique e texto em ordem de português', async ({ page }) => {
  await openCsv(page);
  await grid(page)
    .getByRole('button', { name: /por cidade/ })
    .click();
  await grid(page)
    .getByRole('button', { name: /por nome/ })
    .click({ modifiers: ['Shift'] });
  await grid(page)
    .getByRole('button', { name: /por nome/ })
    .click({ modifiers: ['Shift'] });
  await expect
    .poll(() => column(page, 2))
    .toEqual(['Belém', 'Rio', 'Rio', 'São Paulo', 'São Paulo']);
  await expect.poll(() => column(page, 0)).toEqual(['Dani', 'Edu', 'Bia', 'Caio', 'Ana']);
  await expect(
    page.getByRole('list', { name: 'Critérios de ordenação' }).getByRole('listitem'),
  ).toHaveCount(2);
});

test('filtros: texto e número no formato brasileiro, "X de Y linhas" e remoção um a um', async ({
  page,
}) => {
  await openCsv(page);
  await filterColumn(page, 'cidade', 'contém', 'são');
  await expect.poll(() => column(page, 0)).toEqual(['Ana', 'Caio']);
  await expect(footer(page)).toContainText('2 de 5 linhas');

  await filterColumn(page, 'preço', 'número >', '100,00');
  await expect.poll(() => column(page, 0)).toEqual(['Ana']);
  const list = page.getByRole('list', { name: 'Filtros ativos' });
  await expect(list).toContainText('cidade contém "são"');
  await expect(list).toContainText('preço > 100,00');

  await page.getByRole('button', { name: 'Remover filtro de cidade' }).click();
  await expect.poll(() => column(page, 0)).toEqual(['Ana', 'Dani']);
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(footer(page)).toContainText('5 linhas');
});

test('filtro com número inválido avisa e não muda nada', async ({ page }) => {
  await openCsv(page);
  await filterColumn(page, 'preço', 'número >', 'abc');
  await expect(dialog(page).filter({ hasText: 'Filtro inválido' })).toContainText(
    '"abc" não é um número válido',
  );
});

test('filtros de estado: vazio', async ({ page }) => {
  await openCsv(page);
  await filterColumn(page, 'preço', 'é vazio');
  await expect.poll(() => column(page, 0)).toEqual(['Edu']);
});

test('editar com filtro ativo mantém a linha visível até reaplicar; F5 mantém filtro e ordem', async ({
  page,
}) => {
  await openCsv(page);
  await filterColumn(page, 'cidade', 'igual a', 'Rio');
  await expect.poll(() => column(page, 0)).toEqual(['Bia', 'Edu']);
  await cell(page, 'Rio').first().click();
  await page.keyboard.type('Niterói');
  await page.keyboard.press('Enter');
  await expect.poll(() => column(page, 2)).toEqual(['Niterói', 'Rio']);
  await expect(page.getByText('Os dados mudaram depois de aplicar')).toBeVisible();
  await page.getByRole('button', { name: 'Reaplicar' }).click();
  await expect.poll(() => column(page, 0)).toEqual(['Edu']);

  await grid(page)
    .getByRole('button', { name: /por nome/ })
    .click();
  await expect(status(page)).toHaveText('Salvo');
  await page.reload();
  await expect(footer(page)).toContainText('1 de 5 linhas');
  await expect(page.getByRole('list', { name: 'Filtros ativos' })).toContainText(
    'cidade igual a "Rio"',
  );
  await expect(page.getByRole('list', { name: 'Critérios de ordenação' })).toContainText('nome');
});

test('"Aplicar ordem atual aos dados" grava a ordem e pode ser desfeito', async ({ page }) => {
  await openCsv(page);
  await grid(page)
    .getByRole('button', { name: /por preço/ })
    .click();
  await grid(page)
    .getByRole('button', { name: /por preço/ })
    .click();
  await page.getByRole('button', { name: 'Aplicar ordem atual aos dados' }).click();
  // A ordenação some do painel: agora é a ordem dos dados.
  await expect(page.getByRole('list', { name: 'Critérios de ordenação' })).toHaveCount(0);
  await expect.poll(() => rowNumbers(page)).toEqual(['1', '2', '3', '4', '5']);
  await expect.poll(() => column(page, 0)).toEqual(['Ana', 'Dani', 'Bia', 'Caio', 'Edu']);
  await expect(status(page)).toHaveText('Salvo');
  await page.reload();
  await expect.poll(() => column(page, 0)).toEqual(['Ana', 'Dani', 'Bia', 'Caio', 'Edu']);
  await page.keyboard.press('Control+z');
  await expect.poll(() => column(page, 0)).toEqual(['Ana', 'Bia', 'Caio', 'Dani', 'Edu']);
});

test('busca: Ctrl+F, ignorar acentos, próximo e anterior, listar todas', async ({ page }) => {
  await openCsv(page);
  await cell(page, 'Ana').click();
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('textbox', { name: 'Pesquisar', exact: true })).toBeFocused();
  await page.keyboard.type('sao');
  await expect(page.getByText('Nenhum resultado')).toBeVisible();
  await page.getByLabel('Ignorar acentos').check();
  await expect(page.getByText('2 células')).toBeVisible();
  await page.getByRole('button', { name: 'Próximo' }).click();
  await expect(footer(page)).toContainText('L1 cidade');
  await page.getByRole('button', { name: 'Próximo' }).click();
  await expect(footer(page)).toContainText('L3 cidade');
  await page.getByRole('button', { name: 'Anterior' }).click();
  await expect(footer(page)).toContainText('L1 cidade');
  await page.getByLabel('Listar todas').check();
  await page.getByRole('list', { name: 'Resultados da busca' }).getByRole('button').nth(1).click();
  await expect(footer(page)).toContainText('L3 cidade');
});

test('substituir: atual e todas, com confirmação; uma operação para desfazer', async ({ page }) => {
  await openCsv(page);
  await page.getByRole('textbox', { name: 'Pesquisar', exact: true }).fill('Rio');
  await page.getByLabel('Ativar substituição').check();
  await page.getByLabel('Substituir por').fill('RJ');
  await page.getByRole('button', { name: 'Substituir', exact: true }).click();
  // Primeiro clique só vai até o primeiro resultado; o segundo substitui.
  await page.getByRole('button', { name: 'Substituir', exact: true }).click();
  await expect
    .poll(() => column(page, 2))
    .toEqual(['São Paulo', 'RJ', 'São Paulo', 'Belém', 'Rio']);

  await page.getByRole('textbox', { name: 'Pesquisar', exact: true }).fill('São Paulo');
  await page.getByLabel('Substituir por').fill('SP');
  await page.getByRole('button', { name: 'Substituir todas' }).click();
  await expect(dialog(page)).toContainText('2 células serão alteradas');
  await dialog(page).getByRole('button', { name: 'Substituir' }).click();
  await expect.poll(() => column(page, 2)).toEqual(['SP', 'RJ', 'SP', 'Belém', 'Rio']);
  await page.keyboard.press('Control+z');
  await expect
    .poll(() => column(page, 2))
    .toEqual(['São Paulo', 'RJ', 'São Paulo', 'Belém', 'Rio']);
});

test('substituir todas com filtro ativo pergunta o escopo (seção 7.5)', async ({ page }) => {
  await openCsv(page);
  await filterColumn(page, 'nome', 'começa com', 'a');
  await page.getByRole('textbox', { name: 'Pesquisar', exact: true }).fill('São Paulo');
  await page.getByLabel('Ativar substituição').check();
  await page.getByLabel('Substituir por').fill('SP');
  await page.getByRole('button', { name: 'Substituir todas' }).click();
  await expect(dialog(page)).toContainText('Todas as linhas (2 células)');
  await page.getByLabel(/Só as linhas visíveis/).check();
  await expect(dialog(page)).toContainText('1 células serão alteradas');
  await dialog(page).getByRole('button', { name: 'Substituir' }).click();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect.poll(() => column(page, 2)).toEqual(['SP', 'Rio', 'São Paulo', 'Belém', 'Rio']);
});

test('ir para (Ctrl+G) pela posição da linha, e aviso quando ela está filtrada', async ({
  page,
}) => {
  await openCsv(page);
  await grid(page)
    .getByRole('button', { name: /por preço/ })
    .click();
  await page.keyboard.press('Control+g');
  await expect(page.getByLabel('Linha')).toBeFocused();
  await page.keyboard.type('4');
  await page.getByLabel('Coluna', { exact: true }).selectOption({ label: 'cidade' });
  await page.getByRole('button', { name: 'Ir', exact: true }).click();
  await expect(footer(page)).toContainText('L3 cidade');
  await expect(grid(page).locator('.is-focus')).toHaveText('Belém');

  await filterColumn(page, 'nome', 'igual a', 'Ana');
  await page.getByLabel('Linha').fill('2');
  await page.getByRole('button', { name: 'Ir', exact: true }).click();
  await expect(dialog(page)).toContainText('A linha 2 está escondida pelos filtros');
});
