import { expect, test, type Page } from '@playwright/test';

// Etapa 7: tratamento de dados (seção 8) e inspetores de coluna e de célula (seção 9).

const dialog = (page: Page) => page.getByRole('dialog');
const grid = (page: Page) => page.getByRole('grid');
const status = (page: Page) => page.getByTestId('session-status');
const footer = (page: Page) => page.getByRole('status').last();
const cell = (page: Page, text: string) =>
  grid(page).getByRole('gridcell', { name: text, exact: true });
const header = (page: Page, name: string) =>
  grid(page).getByRole('columnheader', { name: new RegExp(`^${name}`) });
const tools = (page: Page) => page.getByRole('region', { name: 'Tratamento de dados' });

async function openCsv(page: Page, content: string) {
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'dados.csv', mimeType: 'text/csv', buffer: Buffer.from(content) });
  await expect(dialog(page).getByRole('button', { name: 'Abrir' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Salvo');
}

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

/** Seleciona a coluna clicando no nome do cabeçalho (fora da seta de ordenação). */
async function selectColumn(page: Page, name: string) {
  await header(page, name).getByText(name, { exact: true }).click();
}

async function fromMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('remover duplicadas pelo menu Ferramentas: confirma a contagem e desfaz', async ({ page }) => {
  await openCsv(page, 'nome;cidade\nAna;Rio\nBia;SP\nana ;Rio\nAna;Rio\nBia;SP\n');
  await fromMenu(page, 'Remover duplicadas…');
  await expect(dialog(page)).toContainText('2 linhas serão removidas. Dá para desfazer');
  await dialog(page).getByLabel('Ignorar maiúsculas').check();
  await dialog(page).getByLabel('Aparar espaços na comparação').check();
  await expect(dialog(page)).toContainText('3 linhas serão removidas');
  // Só a coluna nome: Ana e Bia ficam, uma vez cada.
  await dialog(page).getByLabel('cidade').uncheck();
  await dialog(page).getByRole('button', { name: 'Remover' }).click();
  await expect.poll(() => column(page, 0)).toEqual(['Ana', 'Bia']);
  await expect(footer(page)).toContainText('2 linhas');
  await page.keyboard.press('Control+z');
  await expect.poll(() => column(page, 0)).toEqual(['Ana', 'Bia', 'ana·', 'Ana', 'Bia']);
});

test('remover linhas vazias, contando espaços como vazio', async ({ page }) => {
  await openCsv(page, 'a;b\n1;2\n;\n  ;\n3;4\n');
  await tools(page).getByRole('button', { name: 'Remover linhas vazias…' }).click();
  await expect(dialog(page)).toContainText('1 linhas serão removidas');
  await dialog(page).getByLabel('Contar células só com espaços como vazias').check();
  await expect(dialog(page)).toContainText('2 linhas serão removidas');
  await dialog(page).getByRole('button', { name: 'Remover' }).click();
  await expect.poll(() => column(page, 0)).toEqual(['1', '3']);
});

test('converter para número: forma canônica, falhas destacadas e inspetores atualizados', async ({
  page,
}) => {
  await openCsv(page, 'nome;preço\nAna;1.234,56\nBia;89,90\nCaio;abc\nDani;10\n');
  await selectColumn(page, 'preço');
  await tools(page).getByRole('button', { name: 'Converter tipo…' }).click();
  await expect(dialog(page)).toContainText('Colunas: preço');
  await expect(dialog(page)).toContainText('1 valores não podem ser convertidos');
  await expect(dialog(page)).toContainText('3 células serão alteradas');
  await dialog(page).getByRole('button', { name: 'Aplicar' }).click();
  await expect(dialog(page)).toContainText('1 valores não puderam ser convertidos');
  await dialog(page).getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => column(page, 1)).toEqual(['1234.56', '89.90', 'abc', '10']);
  await expect(cell(page, 'abc')).toHaveClass(/is-flagged/);

  await cell(page, '1234.56').click();
  const inspector = page.getByRole('region', { name: 'Inspetor de célula' });
  await expect(inspector).toContainText('número');
  await expect(inspector).toContainText('7');
  const columnInspector = page.getByRole('region', { name: 'Inspetor de coluna' });
  await expect(columnInspector).toContainText('Máximo1234.56');
  await expect(columnInspector).toContainText('Mínimo10');

  // Desfazer volta o texto original e tira o destaque.
  await page.keyboard.press('Control+z');
  await expect.poll(() => column(page, 1)).toEqual(['1.234,56', '89,90', 'abc', '10']);
  await expect(cell(page, 'abc')).not.toHaveClass(/is-flagged/);
});

test('operações em colunas: maiúsculas, preencher vazios, substituir valor e limpar', async ({
  page,
}) => {
  await openCsv(page, 'nome;cidade\nana;são paulo\nbia;\ncaio;rio\n');
  await selectColumn(page, 'cidade');
  await fromMenu(page, 'Primeira Letra Maiúscula…');
  await expect(dialog(page)).toContainText('2 células serão alteradas');
  await dialog(page).getByRole('button', { name: 'Aplicar' }).click();
  await expect.poll(() => column(page, 1)).toEqual(['São Paulo', '', 'Rio']);

  await tools(page).getByRole('button', { name: 'Preencher vazios…' }).click();
  await dialog(page).getByLabel('Valor').fill('N/D');
  await dialog(page).getByRole('button', { name: 'Aplicar' }).click();
  await expect.poll(() => column(page, 1)).toEqual(['São Paulo', 'N/D', 'Rio']);

  await tools(page).getByRole('button', { name: 'Substituir valor…' }).click();
  await dialog(page).getByLabel('Procurar').fill('Rio');
  await dialog(page).getByLabel('Trocar por').fill('Rio de Janeiro');
  await dialog(page).getByRole('button', { name: 'Aplicar' }).click();
  await expect.poll(() => column(page, 1)).toEqual(['São Paulo', 'N/D', 'Rio de Janeiro']);

  await selectColumn(page, 'nome');
  await tools(page).getByRole('button', { name: 'MAIÚSCULAS…' }).click();
  await dialog(page).getByRole('button', { name: 'Aplicar' }).click();
  await expect.poll(() => column(page, 0)).toEqual(['ANA', 'BIA', 'CAIO']);

  await tools(page).getByRole('button', { name: 'Limpar coluna…' }).click();
  await expect(dialog(page)).toContainText('3 células serão alteradas');
  await dialog(page).getByRole('button', { name: 'Aplicar' }).click();
  await expect.poll(() => column(page, 0)).toEqual(['', '', '']);
  await expect(status(page)).toHaveText('Salvo');

  // As cinco operações persistem no servidor e voltam depois do F5.
  await page.reload();
  await expect.poll(() => column(page, 1)).toEqual(['São Paulo', 'N/D', 'Rio de Janeiro']);
});

test('localizar vazios e identificar inconsistentes aplicam filtros', async ({ page }) => {
  await openCsv(page, 'n;c\n1;a\n2;\n3;b\n4;c\nx; d\n6;e\n7;f\n8;g\n9;h\n10;i\n');
  await tools(page).getByRole('button', { name: 'Localizar vazios' }).click();
  await expect(footer(page)).toContainText('1 de 10 linhas');
  await expect(page.getByRole('list', { name: 'Filtros ativos' })).toContainText(
    'alguma coluna é vazio, nulo ou ausente',
  );
  await page.getByRole('button', { name: 'Limpar filtros' }).click();

  await tools(page).getByRole('button', { name: 'Identificar inconsistentes' }).click();
  // "x" não é número numa coluna de números e " d" tem espaço no começo: a mesma linha.
  await expect.poll(() => column(page, 0)).toEqual(['x']);
  await page.getByRole('button', { name: 'Limpar filtros' }).click();

  await selectColumn(page, 'c');
  await tools(page).getByRole('button', { name: 'Vazios na coluna' }).click();
  await expect.poll(() => column(page, 0)).toEqual(['2']);
});

test('com filtro ativo, a ferramenta pergunta o escopo (seção 7.5)', async ({ page }) => {
  await openCsv(page, 'nome;cidade\nana;Rio\nbia;SP\ncaio;Rio\n');
  await header(page, 'cidade').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Filtrar…' }).click();
  await page.getByLabel('Condição').selectOption({ label: 'igual a' });
  await dialog(page).getByRole('textbox', { name: 'Valor', exact: true }).fill('Rio');
  await dialog(page).getByRole('button', { name: 'Aplicar' }).click();

  await selectColumn(page, 'nome');
  await tools(page).getByRole('button', { name: 'MAIÚSCULAS…' }).click();
  await expect(dialog(page)).toContainText('Todas as linhas (3 células)');
  await dialog(page)
    .getByLabel(/Só as linhas visíveis/)
    .check();
  await expect(dialog(page)).toContainText('2 células serão alteradas');
  await dialog(page).getByRole('button', { name: 'Aplicar' }).click();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect.poll(() => column(page, 0)).toEqual(['ANA', 'bia', 'CAIO']);
});

test('inspetor de célula mostra espaços, estado e tipo de origem (JSON)', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles({
    name: 'x.json',
    mimeType: 'application/json',
    buffer: Buffer.from('[{"a":" oi ","b":1},{"a":null,"b":2}]'),
  });
  // JSON de objetos abre direto, sem pré-visualização.
  await expect(status(page)).toHaveText('Salvo');
  const inspector = page.getByRole('region', { name: 'Inspetor de célula' });
  // A grade também mostra os espaços das pontas.
  await cell(page, '·oi·').click();
  await expect(inspector).toContainText('·oi·');
  await expect(inspector).toContainText('Tipo de origemtexto');
  await expect(inspector).toContainText('Comprimento4');
  await page.keyboard.press('ArrowDown');
  await expect(inspector).toContainText('Estadonulo');
  await page.keyboard.press('ArrowRight');
  await expect(inspector).toContainText('Tipo de origemnúmero');
  await expect(page.getByRole('region', { name: 'Inspetor de coluna' })).toContainText('Média1,5');
});

test('clique direito na seta de ordenação abre o menu da própria coluna', async ({ page }) => {
  await openCsv(page, 'a;b\n1;x\n2;\n');
  await grid(page).getByRole('button', { name: 'Ordenar por b' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Filtrar…' }).click();
  await expect(dialog(page)).toContainText('Filtrar "b"');
});
