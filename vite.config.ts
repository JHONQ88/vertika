import react from '@vitejs/plugin-react';
import { eveVite } from 'eve/vite';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    ...(command === 'serve' ? [eveVite()] : []),
  ],
}));
