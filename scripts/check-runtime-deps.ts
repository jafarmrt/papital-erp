import { build } from 'esbuild';
import { builtinModules } from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * v7.0.84 (TD-177): وابستگی‌های زمان اجرا (`dependencies`) دقیقاً همان بسته‌هایی‌اند که باندل سرور (dist/server.cjs)
 * require می‌کند؛ ایمیج Docker فقط این‌ها را با `npm ci --omit=dev` نصب می‌کند. کتابخانه‌های فرانت‌اند (React، آیکون‌ها،
 * فونت‌ها، xlsx و ...) در باندل Vite جا می‌گیرند و باید در `devDependencies` باشند.
 * گراف import سرور با همان تنظیم اسکریپت build (esbuild، `--packages=external`) ساخته می‌شود.
 *   npm run check:runtime-deps
 */

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
/** بسته‌هایی که فقط در حالت توسعه با import پویا بارگذاری می‌شوند (سرور Vite) و در پروداکشن اجرا نمی‌شوند */
const DEV_ONLY_DYNAMIC_IMPORTS = new Set(['vite']);

export function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || BUILTINS.has(specifier) || BUILTINS.has(specifier.split('/')[0])) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export async function serverRuntimePackages(root = process.cwd()): Promise<Set<string>> {
  const result = await build({
    entryPoints: [resolve(root, 'server.ts')],
    absWorkingDir: root,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    external: ['./src/tests/*'],
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const packages = new Set<string>();
  for (const input of Object.values(result.metafile.inputs)) {
    for (const imp of input.imports) {
      if (!imp.external) continue;
      const name = packageNameOf(imp.path);
      if (name && !(imp.kind === 'dynamic-import' && DEV_ONLY_DYNAMIC_IMPORTS.has(name))) packages.add(name);
    }
  }
  return packages;
}

export interface RuntimeDependencyIssues {
  /** بسته‌ای که سرور require می‌کند ولی در dependencies نیست (ایمیج پروداکشن آن را ندارد) */
  missing: string[];
  /** بسته‌ای در dependencies که سرور require نمی‌کند (حجم بی‌مورد ایمیج) */
  unused: string[];
}

export async function runtimeDependencyIssues(root = process.cwd()): Promise<RuntimeDependencyIssues> {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));
  const used = await serverRuntimePackages(root);
  return {
    missing: [...used].filter((p) => !declared.has(p)).sort(),
    unused: [...declared].filter((p) => !used.has(p)).sort(),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(process.cwd(), 'scripts/check-runtime-deps.ts');
if (isMain) {
  runtimeDependencyIssues()
    .then(({ missing, unused }) => {
      if (missing.length === 0 && unused.length === 0) {
        console.log('✅ Runtime dependencies OK (TD-177): dependencies == packages required by the server bundle');
        return;
      }
      if (missing.length > 0) console.error(`❌ required by the server but not in dependencies: ${missing.join(', ')}`);
      if (unused.length > 0) console.error(`❌ in dependencies but not required by the server (move to devDependencies): ${unused.join(', ')}`);
      process.exitCode = 1;
    })
    .catch((err: unknown) => {
      console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}
