import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  build: {
    cssCodeSplit: true,
    cssMinify: 'lightningcss',
    reportCompressedSize: true
  },
  server: {
    // ngrok URLs change each session; allow the domain, not one hostname.
    allowedHosts: ['.ngrok-free.app', '.ngrok.io', '.ngrok.app']
  }
})
