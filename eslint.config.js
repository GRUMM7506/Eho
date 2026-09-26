import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist', 'dev-dist', 'node_modules', 'echo-game.html', 'public', 'android', 'release', 'build'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // Главный процесс Electron — CommonJS.
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'localStorage'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Симуляция детерминирована: Math.random запрещён.' },
        { object: 'Date', property: 'now', message: 'Симуляция детерминирована: Date запрещён.' },
      ],
      'no-restricted-imports': ['error', { patterns: ['three', 'three/*', '../render/*', '../ui/*'] }],
    },
  },
);
