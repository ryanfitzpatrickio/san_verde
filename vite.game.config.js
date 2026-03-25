import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import baseConfig from './vite.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig((env) => {
  const resolvedBaseConfig =
    typeof baseConfig === 'function'
      ? baseConfig(env)
      : baseConfig;

  return {
    ...resolvedBaseConfig,
    build: {
      ...(resolvedBaseConfig.build || {}),
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        ...(resolvedBaseConfig.build?.rollupOptions || {}),
        input: {
          main: path.resolve(__dirname, 'index.html')
        }
      }
    }
  };
});
