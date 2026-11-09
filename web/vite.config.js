import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // dev : proxy vers l'API du bot
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
