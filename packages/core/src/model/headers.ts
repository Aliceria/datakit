/**
 * Nomes de coluna a partir do cabeçalho (seção 6.1):
 * vazio vira `coluna_N` (N = posição, a partir de 1) e repetido ganha sufixo: `nome`, `nome (2)`.
 * O texto original não é aparado: " nome" e "nome" são nomes diferentes.
 */
export function makeColumnNames(candidates: ReadonlyArray<string | undefined>): {
  names: string[];
  renamed: number;
} {
  const used = new Set<string>();
  const names: string[] = [];
  let renamed = 0;

  const base = candidates.map((candidate, i) =>
    candidate === undefined || candidate.trim() === '' ? `coluna_${i + 1}` : candidate,
  );
  // Nomes explícitos reservam o lugar primeiro, para "coluna_2" escrito no arquivo não ser trocado.
  const explicit = new Set(base);

  base.forEach((name, i) => {
    let final = name;
    if (used.has(final)) {
      let n = 2;
      while (used.has(`${name} (${n})`) || explicit.has(`${name} (${n})`)) n += 1;
      final = `${name} (${n})`;
    }
    if (final !== candidates[i]) renamed += 1;
    used.add(final);
    names.push(final);
  });

  return { names, renamed };
}
