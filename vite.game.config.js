import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig from './vite.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  ...baseConfig,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html')
      }
    }
  }
};
