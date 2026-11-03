import path from 'node:path';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  // one contract with the ERP (AGENTS.md §6.5): the storefront reads the Storefront API types and rules from the ERP source
  resolve: { alias: { '@erp': path.resolve(import.meta.dirname, '../src/lib') } },
  server: { port: 5180 },
});
