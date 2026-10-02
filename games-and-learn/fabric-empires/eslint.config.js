import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Plain TypeScript and three.js, no React, so the React plugins the other apps
// load have nothing to check here.
export default tseslint.config(
  {
    ignores: ['**/dist', '**/node_modules', 'rayfin/.temp', 'media'],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  }
);
