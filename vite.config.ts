import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/mocap-webapp/', // 👈 important for GitHub Pages
})
