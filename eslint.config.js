import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/api/src/generated/**',
      'playwright-report/**',
      'test-results/**',
      '.tmp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Seção 16, regra 5: sem `any` e sem desligar o verificador.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: globals.browser },
  },
  {
    // O core roda no navegador e no servidor: nada de APIs de um lado só.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'localStorage',
        'sessionStorage',
        'process',
        'Buffer',
        'require',
      ],
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path'] }],
    },
  },
  {
    // Leitura, escrita e exportação: número nunca passa por double para ser guardado ou gravado
    // (docs/PLANO.md, regra 4). Os testes podem usar.
    files: ['packages/core/src/formats/**/*.ts', 'packages/core/src/export/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='Number']",
          message: 'Não converta número com Number(): guarde e grave o texto exato.',
        },
        {
          selector:
            "CallExpression[callee.name='parseFloat'], CallExpression[callee.name='parseInt']",
          message: 'Não converta número com parseFloat/parseInt: guarde e grave o texto exato.',
        },
        {
          selector: "CallExpression[callee.object.name='Number'][callee.property.name=/^parse/]",
          message: 'Não converta número com Number.parse*: guarde e grave o texto exato.',
        },
      ],
    },
  },
);
