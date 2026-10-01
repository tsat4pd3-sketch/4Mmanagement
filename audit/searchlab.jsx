/* lab: picker กลาง "พิมพ์แล้วต้องกรอง" — พาเรนต์เก็บค่าที่พิมพ์แบบเดียวกับ EdiMatchFixer (2026-10-01)
   เปิด `npx vite --config audit/vite.audit.mjs --port 5199` แล้วเข้า /audit/searchlab.html */
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProductSelect from '../src/components/ProductSelect'
import '../src/index.css'
const PRODUCTS = Array.from({ length: 127 }, (_, i) => ({ id: i + 1, mat_no: String(10090000 + i * 37), name: `PART ${i}`, p_no: `PB3C-${1000 + i}`, customer: 'TSRA', line_name: 'LINE A' }))
PRODUCTS[5] = { ...PRODUCTS[5], name: 'REINF FRT FNDR RH-MB3B-16C274', p_no: 'MB3B-16C274-CF' }
function App() {
  const [v, setV] = useState('')
  return <div style={{ padding: 20, width: 600 }}>
    <ProductSelect products={PRODUCTS} value={v} onChange={o => setV(o?.mat_no || '')} />
    <div id="val" style={{ color: '#fff', marginTop: 260 }}>{v}</div>
    <button id="away">away</button>
  </div>
}
createRoot(document.getElementById('root')).render(<App />)
