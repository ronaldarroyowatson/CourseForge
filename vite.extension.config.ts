import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  root: 'src/extension',
  build: {
    outDir: '../../dist/extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/extension/index.html')
      }
    }
  },
  plugins: [
    react(),
    {
      name: 'copy-extension-files',
      closeBundle() {
        // Copy manifest.json
        fs.copyFileSync(
          resolve(__dirname, 'src/extension/manifest.json'),
          resolve(__dirname, 'dist/extension/manifest.json')
        );

        // Copy background.js (since yours is not in a folder)
        fs.copyFileSync(
          resolve(__dirname, 'src/extension/background.js'),
          resolve(__dirname, 'dist/extension/background.js')
        );
      }
    }
  ]
});
