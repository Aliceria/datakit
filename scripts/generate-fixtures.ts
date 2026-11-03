// Gera os arquivos de teste de fixtures/ (seção 14).
// Os pequenos são versionados; os grandes (fixtures/large/) são gerados sob demanda e ignorados no git.
//   node scripts/generate-fixtures.ts           → fixtures pequenos
//   node scripts/generate-fixtures.ts --large   → também o CSV de 100.000 linhas
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import ExcelJS from 'exceljs';

const root = path.resolve(import.meta.dirname, '..', 'fixtures');

function write(relative: string, data: string | Uint8Array): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`  ${relative}`);
}

const utf8 = (s: string) => Buffer.from(s, 'utf8');
// Para os caracteres usados aqui, ISO-8859-1 e Windows-1252 têm os mesmos bytes.
const cp1252 = (s: string) => Buffer.from(s, 'latin1');

// ----- CSV -----------------------------------------------------------------------------------

function csvFixtures(): void {
  write(
    'csv/excel-br-1252.csv',
    cp1252(
      'nome;preço;data;cidade\r\n' +
        'Ana;1.234,56;01/02/2024;São Paulo\r\n' +
        'João;89,90;15/03/2024;Açú\r\n' +
        'Conceição;0,50;20/03/2024;Maceió\r\n',
    ),
  );
  write(
    'csv/utf8-bom.csv',
    Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      utf8('id,nome,ativo\n1,Ana,true\n2,Bia,false\n'),
    ]),
  );
  write(
    'csv/quotes-newlines.csv',
    utf8('id,descricao,obs\n1,"vírgula, dentro","diz ""oi"""\n2,"duas\nlinhas",fim\n'),
  );
  write('csv/ragged.csv', utf8('a;b;c\n1;2;3\n4;5\n6\n7;8;9\n'));
  write(
    'csv/cep-cpf.csv',
    utf8(
      'nome;cep;cpf;telefone;id_grande\n' +
        'Ana;01310100;012.345.678-90;011987654321;12345678901234567890\n' +
        'Bia;20040002;123.456.789-01;021912345678;98765432109876543210\n',
    ),
  );
  write(
    'csv/layout.csv',
    utf8(
      'nome;preço;data\nAna;1.234,56;01/02/2024\n;89,90;\n  ;;15/03/2024\nBruno;0012;20/03/2024\n',
    ),
  );
}

// ----- JSON ----------------------------------------------------------------------------------

function jsonFixtures(): void {
  write(
    'json/nested-heterogeneous.json',
    utf8(`[
  {"id": 1, "nome": "Ana", "endereco": {"cidade": "São Paulo", "uf": "SP"}, "tags": ["a", "b"]},
  {"id": 2, "nome": null, "email": "", "endereco": {"cidade": "Rio"}},
  {"id": 3, "codigo": "123", "valor": 123, "endereco": {}}
]
`),
  );
  write(
    'json/bigint.json',
    utf8('[{"id": 12345678901234567890, "seguro": 9007199254740991, "acima": 9007199254740993}]\n'),
  );
  write(
    'json/dangerous-keys.json',
    utf8(
      '[{"__proto__": {"admin": true}, "constructor": "c", "prototype": 1, "chave.com.ponto": "x", "a": {"b.c": 2}}]\n',
    ),
  );
  write(
    'json/root-object.json',
    utf8('{"versao": 2, "clientes": [{"id": 1}, {"id": 2}], "pedidos": [{"n": 10}]}\n'),
  );
  write('json/numeric-keys.json', utf8('[{"b": 1, "10": 2, "a": 3, "2": 4}]\n'));
}

// ----- XLSX ----------------------------------------------------------------------------------

async function xlsxFixtures(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Clientes');
  ws.addRow(['nome', 'valor', 'data', 'cep', 'dobro', 'taxa']);
  ws.getRow(1).font = { bold: true };
  ws.addRow([
    'Ana',
    1234.56,
    new Date(Date.UTC(2024, 1, 1)),
    '01310100',
    { formula: 'B2*2', result: 2469.12 },
    0.15,
  ]);
  ws.addRow([
    { richText: [{ text: 'Bi' }, { font: { bold: true }, text: 'a' }] },
    89.9,
    new Date(Date.UTC(2024, 2, 15, 13, 45, 0)),
    '20040002',
    { formula: 'B3*2', result: 179.8 },
    0.5,
  ]);
  ws.addRow([
    'Erro',
    { error: '#DIV/0!' },
    null,
    null,
    { formula: '1/0', result: { error: '#DIV/0!' } },
    null,
  ]);
  // O XLSX guarda double: este número perde precisão de propósito, para testar a leitura.
  ws.addRow(['Grande', Number('12345678901234567890'), null, null, null, null]);
  ws.getCell('F2').numFmt = '0%';
  ws.mergeCells('A6:C6');
  ws.getCell('A6').value = 'mesclada';
  ws.getCell('A7').value = true;

  wb.addWorksheet('Vazia');
  const hidden = wb.addWorksheet('Oculta', { state: 'hidden' });
  hidden.addRow(['segredo']);
  hidden.addRow([42]);

  write('xlsx/multi-sheet.xlsx', new Uint8Array(await wb.xlsx.writeBuffer()));

  const wb1904 = new ExcelJS.Workbook();
  wb1904.properties.date1904 = true;
  const s = wb1904.addWorksheet('Datas');
  s.addRow(['evento', 'data']);
  s.addRow(['lançamento', new Date(Date.UTC(2024, 1, 1))]);
  s.addRow(['virada', new Date(Date.UTC(1999, 11, 31, 23, 59, 0))]);
  write('xlsx/dates-1904.xlsx', new Uint8Array(await wb1904.xlsx.writeBuffer()));
}

// ----- Inválidos -----------------------------------------------------------------------------

type ZipFile = { name: string; data: Uint8Array; declaredSize?: number };

/** ZIP mínimo (deflate). `declaredSize` permite mentir o tamanho descompactado. */
function makeZip(files: ZipFile[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = zlib.deflateRawSync(file.data, { level: 9 });
    const crc = zlib.crc32(file.data);
    const size = file.declaredSize ?? file.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function invalidFixtures(): void {
  write('invalid/syntax-error.json', utf8('[\n  {"a": 1},\n  {"b" 2}\n]\n'));
  write('invalid/root-number.json', utf8('42\n'));
  write('invalid/csv-content.xlsx', utf8('a;b\n1;2\n'));
  write('invalid/not-xlsx-zip.xlsx', makeZip([{ name: 'word/document.xml', data: utf8('<x/>') }]));
  write('invalid/unclosed-quote.csv', utf8('a;b\n1;"sem fim\n2;3\n'));

  const workbook = { name: 'xl/workbook.xml', data: utf8('<workbook/>') };
  const zeros = new Uint8Array(210 * 1024 * 1024);
  // Bomba honesta: o tamanho declarado já passa do limite de 200 MB.
  write('invalid/zip-bomb.xlsx', makeZip([workbook, { name: 'xl/bomba.bin', data: zeros }]));
  // Bomba mentirosa: declara 1 KB, mas descompacta 210 MB.
  write(
    'invalid/zip-bomb-lying.xlsx',
    makeZip([workbook, { name: 'xl/bomba.bin', data: zeros, declaredSize: 1024 }]),
  );
}

// ----- Grandes -------------------------------------------------------------------------------

function largeFixtures(): void {
  const lines = [
    'id;nome;cidade;valor;data;cep;ativo;obs;codigo;email;' +
      'c11;c12;c13;c14;c15;c16;c17;c18;c19;c20',
  ];
  for (let i = 1; i <= 100_000; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((i % 12) + 1).padStart(2, '0');
    lines.push(
      [
        i,
        `Pessoa ${i}`,
        i % 3 === 0 ? 'São Paulo' : 'Rio de Janeiro',
        `${Math.floor(i / 7)},${String(i % 100).padStart(2, '0')}`,
        `${day}/${month}/2024`,
        String(i * 37).padStart(8, '0'),
        i % 2 === 0 ? 'true' : 'false',
        i % 10 === 0 ? '' : 'ok',
        `C${i}`,
        `p${i}@exemplo.com`,
        ...Array.from({ length: 10 }, (_, k) => `v${k}-${i % 1000}`),
      ].join(';'),
    );
  }
  write('large/100k.csv', utf8(lines.join('\r\n') + '\r\n'));
}

console.log('Gerando fixtures em fixtures/:');
csvFixtures();
jsonFixtures();
await xlsxFixtures();
invalidFixtures();
if (process.argv.includes('--large')) largeFixtures();
