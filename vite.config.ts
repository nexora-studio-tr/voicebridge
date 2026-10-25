import { defineConfig } from 'vite';
export default defineConfig({
  root: 'src/web',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    rolldownOptions: {
      onwarn(warning, handler) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client'))
          return;
        handler(warning);
      },
    },
  },
  server: { host: '127.0.0.1' },
});
