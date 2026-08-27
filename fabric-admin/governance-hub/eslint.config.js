import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'rayfin/.temp', 'bootstrap/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Module boundary rule (PLAN.md §8.1): nothing outside `src/modules` may
    // reach into a module folder — cross-module behaviour goes through the
    // registry. `@/modules/types` is the shared contract and stays allowed.
    // The structural test in `src/__tests__/moduleBoundaries.test.ts` enforces
    // the same rule from the other direction (module → module imports).
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/modules/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*', '!@/modules/types'],
              message:
                'Import modules through the registry (@/modules), not by folder.',
            },
          ],
        },
      ],
    },
  }
);
