import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BUILD_ID = เวลาที่ build — ฝังลงโค้ด (__BUILD_ID__) และเขียนเป็น dist/version.json
// ให้ version guard ใน src/main.jsx เทียบได้ว่าแท็บนี้ถือเวอร์ชันล่าสุดอยู่มั้ย
const BUILD_ID = Date.now().toString()

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
