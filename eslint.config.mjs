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
      'model-serving/**',
      '**/.venv/**',
      '**/__pycache__/**',
    ],
  },

  js.configs.recommended,

  // Node.js scripts (.mjs)
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // TypeScript
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
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },

  // Browser React code
  {
    files: ['dashboard/**/*.ts', 'dashboard/**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  eslintConfigPrettier,
];