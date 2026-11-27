import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import schemaUsage from '../scripts/vite-plugin-schema-usage.mjs'
import { fileURLToPath } from 'node:url'
// หา path รีโปจากตำแหน่งไฟล์นี้ (audit/ → ..) — ห้าม hardcode `/home/user/<ชื่อรีโป>`
// (รีโปเปลี่ยนชื่อ 4Mmanagement → ESM 27/11 · เครื่อง smf01 อยู่ path อื่น)
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const MOCK = fileURLToPath(new URL('./mockSupabase.js', import.meta.url))
export default defineConfig({
  root: ROOT,
  plugins: [react(), schemaUsage(ROOT)],
  resolve: { alias: [
    { find: /(^|\/)\.\.\/supabaseClient$/, replacement: MOCK },
    { find: /^\.\.\/\.\.\/supabaseClient$/, replacement: MOCK },
    { find: /^\.\/supabaseClient$/, replacement: MOCK },
  ]},
  server: { port: 5199, strictPort: true },
})
