/* ══ 🚀 build ของเว็บ New Model (IEC) — แยก output + แยก deploy (2026-10-29 · คำสั่ง user) ══
   *"งาน New Model ได้รับคำสั่งมาให้แยก frontend ออกจากของเดิม"*

   เป้าที่ user เลือก: **รีโปเดียว · build+deploy แยก · Supabase Main + บัญชีเดิม**
   ⇒ โค้ดชุดเดียวกัน (ไม่มี drift) แต่ออกเป็น **คนละเว็บ คนละ deploy** กับระบบแมส

   ┌─ สิ่งเดียวที่ต่างจาก build หลัก ─────────────────────────────────────────────┐
   │ `src/appEdition.js` ถูก alias → `src/appEdition.nm.js`                      │
   │ = "เว็บนี้มีหน้าอะไรบ้าง" + หน้าแรก + ป้ายชื่อ · ที่เหลือคือโปรแกรมตัวเดียวกันเป๊ะ │
   └────────────────────────────────────────────────────────────────────────────┘

   🔴 **ห้ามให้ไฟล์นี้ยุ่งกับ `dist/`** — นั่นคือของเว็บแมส · ออกที่ `dist-nm/` เท่านั้น
   🔴 **ปลั๊กอิน/`define` ต้องตรงกับ `vite.config.js`** — `__BUILD_ID__` กับ `version.json`
      คือกลไกกันแท็บค้างเวอร์ชันเก่าใน `src/main.jsx` · ขาดตัวใดตัวหนึ่ง = จอ IEC ค้างเวอร์ชันเก่า
      ทั้งที่ deploy ไปแล้ว (เคยเกิดกับจอ TV มาแล้ว · ดูคอมเมนต์ใน main.jsx)
      ⇒ **แก้ `vite.config.js` เมื่อไหร่ ต้องตามมาแก้ที่นี่** (มีด่านเทียบ 2 ไฟล์)

   คำสั่ง: `npm run build:nm` → `dist-nm/` → Render service `4mmanagement-nm` (ดู render.yaml)
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import schemaUsage from './scripts/vite-plugin-schema-usage.mjs'

const BUILD_ID = Date.now().toString()
const r = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    schemaUsage(process.cwd()),
    {
      /* 🔴 static host เสิร์ฟ `/` จาก **index.html** และ `public/_redirects` ก็เขียน
         `/* /index.html 200` (SPA rewrite) ⇒ ถ้าปล่อยชื่อ `nm.html` ไว้ = เปิดเว็บแล้ว 404 ทั้งเว็บ
         เปลี่ยนชื่อตอนจบ build (ไม่แตะ bundle ระหว่างทาง = ไม่ชนกับปลั๊กอิน html ของ vite) */
      name: 'nm-html-as-index',
      async closeBundle() {
        await rename(r('./dist-nm/nm.html'), r('./dist-nm/index.html'))
      },
    },
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  resolve: {
    alias: [
      /* 🔑 หัวใจของการแยกเว็บ — ตรงตัวพอดี (`$`) กันไปชนไฟล์ที่ชื่อขึ้นต้นเหมือนกัน */
      { find: /^(.*)\/appEdition$/, replacement: '$1/appEdition.nm' },
    ],
  },
  build: {
    outDir: 'dist-nm',
    emptyOutDir: true,
    rollupOptions: {
      /* entry เดียว = `nm.html` · ไฟล์นั้นชี้ไป `/src/main.jsx` ตัวเดียวกับเว็บแมส */
      input: r('./nm.html'),
    },
  },
})
