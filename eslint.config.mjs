// Flat ESLint config (ESLint 9+) shared by every TypeScript workspace
// (contracts/, orchestrator/, and future dashboard/ and client-agent/).
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      // Python-only workspace; never linted as JS/TS.
      'model-serving/**',
      '**/.venv/**',
      '**/__pycache__/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: false,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // TypeScript itself catches undefined references/types (e.g. the
      // ambient `NodeJS` namespace) far more accurately than the base
      // no-undef rule, which is why typescript-eslint recommends disabling
      // it for .ts files.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
  {
    // dashboard/ is the one browser-runtime workspace -- `window`, `document`, `fetch`,
    // `EventSource` are ambient globals there, not Node's.
    files: ['dashboard/**/*.ts', 'dashboard/**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  eslintConfigPrettier,
];
