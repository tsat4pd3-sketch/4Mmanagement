import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import schemaUsage from '../scripts/vite-plugin-schema-usage.mjs'
const MOCK = '/home/user/4Mmanagement/audit/mockSupabase.js'
export default defineConfig({
  root: '/home/user/4Mmanagement',
  plugins: [react(), schemaUsage('/home/user/4Mmanagement')],
  resolve: { alias: [
    { find: /(^|\/)\.\.\/supabaseClient$/, replacement: MOCK },
    { find: /^\.\.\/\.\.\/supabaseClient$/, replacement: MOCK },
    { find: /^\.\/supabaseClient$/, replacement: MOCK },
  ]},
  server: { port: 5199, strictPort: true },
})
