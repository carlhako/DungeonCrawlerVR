import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'

// `npm run dev`     -> plain http on localhost (fine for desktop, WebXR allows localhost)
// `npm run dev:xr`  -> https over the LAN, which the Quest 3 browser requires for WebXR
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'xr' ? [basicSsl()] : [])],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Bind 0.0.0.0 so other machines on the LAN (desktop, laptop, headset) can reach the
    // dev server, not just this box. Vite prints the reachable network URLs on startup.
    host: true,
    port: 5173,
    strictPort: true,
    // Vite blocks unrecognised Host headers by default; LAN IPs are fine for a dev server
    // on a trusted network and this avoids a confusing "Blocked request" page.
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // three is large and changes rarely — keeping it in its own chunk means a gameplay
        // patch doesn't force players (and the Quest browser) to re-download the engine.
        manualChunks: (id: string) => {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/react')) return 'react'
          return undefined
        },
      },
    },
  },
}))
