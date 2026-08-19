import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
const MOCK = '/home/user/4Mmanagement/audit/mockSupabase.js'
export default defineConfig({
  root: '/home/user/4Mmanagement',
  plugins: [react()],
  resolve: { alias: [
    { find: /(^|\/)\.\.\/supabaseClient$/, replacement: MOCK },
    { find: /^\.\.\/\.\.\/supabaseClient$/, replacement: MOCK },
    { find: /^\.\/supabaseClient$/, replacement: MOCK },
  ]},
  server: { port: 5199, strictPort: true },
})
