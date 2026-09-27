import { defineConfig } from 'vite';

// Hosts allowed to reach the servers through a tunnel (Vite rejects unknown Host headers).
const tunnelHosts = ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'];

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true, allowedHosts: tunnelHosts },
  // `npm run preview` serves the production build (dist/) — use this one for sharing.
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, allowedHosts: tunnelHosts },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
