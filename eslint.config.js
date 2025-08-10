const js = require('@eslint/js');
const nodePlugin = require('eslint-plugin-n');
const securityPlugin = require('eslint-plugin-security');
const promisePlugin = require('eslint-plugin-promise');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'logs/**',
      'temp/**',
      'tmp/**',
      '*.log',
      '*.tgz',
      '*.tar.gz',
      '.env*',
      '!.env.example',
      '.DS_Store',
      '.vscode/**',
      '.idea/**',
      '*.swp',
      '*.swo',
      'docs/**',
      '*.md',
      'package-lock.json',
      'yarn.lock',
      '*.min.js',
      '*.bundle.js',
      '.nyc_output/**',
      '*.har',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
      },
    },
    plugins: {
      n: nodePlugin,
      security: securityPlugin,
      promise: promisePlugin,
    },
    rules: {
      // ESLint recommended rules
      ...js.configs.recommended.rules,

      // Node.js specific rules
      'n/no-missing-require': 'error',
      'n/no-extraneous-require': 'error',
      'n/exports-style': ['error', 'module.exports'],
      'n/prefer-global/process': 'error',
      'n/prefer-global/console': 'error',
      'n/prefer-global/buffer': 'error',
      'n/prefer-promises/fs': 'error',
      'n/prefer-promises/dns': 'error',
      'n/no-unsupported-features/es-syntax': 'off', // Allow modern JS features

      // Security rules
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',

      // Promise rules
      'promise/always-return': 'warn',
      'promise/catch-or-return': 'error',
      'promise/param-names': 'error',
      'promise/no-return-wrap': 'error',
      'promise/no-new-statics': 'error',
      'promise/no-return-in-finally': 'error',
      'promise/valid-params': 'error',

      // General JavaScript rules
      'no-console': 'off',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'no-duplicate-imports': 'error',
      'no-useless-constructor': 'error',
      'no-useless-rename': 'error',
      'object-shorthand': 'error',
      'prefer-destructuring': ['error', { object: true, array: false }],
      'prefer-template': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': 'error',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'prefer-promise-reject-errors': 'error',
      'require-await': 'error',
      'no-return-await': 'error',

      // Code quality rules
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-nested-callbacks': ['warn', 4],
      'max-params': ['warn', 6],
      'max-statements': ['warn', 30],
      'max-lines-per-function': [
        'warn',
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // Configuration files override
  {
    files: ['*.config.js', 'ecosystem.config.js', 'eslint.config.js'],
    rules: {
      'n/no-unpublished-require': 'off',
      'security/detect-child-process': 'off',
    },
  },

  // Test files override
  {
    files: ['**/*.test.js', '**/*.spec.js', '**/test/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        test: 'readonly',
      },
    },
    rules: {
      'max-statements': 'off',
      'max-lines-per-function': 'off',
      'no-unused-expressions': 'off',
    },
  },
];
