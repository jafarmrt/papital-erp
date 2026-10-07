import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { copyPublicAssets } from './scripts/publicAssets';

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production' || process.env.NODE_ENV === 'production';
  return {
    plugins: [
      react(),
      tailwindcss(),
      // v9.0.169 (TD-588): public/ is copied without public/uploads (attachments and uploaded images stay where the app serves them)
      {
        name: 'copy-public-assets',
        apply: 'build',
        closeBundle() {
          copyPublicAssets(path.resolve(__dirname, 'public'), path.resolve(__dirname, 'dist'));
        },
      },
      // v4.0.30: آنالیز ترکیب باندل فقط با VISUALIZE=1 → خروجی dist/bundle-stats.html
      ...(process.env.VISUALIZE === '1' ? [visualizer({ filename: 'dist/bundle-stats.html', gzipSize: true, brotliSize: true })] : []),
    ],
    esbuild: {
      drop: isProd ? ['console', 'debugger'] : [],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'react': path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      },
      dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom'],
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-router',
        'react-router-dom',
        '@tanstack/react-query',
        'lucide-react',
      ],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      // v9.0.169 (TD-588): the copy-public-assets plugin above copies public/ instead (without uploads)
      copyPublicDir: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/')) {
                return 'vendor-react';
              }
              if (id.includes('@tanstack/react-query')) {
                return 'vendor-query';
              }
              if (id.includes('xlsx')) {
                return 'vendor-excel';
              }
              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }
            }
            if (id.includes('/src/components/common/')) {
              return 'common-components';
            }
            if (id.includes('/src/data/changelogs/') || id.includes('/src/data/appInfoAndChangelog')) {
              return 'changelog-data';
            }
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
  };
});
