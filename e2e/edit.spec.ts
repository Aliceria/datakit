import { expect, test, type Page } from '@playwright/test';

// Etapa 5: edição, seleção e teclado, copiar e colar, linhas e colunas, desfazer persistente.

const dialog = (page: Page) => page.getByRole('dialog');
const grid = (page: Page) => page.getByRole('grid');
const status = (page: Page) => page.getByTestId('session-status');
const cell = (page: Page, text: string) =>
  grid(page).getByRole('gridcell', { name: text, exact: true });

/** Valores visíveis da grade, linha a linha (só o texto). */
async function values(page: Page): Promise<string[][]> {
  return grid(page)
    .getByRole('row')
    .evaluateAll((rows) =>
      rows
        .filter((r) => r.querySelector('[role="gridcell"]'))
        .sort(
          (a, b) =>
            Number(a.getAttribute('aria-rowindex')) - Number(b.getAttribute('aria-rowindex')),
        )
        .map((r) =>
          [...r.querySelectorAll('[role="gridcell"]')]
            .sort(
              (a, b) =>
                Number(a.getAttribute('aria-colindex')) - Number(b.getAttribute('aria-colindex')),
            )
            .map((c) => c.textContent),
        ),
    );
}

async function openCsv(page: Page, content: string) {
  await page.getByTestId('file-input').setInputFiles({
    name: 'dados.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(content),
  });
  await expect(dialog(page).getByRole('button', { name: 'Abrir' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(grid(page)).toBeVisible();
  await expect(status(page)).toHaveText('Salvo');
}

async function waitSaved(page: Page) {
  await expect(status(page)).toHaveText('Salvo');
}

/** Cola texto como o navegador faria (evento paste com dados). */
async function paste(page: Page, text: string) {
  await grid(page).evaluate((el, t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    // O Firefox troca os dados de um evento de colar sintético por um vazio; fixa os nossos.
    Object.defineProperty(event, 'clipboardData', { value: data });
    el.dispatchEvent(event);
  }, text);
}

/**
 * Copia como o navegador faria e devolve o texto que a página pôs na área de transferência.
 * O texto é lido durante o próprio evento: o Firefox protege os dados de um evento sintético
 * depois que ele termina.
 */
async function copy(page: Page): Promise<string> {
  return grid(page).evaluate((el) => {
    let text = '';
    const read = (e: Event) => {
      text = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    };
    document.addEventListener('copy', read);
    el.dispatchEvent(
      new ClipboardEvent('copy', {
        clipboardData: new DataTransfer(),
        bubbles: true,
        cancelable: true,
      }),
    );
    document.removeEventListener('copy', read);
    return text;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('digitar edita, Enter confirma e desce, Esc cancela, F2 edita o valor atual', async ({
  page,
}) => {
  await openCsv(page, 'nome;cep\nAna;01310100\nBia;20040002\n');
  await cell(page, 'Ana').click();
  await page.keyboard.type('Alice');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Alice')).toBeVisible();
  // Enter desceu para "Bia": Esc cancela uma edição.
  await page.keyboard.type('zzz');
  await page.keyboard.press('Escape');
  await expect(cell(page, 'Bia')).toBeVisible();
  // F2 edita a partir do valor atual.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('F2');
  await page.keyboard.press('End');
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await expect(cell(page, '200400029')).toBeVisible();
  // Zero à esquerda digitado continua.
  await cell(page, '01310100').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('00123');
  await page.keyboard.press('Enter');
  await expect(cell(page, '00123')).toBeVisible();
  await waitSaved(page);
  await page.reload();
  await expect(cell(page, 'Alice')).toBeVisible();
  expect(await values(page)).toEqual([
    ['Alice', '00123'],
    ['Bia', '200400029'],
  ]);
});

test('Delete deixa vazio; "Definir como nulo" mostra null', async ({ page }) => {
  await openCsv(page, 'a;b\n1;2\n3;4\n');
  await cell(page, '1').click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Delete');
  expect((await values(page))[0]).toEqual(['', '']);
  await cell(page, '3').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Definir como nulo' }).click();
  await expect(grid(page).locator('.dk-cell-null')).toHaveText('null');
  // O painel de informações acompanha as operações (seção 9).
  const info = page.getByRole('region', { name: 'Informações do arquivo' });
  await expect(info.getByText('Células vazias').locator('..')).toContainText('2');
  await expect(info.getByText('Células nulas').locator('..')).toContainText('1');
});

test('desfazer e refazer pelo teclado e pela barra, e o histórico volta depois do F5', async ({
  page,
}) => {
  await openCsv(page, 'a\nx\n');
  const undoButton = page.getByRole('button', { name: /^Desfazer/ });
  const redoButton = page.getByRole('button', { name: /^Refazer/ });
  await expect(undoButton).toBeDisabled();
  await cell(page, 'x').click();
  await page.keyboard.type('y');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('z');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'z')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(cell(page, 'y')).toBeVisible();
  await expect(redoButton).toBeEnabled();
  await undoButton.click();
  await expect(cell(page, 'x')).toBeVisible();
  await expect(undoButton).toBeDisabled();
  await page.keyboard.press('Control+y');
  await expect(cell(page, 'y')).toBeVisible();
  await waitSaved(page);

  await page.reload();
  await expect(cell(page, 'y')).toBeVisible();
  await expect(redoButton).toHaveAttribute('title', /Refazer: Editar célula/);
  await page.keyboard.press('Control+Shift+Z');
  await expect(cell(page, 'z')).toBeVisible();
  await page.getByRole('button', { name: /^Desfazer/ }).click();
  await page.getByRole('button', { name: /^Desfazer/ }).click();
  await expect(cell(page, 'x')).toBeVisible();
});

test('edição feita logo antes do F5 não se perde', async ({ page }) => {
  await openCsv(page, 'a\nantes\n');
  await cell(page, 'antes').click();
  await page.keyboard.type('depois');
  await page.keyboard.press('Enter');
  // Recarrega antes do envio (debounce de 300 ms): a fila do sessionStorage reenvia.
  await page.reload();
  await expect(cell(page, 'depois')).toBeVisible();
  await waitSaved(page);
  await page.reload();
  await expect(cell(page, 'depois')).toBeVisible();
});

test('sem conexão, as edições ficam na fila e são enviadas quando a rede volta', async ({
  page,
  context,
}) => {
  await openCsv(page, 'a\n1\n');
  await context.setOffline(true);
  await cell(page, '1').click();
  await page.keyboard.type('offline');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Sem conexão — tentando novamente');
  await context.setOffline(false);
  await expect(status(page)).toHaveText('Salvo', { timeout: 15_000 });
  await page.reload();
  await expect(cell(page, 'offline')).toBeVisible();
});

test('copiar e colar no formato do Excel; colar além da borda pergunta antes', async ({ page }) => {
  await openCsv(page, 'a;b\n1;2\n3;4\n');
  await cell(page, '1').click();
  await page.keyboard.press('Shift+ArrowDown');
  expect(await copy(page)).toBe('1\r\n3');

  await cell(page, '4').click();
  await paste(page, 'p\tq\r\nr\ts\r\n');
  await expect(dialog(page)).toContainText('Adicionar 1 linha e 1 coluna?');
  await page.getByRole('button', { name: 'Adicionar e colar' }).click();
  expect(await values(page)).toEqual([
    ['1', '2', ''],
    ['3', 'p', 'q'],
    ['', 'r', 's'],
  ]);
  await page.keyboard.press('Control+z');
  expect(await values(page)).toEqual([
    ['1', '2'],
    ['3', '4'],
  ]);
});

test('copiar e colar dentro do DataKit mantém o nulo (L18)', async ({ page }) => {
  await openCsv(page, 'a;b\n1;2\n');
  await cell(page, '1').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Definir como nulo' }).click();
  await grid(page).locator('.dk-cell-null').click();
  const text = await copy(page);
  expect(text).toBe('');
  await cell(page, '2').click();
  await paste(page, text);
  await expect(grid(page).locator('.dk-cell-null')).toHaveCount(2);
});

test('inserir e excluir linhas e colunas pelo menu, renomear com duplo clique', async ({
  page,
}) => {
  await openCsv(page, 'a;b\n1;2\n3;4\n');
  await cell(page, '3').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Inserir linha acima' }).click();
  expect(await values(page)).toEqual([
    ['1', '2'],
    ['', ''],
    ['3', '4'],
  ]);

  await grid(page).getByRole('rowheader', { name: '1' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Excluir linha' }).click();
  expect(await values(page)).toEqual([
    ['', ''],
    ['3', '4'],
  ]);

  await grid(page).getByRole('columnheader', { name: /^b/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Inserir coluna à direita' }).click();
  await expect(grid(page).getByRole('columnheader', { name: /coluna_3/ })).toBeVisible();

  await grid(page).getByRole('columnheader', { name: /^a/ }).dblclick();
  await page.getByRole('textbox', { name: 'Nome' }).fill('primeira');
  await page.keyboard.press('Enter');
  await expect(grid(page).getByRole('columnheader', { name: /primeira/ })).toBeVisible();

  await grid(page).getByRole('columnheader', { name: /^b/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Excluir coluna' }).click();
  await expect(grid(page).getByRole('columnheader')).toHaveCount(2);

  // Tudo volta com desfazer, uma operação por vez.
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Control+z');
  expect(await values(page)).toEqual([
    ['1', '2'],
    ['3', '4'],
  ]);
  await expect(grid(page).getByRole('columnheader', { name: /^a/ })).toBeVisible();
});

test('marcas de alteração, contador e confirmação ao abrir outro arquivo', async ({ page }) => {
  await openCsv(page, 'a\n1\n2\n');
  await cell(page, '2').click();
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await expect(cell(page, '9')).toHaveClass(/is-edited/);
  await expect(cell(page, '1')).not.toHaveClass(/is-edited/);
  await expect(page.getByTestId('unexported-changes')).toHaveText('1 ●');
  await expect(page.getByLabel('Alterações não exportadas')).toBeVisible();

  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'outro.csv', mimeType: 'text/csv', buffer: Buffer.from('x\n1\n') });
  await expect(dialog(page)).toContainText('1 alteração que ainda não foram exportadas');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(cell(page, '9')).toBeVisible();
});

test('largura da coluna: arrastar a borda e voltar igual depois do F5', async ({ page }) => {
  await openCsv(page, 'curta;b\n1;2\n');
  const header = grid(page).getByRole('columnheader', { name: /curta/ });
  const before = (await header.boundingBox())?.width ?? 0;
  const handle = header.locator('.dk-col-resizer');
  const box = await handle.boundingBox();
  if (!box) throw new Error('sem alça');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  // A grade redesenha logo depois do arraste; espera a largura nova aparecer.
  await expect
    .poll(async () => (await header.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before + 100);
  const after = (await header.boundingBox())?.width ?? 0;
  await page.reload();
  const restoredHeader = grid(page).getByRole('columnheader', { name: /curta/ });
  await expect
    .poll(async () => Math.abs(((await restoredHeader.boundingBox())?.width ?? 0) - after))
    .toBeLessThan(2);
});

test('seleção pelo teclado e posição na barra inferior', async ({ page }) => {
  await openCsv(page, 'a;b;c\n1;2;3\n4;5;6\n');
  await cell(page, '1').click();
  await expect(page.getByRole('status').last()).toContainText('L1 a');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('status').last()).toContainText('L1–L2 · 2 × 2');
  await page.keyboard.press('Control+End');
  await expect(page.getByRole('status').last()).toContainText('L2 c');
  await expect(cell(page, '6')).toHaveClass(/is-focus/);
  // A célula em foco volta depois do F5.
  await page.reload();
  await expect(cell(page, '6')).toHaveClass(/is-focus/);
});
