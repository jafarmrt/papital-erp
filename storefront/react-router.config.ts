import type { Config } from '@react-router/dev/config';

// Server-rendered on every request: prices and stock come from the ERP at request time (start plan 8.3, §1)
export default { ssr: true, appDirectory: 'app' } satisfies Config;
