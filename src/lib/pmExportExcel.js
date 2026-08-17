import { supabaseDR } from '../supabaseClient'

// ── Helpers ───────────────────────────────────────────────────

function fmt(v, d = 3) {
  if (v == null || v === '') return ''
  return Number(v).toFixed(d).replace(/\.?0+$/, '')
}

// รูปอ้างอิงต่อ checkpoint (jig_checkpoints.image_path ใน bucket jig-images)
async function fetchImageBuffer(path) {
  if (!path) return null
  try {
    const url = supabaseDR.storage.from('jig-images').getPublicUrl(path).data.publicUrl
    const res = await fetch(url)
    return new Uint8Array(await res.arrayBuffer())
  } catch { return null }
}
const imgExt = (path) => /\.png$/i.test(path ?? '') ? 'png' : 'jpeg'

function signatureToBuffer(dataUrl) {
  if (!dataUrl) return null
  try {
    const base64 = dataUrl.split(',')[1]
    const binary = atob(base64)
    const buf = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
    return buf
  } catch { return null }
}

function cell(ws, ref) { return ws.getCell(ref) }

function setVal(ws, ref, value, { bold, center, wrap, size, color, fill, border } = {}) {
  const c = cell(ws, ref)
  c.value = value
  const font = {}
  if (bold)  font.bold = true
  if (size)  font.size = size
  if (color) font.color = { argb: color }
  if (Object.keys(font).length) c.font = font
  if (center || wrap) {
    c.alignment = { horizontal: center ? 'center' : 'left', vertical: 'middle', wrapText: !!wrap }
  }
  if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
  if (border) {
    const b = { style: 'thin' }
    c.border = { top: b, bottom: b, left: b, right: b }
  }
}

function merge(ws, from, to) {
  try { ws.mergeCells(`${from}:${to}`) } catch {}
}

function borderRange(ws, r1, c1, r2, c2) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c)
      cell.border = {
        top:    r === r1 ? { style: 'thin' } : undefined,
        bottom: r === r2 ? { style: 'thin' } : undefined,
        left:   c === c1 ? { style: 'thin' } : undefined,
        right:  c === c2 ? { style: 'thin' } : undefined,
      }
    }
  }
}

// Column letter from 1-based index
function colLetter(n) {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// Category meta comes from the user-managed taxonomy (passed as `categories`).
function hexToArgb(hex) {
  let h = (hex ?? '').trim().replace(/^#/, '')
  if (/^[a-f\d]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('')  // #f00 → ff0000
  const m = /^([a-f\d]{6})/i.exec(h)  // first 6 hex; any trailing alpha is ignored
  return m ? 'FF' + m[1].toUpperCase() : 'FF6B7280'
}
function buildCategoryMeta(categories) {
  const meta = {}
  for (const c of categories ?? []) meta[c.code] = { label: c.label, short: c.code, argb: hexToArgb(c.color) }
  return meta
}

const COL_WIDTHS = [4, 12, 4, 7, 5, 5, 8, 6, 6, 6, 6, 5, 14, 6, 6, 10, 8]
const TOTAL_COLS = 17

/**
 * Export one inspection to Excel matching Form FM-JIG-003 (Thai Summit PM JIG form)
 *
 * @param {object} opts
 *   jig        - jig record
 *   inspection - inspection record
 *   checkpoints - sorted checkpoint records (with .category field)
 *   results    - map checkpoint_id → inspection_result
 *   inspector  - { email, signature_data }
 *   approver   - { email, signature_data } | null
 *   exporter   - { email, signature_data }
 */
export async function exportInspectionExcel({
  jig,
  inspection,
  checkpoints,
  results,
  inspector,
  approver,
  exporter,
  categories,
  docForm,
}) {
  const CATEGORY_META = buildCategoryMeta(categories)
  /* exceljs โหลดตอนกด export เท่านั้น (lazy chunk ใช้ร่วมกับตัว export อื่น) */
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PM JIG System'
  const ws = wb.addWorksheet('PM JIG', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  })

  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  ws.properties.defaultRowHeight = 14

  const lastCol = colLetter(TOTAL_COLS) // 'Q'

  // ── HEADER BLOCK (rows 1–5) ───────────────────────────────
  ws.getRow(1).height = 14
  merge(ws, 'A1', 'L1')
  setVal(ws, 'A1', 'บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด (สาขา 1)  Thai Summit Automotive Co.,Ltd (Branch 1)', { bold: true, size: 9, center: true })

  merge(ws, 'M1', 'M1'); setVal(ws, 'M1', 'ISSUED',   { bold: true, center: true, size: 8, border: true })
  merge(ws, 'N1', 'O1'); setVal(ws, 'N1', 'CHECKED',  { bold: true, center: true, size: 8, border: true })
  merge(ws, 'P1', 'Q1'); setVal(ws, 'P1', 'APPROVED', { bold: true, center: true, size: 8, border: true })

  ws.getRow(2).height = 18
  merge(ws, 'A2', 'L2')
  setVal(ws, 'A2', 'Preventive Maintenance JIG', { bold: true, size: 14, center: true })

  merge(ws, 'M2', 'M4'); merge(ws, 'N2', 'O4'); merge(ws, 'P2', 'Q4')
  ws.getRow(3).height = 32
  ws.getRow(4).height = 32

  ws.getRow(5).height = 14
  merge(ws, 'A5', 'D5'); setVal(ws, 'A5', '00', { center: true, size: 8 })
  merge(ws, 'E5', 'H5'); setVal(ws, 'E5', 'Initial issue', { center: true, size: 8 })
  merge(ws, 'I5', 'L5')
  const dateStr = new Date(inspection.inspected_at).toLocaleDateString('th-TH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  setVal(ws, 'I5', dateStr, { center: true, size: 8 })
  setVal(ws, 'M5', inspector?.email ?? '', { center: true, size: 7 })
  merge(ws, 'N5', 'O5'); setVal(ws, 'N5', approver?.email ?? '', { center: true, size: 7 })
  merge(ws, 'P5', 'Q5'); setVal(ws, 'P5', exporter?.email ?? '', { center: true, size: 7 })

  const addSig = async (dataUrl, colIdx, rowStart) => {
    const buf = signatureToBuffer(dataUrl)
    if (!buf) return
    const imgId = wb.addImage({ buffer: buf, extension: 'png' })
    ws.addImage(imgId, {
      tl: { col: colIdx - 1, row: rowStart - 1 },
      br: { col: colIdx + 0.9, row: rowStart + 2.8 },
    })
  }
  await addSig(inspector?.signature_data, 13, 2)
  await addSig(approver?.signature_data, 14, 2)
  await addSig(exporter?.signature_data, 16, 2)

  borderRange(ws, 1, 13, 5, 17)

  // ── JIG METADATA (row 6–7) ────────────────────────────────
  ws.getRow(6).height = 13
  ws.getRow(7).height = 13

  merge(ws, 'A6', 'A6'); setVal(ws, 'A6', 'Jig No.:', { bold: true, size: 8 })
  merge(ws, 'B6', 'D6'); setVal(ws, 'B6', jig.jig_no ?? '', { size: 8 })
  merge(ws, 'E6', 'E6'); setVal(ws, 'E6', 'Process:', { bold: true, size: 8 })
  merge(ws, 'F6', 'I6'); setVal(ws, 'F6', jig.process ?? '', { size: 8 })
  merge(ws, 'J6', 'J6'); setVal(ws, 'J6', 'Part Name:', { bold: true, size: 8 })
  merge(ws, 'K6', 'Q6'); setVal(ws, 'K6', jig.part_name ?? '', { size: 8 })

  merge(ws, 'A7', 'A7'); setVal(ws, 'A7', 'Jig Name:', { bold: true, size: 8 })
  merge(ws, 'B7', 'D7'); setVal(ws, 'B7', jig.name ?? '', { size: 8 })
  merge(ws, 'E7', 'E7'); setVal(ws, 'E7', 'Model:', { bold: true, size: 8 })
  merge(ws, 'F7', 'I7'); setVal(ws, 'F7', jig.model ?? '', { size: 8 })
  merge(ws, 'J7', 'J7'); setVal(ws, 'J7', 'Part No.:', { bold: true, size: 8 })
  merge(ws, 'K7', 'Q7'); setVal(ws, 'K7', jig.part_no ?? '', { size: 8 })

  borderRange(ws, 6, 1, 7, 17)

  // ── GROUP checkpoints ─────────────────────────────────────
  // ถ้ามี group_name (Item หัวข้อจากฟอร์มจริง เช่น "Locate Pin") จัดกลุ่มตามนั้น
  // ไม่งั้น fallback จัดตาม category แบบเดิม — กลุ่มหนึ่งมีทั้ง variable/attribute ได้
  const useNamed = checkpoints.some(c => (c.group_name ?? '').trim())
  const groupOrder = []
  const groupMap = {}
  for (const cp of checkpoints) {
    const key = useNamed ? ((cp.group_name ?? '').trim() || '__none__') : (cp.category ?? '__none__')
    if (!groupMap[key]) { groupMap[key] = []; groupOrder.push(key) }
    groupMap[key].push(cp)
  }
  const namedKeys = groupOrder.filter(k => k !== '__none__')

  // preload รูปอ้างอิงต่อจุด
  const cpImgs = {}
  await Promise.all(checkpoints.filter(c => c.image_path).map(async c => {
    cpImgs[c.id] = await fetchImageBuffer(c.image_path)
  }))

  let row = 8

  for (const cat of groupOrder) {
    const allCps = groupMap[cat]
    const meta = useNamed
      ? { label: cat === '__none__' ? 'อื่นๆ' : `Item ${namedKeys.indexOf(cat) + 1} — ${cat}`, argb: 'FF374151', short: null }
      : (CATEGORY_META[cat] ?? { label: cat === '__none__' ? 'Other' : cat, argb: 'FF6B7280' })

    ws.getRow(row).height = 14
    merge(ws, `A${row}`, `${lastCol}${row}`)
    setVal(ws, `A${row}`, `${meta.short ? `[${meta.short}] ` : ''}${meta.label}`, { bold: true, center: true, size: 9 })
    ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } }
    ws.getCell(`A${row}`).font = { bold: true, size: 9, color: { argb: meta.argb } }
    row++

    const varSubset = allCps.filter(c => c.type === 'variable')
    const attrSubset = allCps.filter(c => c.type !== 'variable')

    if (varSubset.length) {
      const cps = varSubset
      const subGroups = []
      const seenBase = {}
      for (const cp of cps) {
        const base = cp.name.replace(/\s*[XY]$/i, '').trim()
        if (!seenBase[base]) { seenBase[base] = []; subGroups.push({ base, items: seenBase[base] }) }
        seenBase[base].push(cp)
      }

      ws.getRow(row).height = 16
      const vHdrs = [
        ['A', 'Item'], ['B', 'Check Point'], ['C', 'Axis'],
        ['D', 'Standard'], ['E', 'Max'], ['F', 'Min'],
        ['G', 'Checking'], ['H', 'Check.1'], ['I', 'Check.2'], ['J', 'Check.3'],
        ['K', 'Avg'], ['L', 'OK/NG'],
        ['M', 'Action (การปรับปรุงแก้ไข)'], ['N', 'Date/Time'],
        ['O', 'Results OK/NG'], ['P', 'Approve Results'], ['Q', 'Remark'],
      ]
      vHdrs.forEach(([col, label]) => {
        setVal(ws, `${col}${row}`, label, { bold: true, center: true, size: 7, fill: 'FFD9D9D9', border: true })
      })
      row++

      let itemNo = 1
      for (const sg of subGroups) {
        for (const cp of sg.items) {
          const r = results[cp.id]
          ws.getRow(row).height = 13

          const v1  = r?.value_1   != null ? Number(r.value_1)   : null
          const v2  = r?.value_2   != null ? Number(r.value_2)   : null
          const v3  = r?.value_3   != null ? Number(r.value_3)   : null
          const avg = r?.avg_value != null ? Number(r.avg_value) : null
          const ok  = r?.status === 'pass' ? 'OK' : r?.status === 'fail' ? 'NG' : ''
          const finalOk = r?.final_status === 'pass' ? 'OK' : r?.final_status === 'fail' ? 'NG'
                        : r?.status === 'pass' ? 'OK' : r?.status === 'fail' ? 'NG' : ''

          if (sg.items.length > 1) {
            if (cp === sg.items[0]) {
              merge(ws, `A${row}`, `A${row + sg.items.length - 1}`)
              setVal(ws, `A${row}`, itemNo, { center: true, size: 8, border: true })
              merge(ws, `B${row}`, `B${row + sg.items.length - 1}`)
              setVal(ws, `B${row}`, sg.base, { size: 8, wrap: true, border: true })
            }
          } else {
            setVal(ws, `A${row}`, itemNo, { center: true, size: 8, border: true })
            setVal(ws, `B${row}`, cp.name, { size: 8, wrap: true, border: true })
          }

          setVal(ws, `C${row}`, cp.axis ?? '', { center: true, size: 8, border: true })
          setVal(ws, `D${row}`, cp.nominal != null ? `Ø ${fmt(cp.nominal)}` : '', { center: true, size: 8, border: true })
          setVal(ws, `E${row}`, cp.usl != null ? fmt(cp.usl) : '', { center: true, size: 8, border: true })
          setVal(ws, `F${row}`, cp.lsl != null ? fmt(cp.lsl) : '', { center: true, size: 8, border: true })
          setVal(ws, `G${row}`, cp.unit ? `Vernier\n${cp.unit}` : 'Vernier', { center: true, size: 7, wrap: true, border: true })
          setVal(ws, `H${row}`, v1 != null ? v1 : '', { center: true, size: 8, border: true })
          setVal(ws, `I${row}`, v2 != null ? v2 : '', { center: true, size: 8, border: true })
          setVal(ws, `J${row}`, v3 != null ? v3 : '', { center: true, size: 8, border: true })
          setVal(ws, `K${row}`, avg != null ? avg : '', { center: true, size: 8, border: true })

          const okCell = ws.getCell(`L${row}`)
          okCell.value = ok
          okCell.alignment = { horizontal: 'center', vertical: 'middle' }
          okCell.font = { bold: true, size: 8, color: { argb: ok === 'NG' ? 'FFEF4444' : 'FF22C55E' } }
          okCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
          if (ok === 'NG') okCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEEEE' } }

          setVal(ws, `M${row}`, r?.action_text ?? '', { size: 8, wrap: true, border: true })
          setVal(ws, `N${row}`, r?.recheck_at ? new Date(r.recheck_at).toLocaleDateString('th-TH') : '', { center: true, size: 7, border: true })

          const resCell = ws.getCell(`O${row}`)
          resCell.value = finalOk
          resCell.alignment = { horizontal: 'center', vertical: 'middle' }
          resCell.font = { bold: true, size: 8, color: { argb: finalOk === 'NG' ? 'FFEF4444' : finalOk === 'OK' ? 'FF22C55E' : 'FF666666' } }
          resCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }

          if (sg.items.length > 1) {
            if (cp === sg.items[0]) {
              merge(ws, `P${row}`, `P${row + sg.items.length - 1}`)
              merge(ws, `Q${row}`, `Q${row + sg.items.length - 1}`)
            }
          }
          setVal(ws, `P${row}`, '', { border: true })
          setVal(ws, `Q${row}`, '', { border: true })

          row++
        }
        itemNo++
      }
    }

    if (attrSubset.length) {
      const cps = attrSubset
      ws.getRow(row).height = 14
      const aHdrs = [
        ['A', 'Item'], ['B', 'Check Point'], ['G', 'Checking'],
        ['H', 'Picture / Actual'], ['L', 'OK/NG'],
        ['M', 'Action (การดำเนินการ NG)'], ['N', 'Date/Time'],
        ['O', 'Results OK/NG'], ['P', 'Approve Results'], ['Q', 'Remark'],
      ]
      aHdrs.forEach(([col, label]) => {
        setVal(ws, `${col}${row}`, label, { bold: true, center: true, size: 7, fill: 'FFD9D9D9', border: true })
      })
      merge(ws, `C${row}`, `F${row}`)
      setVal(ws, `C${row}`, 'Standard', { bold: true, center: true, size: 7, fill: 'FFD9D9D9', border: true })
      merge(ws, `H${row}`, `K${row}`)
      setVal(ws, `H${row}`, 'Picture / Actual', { bold: true, center: true, size: 7, fill: 'FFD9D9D9', border: true })
      row++

      cps.forEach((cp, idx) => {
        const r = results[cp.id]
        const hasImg = !!cpImgs[cp.id]
        ws.getRow(row).height = hasImg ? 42 : 22
        const ok = r?.value_attribute === 'ok' ? 'OK' : r?.value_attribute === 'ng' ? 'NG'
          : r?.status === 'pass' ? 'OK' : r?.status === 'fail' ? 'NG' : ''

        setVal(ws, `A${row}`, idx + 1, { center: true, size: 8, border: true })
        setVal(ws, `B${row}`, cp.name, { size: 8, wrap: true, border: true })
        merge(ws, `C${row}`, `F${row}`)
        // Standard = เกณฑ์ตัดสินหลายบรรทัด (description) ถ้าไม่มีใช้ชื่อจุดแบบเดิม
        setVal(ws, `C${row}`, cp.description || cp.name, { size: 7, wrap: true, border: true })
        setVal(ws, `G${row}`, '', { border: true })
        merge(ws, `H${row}`, `K${row}`)
        setVal(ws, `H${row}`, '', { border: true })
        if (hasImg) {
          try {
            const imgId = wb.addImage({ buffer: cpImgs[cp.id], extension: imgExt(cp.image_path) })
            ws.addImage(imgId, { tl: { col: 7, row: row - 1 }, ext: { width: 130, height: 52 } })
          } catch { /* รูปเสีย — ปล่อยช่องว่าง */ }
        }

        const okCell = ws.getCell(`L${row}`)
        okCell.value = ok
        okCell.alignment = { horizontal: 'center', vertical: 'middle' }
        okCell.font = { bold: true, size: 9, color: { argb: ok === 'NG' ? 'FFEF4444' : 'FF22C55E' } }
        okCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
        if (ok === 'NG') okCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEEEE' } }

        setVal(ws, `M${row}`, r?.action_text ?? '', { size: 8, wrap: true, border: true })
        setVal(ws, `N${row}`, '', { border: true })
        setVal(ws, `O${row}`, '', { border: true })
        setVal(ws, `P${row}`, '', { border: true })
        setVal(ws, `Q${row}`, '', { size: 8, wrap: true, border: true })
        row++
      })
    }

    row++
  }

  row++
  ws.getRow(row).height = 12
  merge(ws, `A${row}`, `B${row}`)
  setVal(ws, `A${row}`, 'Code Check Point', { bold: true, size: 7 })
  row++
  const legendItems = Object.entries(CATEGORY_META).map(([k, v]) => `${k} = ${v.label}`)
  const chunks = [legendItems.slice(0, 5), legendItems.slice(5)]
  chunks.forEach(chunk => {
    if (!chunk.length) return
    ws.getRow(row).height = 11
    merge(ws, `A${row}`, `Q${row}`)
    setVal(ws, `A${row}`, chunk.join('     '), { size: 7 })
    row++
  })
  merge(ws, `A${row}`, `I${row}`)
  setVal(ws, `A${row}`, 'NG = ผิดปกติ     OK = ปกติ', { size: 7 })

  merge(ws, `J${row}`, `Q${row}`)
  // เลขฟอร์ม/Rev/Effective จาก Document Master กลาง (fallback ค่าเดิม)
  const _fc = docForm?.form_code || 'FM-JIG-003'
  const _rev = docForm?.rev || 'Rev.00'
  const _eff = docForm?.effective_date || new Date(inspection.inspected_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })
  setVal(ws, `J${row}`, `${_fc}    ${_rev} Eff.date: ${_eff}`, { size: 7, center: true })

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const datePart = new Date(inspection.inspected_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  a.href = url
  a.download = `PM_JIG_${jig.jig_no ?? jig.name}_${datePart}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
