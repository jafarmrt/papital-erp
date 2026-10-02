// v7.0.65 (audit P3-4 / P3-2 / P3-3): ESLint روی سرور و کلاینت با فایل پایه (eslint-baseline.json).
// تخلفات موجود در فایل پایه شمرده شده‌اند؛ `npm run lint:eslint` افزایش هر قاعده را رد می‌کند تا عددها فقط کم شوند.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'vendor/**', 'drizzle/**', 'coverage/**', 'logs/**', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'server.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': ['warn', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // FE-003: کامپوننت‌ها کمتر از ۳۰۰ خط
    files: ['src/**/*.tsx'],
    rules: { 'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }] },
  },
);
