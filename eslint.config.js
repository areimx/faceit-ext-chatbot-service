const { globalIgnores } = require('@eslint/config-helpers');
const js = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const importPlugin = require('eslint-plugin-import');
const nodePlugin = require('eslint-plugin-n');
const promisePlugin = require('eslint-plugin-promise');
const securityPlugin = require('eslint-plugin-security');
const unusedImportsPlugin = require('eslint-plugin-unused-imports');
const globals = require('globals');

module.exports = defineConfig([
  globalIgnores(['node_modules/**', 'temp/**', '*.log', '*.min.js']),

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      n: nodePlugin,
      promise: promisePlugin,
      import: importPlugin,
      security: securityPlugin,
      'unused-imports': unusedImportsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...nodePlugin.configs.recommended.rules,
      ...promisePlugin.configs.recommended.rules,
      ...importPlugin.configs.recommended.rules,
      ...securityPlugin.configs.recommended.rules,

      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      'n/no-process-exit': 'off',
      'no-console': 'off',
      'n/no-sync': 'warn',
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
  },

  {
    files: ['*.config.js', 'ecosystem.config.js', 'eslint.config.js'],
    rules: {
      'n/no-unpublished-require': 'off',
      'n/no-missing-require': 'off',
      'import/no-unresolved': 'off',
    },
  },
]);
