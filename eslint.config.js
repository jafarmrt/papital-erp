// v7.0.65 (audit P3-4 / P3-2 / P3-3): ESLint روی سرور و کلاینت با فایل پایه (eslint-baseline.json).
// تخلفات موجود در فایل پایه شمرده شده‌اند؛ `npm run lint:eslint` افزایش هر قاعده را رد می‌کند تا عددها فقط کم شوند.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// v7.0.109 (TD-106، تصمیم مالک محصول): مسیرهای پول و انبار سرور any ندارند و any تازه در آن‌ها اصلاً پذیرفته نمی‌شود
// (سطح error؛ scripts/eslint-ratchet.ts هر پیام error را بدون توجه به فایل پایه رد می‌کند و any خاموش‌شده با
// eslint-disable در این مسیرها را هم خطا می‌شمرد).
export const MONEY_STOCK_PATHS = [
  'src/services/accounting/**/*.ts',
  'src/services/accounting.service.ts',
  'src/services/documents/**/*.ts',
  'src/services/document.service.ts',
  'src/services/inventory/**/*.ts',
  'src/services/items/**/*.ts',
  'src/services/items.service.ts',
  'src/services/reconciliation/**/*.ts',
  'src/services/woocommerce/**/*.ts',
  'src/services/procurement.service.ts',
  'src/services/piecework.service.ts',
  'src/services/piecework/**/*.ts',
  'src/services/transfer.service.ts',
  'src/services/warehouse.service.ts',
  'src/routes/accounting.routes.ts',
  'src/routes/accounting/**/*.ts',
  'src/routes/documents.routes.ts',
  'src/routes/inventory.routes.ts',
  'src/routes/items*.routes.ts',
  'src/routes/piecework.routes.ts',
  'src/routes/procurement.routes.ts',
  'src/routes/transactions.routes.ts',
  'src/routes/transfers.routes.ts',
  'src/routes/woocommerce.routes.ts',
  'src/lib/money.ts',
  'src/lib/financialDecimal.ts',
  'src/lib/voucherBalance.ts',
  'src/lib/stockAvailability.ts',
];

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
  {
    files: MONEY_STOCK_PATHS,
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    // v8.0.31: فایل‌های چنج‌لاگ داده افزایشی‌اند، نه کد (اندازه هر مدخل را compactRule.ts می‌سنجد)؛ max-lines بر آن‌ها اعمال
    // نمی‌شود. سری بسته (7.ts) منجمد است و سری فعال (8.ts) با هر انتشار بزرگ‌تر می‌شود.
    files: ['src/data/changelogs/*.ts'],
    rules: { 'max-lines': 'off' },
  },
);
