import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabaseDR } from '../supabaseClient'

// ── Constants ─────────────────────────────────────────────────
const W = 297   // A4 landscape width mm
const H = 210   // A4 landscape height mm
const M = 5     // page margin mm

// Category color/label come from the user-managed taxonomy (passed in as
// `categories`); these maps are built per-export. Fallback keeps old codes
// rendering if the taxonomy row was removed.
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '')
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [107, 114, 128]
}
function buildCatMaps(categories) {
  const color = {}, label = {}
  for (const c of categories ?? []) { color[c.code] = hexToRgb(c.color); label[c.code] = c.label }
  return { color, label }
}

function fmtN(v, d = 3) {
  if (v == null || v === '') return ''
  return Number(v).toFixed(d).replace(/\.?0+$/, '')
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('th-TH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

async function urlToBase64(url) {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const fr = new FileReader()
      fr.onloadend = () => resolve(fr.result)
      fr.readAsDataURL(blob)
    })
  } catch { return null }
}

function drawRect(doc, x, y, w, h, opts = {}) {
  if (opts.fill) {
    doc.setFillColor(...opts.fill)
    doc.rect(x, y, w, h, 'FD')
  } else {
    doc.setLineWidth(opts.lw ?? 0.2)
    doc.setDrawColor(0)
    doc.rect(x, y, w, h)
  }
}

function txt(doc, text, x, y, opts = {}) {
  doc.setFontSize(opts.size ?? 7)
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
  doc.setTextColor(...(opts.color ?? [0, 0, 0]))
  doc.text(String(text ?? ''), x, y, {
    align: opts.align ?? 'left',
    baseline: 'middle',
  })
}

// Fetch a signature that lives as a public URL (4M's profiles.signature_url)
// and turn it into a data URL for embedding in the PDF/Excel exports.
export async function resolveSignatureDataUrl(publicUrl) {
  if (!publicUrl) return null
  return urlToBase64(publicUrl)
}

/**
 * Export one inspection as PDF matching Form FM-JIG-003 (Thai Summit PM JIG form)
 *
 * @param {object} opts
 *   jig        - jig record (name, jig_no, process, model, part_name, part_no, image_path)
 *   inspection - inspection record
 *   checkpoints - sorted checkpoint records (with .category)
 *   results    - map checkpoint_id → inspection_result
 *   inspector  - { email, signature_data }
 *   approver   - { email, signature_data } | null
 *   exporter   - { email, signature_data }
 */
export async function exportInspectionPDF({
  jig, inspection, checkpoints, results,
  inspector, approver, exporter, categories,
}) {
  const CAT = buildCatMaps(categories)
  const catColor = (cat) => CAT.color[cat] ?? [107, 114, 128]
  const CAT_LABEL = CAT.label
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'normal')

  const datePart = new Date(inspection.inspected_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const dateDisplay = fmtDate(inspection.inspected_at)

  let jigImg = null
  if (jig.image_path) {
    const url = supabaseDR.storage.from('jig-images').getPublicUrl(jig.image_path).data.publicUrl
    jigImg = await urlToBase64(url)
  }

  const groupOrder = []
  const groupMap = {}
  for (const cp of checkpoints) {
    const cat = cp.category ?? '__none__'
    if (!groupMap[cat]) { groupMap[cat] = []; groupOrder.push(cat) }
    groupMap[cat].push(cp)
  }

  // One item number shared by the image pins and every table row, numbered in
  // table order (by category group). X/Y measurements of one variable share a
  // number (deduped by base name within the group); attributes get one each —
  // so a pin labelled "5" always points at table item 5.
  const itemNoMap = {}
  {
    let n = 0
    for (const cat of groupOrder) {
      const seenBase = {}
      for (const cp of groupMap[cat]) {
        if (cp.type === 'variable') {
          const base = (cp.name ?? '').replace(/\s+[XY]$/i, '').trim()
          if (seenBase[base] == null) { n += 1; seenBase[base] = n }
          itemNoMap[cp.id] = seenBase[base]
        } else {
          n += 1
          itemNoMap[cp.id] = n
        }
      }
    }
  }

  // SECTION 1: HEADER BLOCK
  const HDR_Y = M
  const HDR_H = 22
  const SIG_X = 205
  const SIG_W = W - M - SIG_X
  const COL_W = SIG_W / 3

  drawRect(doc, M, HDR_Y, SIG_X - M, HDR_H)
  txt(doc, 'บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด (สาขา 1)', M + 2, HDR_Y + 4, { size: 6, bold: true })
  txt(doc, 'Thai Summit Automotive Co.,Ltd (Branch 1)', M + 2, HDR_Y + 8, { size: 6 })
  txt(doc, 'Preventive Maintenance JIG', (SIG_X - M) / 2 + M, HDR_Y + 14, {
    size: 13, bold: true, align: 'center',
  })

  const revX = SIG_X - 57
  const revY = HDR_Y
  const revW = [12, 25, 15]
  let rx = revX
  ;['Rev.', 'Description', 'Date'].forEach((h, i) => {
    drawRect(doc, rx, revY, revW[i], 6)
    txt(doc, h, rx + revW[i] / 2, revY + 3, { size: 6, bold: true, align: 'center' })
    rx += revW[i]
  })
  rx = revX
  ;['00', 'Initial issue', dateDisplay].forEach((v, i) => {
    drawRect(doc, rx, revY + 6, revW[i], HDR_H - 6)
    txt(doc, v, rx + revW[i] / 2, revY + 6 + (HDR_H - 6) / 2, { size: 6, align: 'center' })
    rx += revW[i]
  })

  ;['ISSUED', 'CHECKED', 'APPROVED'].forEach((lbl, i) => {
    const cx = SIG_X + i * COL_W
    drawRect(doc, cx, HDR_Y, COL_W, 6)
    drawRect(doc, cx, HDR_Y + 6, COL_W, HDR_H - 6)
    txt(doc, lbl, cx + COL_W / 2, HDR_Y + 3, { size: 6, bold: true, align: 'center' })
  })

  const sigData = [inspector?.signature_data, approver?.signature_data, exporter?.signature_data]
  const sigNames = [
    inspector?.email?.split('@')[0] ?? '',
    approver?.email?.split('@')[0] ?? '',
    exporter?.email?.split('@')[0] ?? '',
  ]
  sigData.forEach((sd, i) => {
    const cx = SIG_X + i * COL_W
    if (sd) {
      try { doc.addImage(sd, 'PNG', cx + 1, HDR_Y + 7, COL_W - 2, HDR_H - 9) } catch {}
    }
    txt(doc, sigNames[i], cx + COL_W / 2, HDR_Y + HDR_H - 1.5, { size: 5, align: 'center' })
  })

  // SECTION 2: JIG METADATA
  const META_Y = HDR_Y + HDR_H + 1
  const META_ROW = 5

  drawRect(doc, M, META_Y, W - 2 * M, META_ROW)
  const col1 = M + 55, col2 = col1 + 70
  txt(doc, 'Jig No. :', M + 1, META_Y + META_ROW / 2, { size: 7, bold: true })
  txt(doc, jig.jig_no ?? '', M + 14, META_Y + META_ROW / 2, { size: 7 })
  doc.line(col1, META_Y, col1, META_Y + META_ROW)
  txt(doc, 'Process :', col1 + 1, META_Y + META_ROW / 2, { size: 7, bold: true })
  txt(doc, jig.process ?? '', col1 + 14, META_Y + META_ROW / 2, { size: 7 })
  doc.line(col2, META_Y, col2, META_Y + META_ROW)
  txt(doc, 'Part Name. :', col2 + 1, META_Y + META_ROW / 2, { size: 7, bold: true })
  txt(doc, jig.part_name ?? '', col2 + 18, META_Y + META_ROW / 2, { size: 7 })

  drawRect(doc, M, META_Y + META_ROW, W - 2 * M, META_ROW)
  txt(doc, 'Jig Name :', M + 1, META_Y + META_ROW + META_ROW / 2, { size: 7, bold: true })
  txt(doc, jig.name ?? '', M + 14, META_Y + META_ROW + META_ROW / 2, { size: 7 })
  doc.line(col1, META_Y + META_ROW, col1, META_Y + 2 * META_ROW)
  txt(doc, 'Model :', col1 + 1, META_Y + META_ROW + META_ROW / 2, { size: 7, bold: true })
  txt(doc, jig.model ?? '', col1 + 12, META_Y + META_ROW + META_ROW / 2, { size: 7 })
  doc.line(col2, META_Y + META_ROW, col2, META_Y + 2 * META_ROW)
  txt(doc, 'Part No. :', col2 + 1, META_Y + META_ROW + META_ROW / 2, { size: 7, bold: true })
  txt(doc, jig.part_no ?? '', col2 + 14, META_Y + META_ROW + META_ROW / 2, { size: 7 })

  // SECTION 3: JIG IMAGE
  const IMG_Y = META_Y + 2 * META_ROW + 1
  const IMG_H = 57
  const IMG_W = W - 2 * M - 42

  drawRect(doc, M, IMG_Y, IMG_W, IMG_H)

  if (jigImg) {
    try {
      doc.addImage(jigImg, 'JPEG', M + 0.5, IMG_Y + 0.5, IMG_W - 1, IMG_H - 1)
    } catch {
      try { doc.addImage(jigImg, 'PNG', M + 0.5, IMG_Y + 0.5, IMG_W - 1, IMG_H - 1) } catch {}
    }
  } else {
    txt(doc, '[ ไม่มีรูปภาพ ]', M + IMG_W / 2, IMG_Y + IMG_H / 2, { size: 8, align: 'center', color: [150, 150, 150] })
  }

  const PIN_R = 2.2
  const PIN_AH = 1.4

  checkpoints.forEach((cp, i) => {
    if (cp.x_pos == null || cp.y_pos == null) return
    const num = itemNoMap[cp.id] ?? (i + 1)

    const pinX = M + 0.5 + cp.x_pos * (IMG_W - 1)
    const pinY = IMG_Y + 0.5 + cp.y_pos * (IMG_H - 1)
    const cx = pinX
    const cy = pinY - PIN_AH - PIN_R

    const [r, g, b] = catColor(cp.category)

    doc.setFillColor(0, 0, 0)
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0)
    doc.circle(cx + 0.3, cy + 0.3, PIN_R, 'F')

    doc.setFillColor(r, g, b)
    doc.setDrawColor(255, 255, 255)
    doc.setLineWidth(0.4)
    doc.circle(cx, cy, PIN_R, 'FD')

    doc.setFillColor(r, g, b)
    doc.setDrawColor(r, g, b)
    doc.setLineWidth(0)
    doc.triangle(cx - 1.1, cy + PIN_R - 0.4, cx + 1.1, cy + PIN_R - 0.4, cx, pinY, 'F')

    doc.setDrawColor(255, 255, 255)
    doc.setLineWidth(0.25)
    doc.line(cx - 1.15, cy + PIN_R - 0.45, cx, pinY)
    doc.line(cx + 1.15, cy + PIN_R - 0.45, cx, pinY)

    doc.setFontSize(num > 9 ? 4 : 5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 255, 255)
    doc.text(String(num), cx, cy, { align: 'center', baseline: 'middle' })
  })

  const DP_X = M + IMG_W + 2
  const DP_W = 40
  txt(doc, 'Diamond Pin', DP_X + DP_W / 2, IMG_Y + 4, { size: 6, bold: true, align: 'center' })
  drawRect(doc, DP_X + 2, IMG_Y + 6, DP_W - 4, 20)
  txt(doc, 'X', DP_X + 4, IMG_Y + 10, { size: 6 })
  txt(doc, 'Y', DP_X + DP_W / 2, IMG_Y + 8, { size: 6, align: 'center' })
  drawRect(doc, DP_X + 2, IMG_Y + 29, DP_W - 4, 22)
  txt(doc, 'X', DP_X + 4, IMG_Y + 33, { size: 6 })
  txt(doc, 'Y', DP_X + DP_W / 2, IMG_Y + 31, { size: 6, align: 'center' })
  txt(doc, 'ตัวอย่าง การวัดขนาด Locator Pin ตามแกน', DP_X + DP_W / 2, IMG_Y + 53, {
    size: 5, align: 'center', color: [80, 80, 80],
  })
  txt(doc, 'อ้างอิง X และ Y', DP_X + DP_W / 2, IMG_Y + 56, { size: 5, align: 'center', color: [80, 80, 80] })

  // SECTION 4: DATA TABLES
  let curY = IMG_Y + IMG_H + 1

  for (const cat of groupOrder) {
    const cps = groupMap[cat]
    const col = catColor(cat)
    const label = CAT_LABEL[cat] ?? (cat === '__none__' ? 'Other' : cat)
    const isVar = cps[0]?.type === 'variable'

    drawRect(doc, M, curY, W - 2 * M, 5, { fill: col })
    doc.setDrawColor(...col)
    doc.rect(M, curY, W - 2 * M, 5, 'S')
    txt(doc, `${cat !== '__none__' ? `[${cat}]  ` : ''}${label}`, W / 2, curY + 2.5, {
      size: 7, bold: true, align: 'center', color: [255, 255, 255],
    })
    curY += 5

    if (isVar) {
      const rows = []
      const seenBase = {}
      for (const cp of cps) {
        const base = (cp.name ?? '').replace(/\s+[XY]$/i, '').trim()
        const r = results[cp.id]
        const ok = r?.status === 'pass' ? 'OK' : r?.status === 'fail' ? 'NG' : ''
        const finalOk = r?.final_status === 'pass' ? 'OK'
          : r?.final_status === 'fail' ? 'NG' : ok

        const isFirst = !seenBase[base]
        if (isFirst) seenBase[base] = true

        rows.push({
          item:     isFirst ? String(itemNoMap[cp.id]) : '',
          name:     isFirst ? base : '',
          axis:     cp.axis ?? '',
          std:      cp.nominal != null ? `Ø ${fmtN(cp.nominal)}` : '',
          max:      cp.usl != null ? fmtN(cp.usl) : '',
          min:      cp.lsl != null ? fmtN(cp.lsl) : '',
          checking: cp.unit ? `Vernier\n${cp.unit}` : 'Vernier',
          v1:       fmtN(r?.value_1),
          v2:       fmtN(r?.value_2),
          v3:       fmtN(r?.value_3),
          avg:      fmtN(r?.avg_value),
          okng:     ok,
          action:   r?.action_text ?? '',
          date:     fmtDate(r?.recheck_at),
          results:  finalOk,
          approve:  '',
          remark:   '',
          _ng:      ok === 'NG',
        })
      }

      autoTable(doc, {
        startY: curY,
        margin: { left: M, right: M },
        tableWidth: W - 2 * M,
        columns: [
          { header: 'Item',      dataKey: 'item' },
          { header: 'Check Point', dataKey: 'name' },
          { header: 'Axis',     dataKey: 'axis' },
          { header: 'Standard', dataKey: 'std' },
          { header: 'Max',      dataKey: 'max' },
          { header: 'Min',      dataKey: 'min' },
          { header: 'Checking', dataKey: 'checking' },
          { header: 'Check.1',  dataKey: 'v1' },
          { header: 'Check.2',  dataKey: 'v2' },
          { header: 'Check.3',  dataKey: 'v3' },
          { header: 'Avg',      dataKey: 'avg' },
          { header: 'OK/NG',    dataKey: 'okng' },
          { header: 'Action (การปรับปรุงแก้ไข)', dataKey: 'action' },
          { header: 'Date/Time', dataKey: 'date' },
          { header: 'Results\nOK/NG', dataKey: 'results' },
          { header: 'Approve\nResults', dataKey: 'approve' },
          { header: 'Remark', dataKey: 'remark' },
        ],
        body: rows,
        styles: { fontSize: 6.5, cellPadding: 0.8, lineWidth: 0.15, lineColor: [0, 0, 0], overflow: 'linebreak' },
        headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 6, halign: 'center', cellPadding: 0.8 },
        columnStyles: {
          item: { cellWidth: 9, halign: 'center' }, name: { cellWidth: 22 },
          axis: { cellWidth: 7, halign: 'center' }, std: { cellWidth: 14, halign: 'center' },
          max: { cellWidth: 9, halign: 'center' }, min: { cellWidth: 9, halign: 'center' },
          checking: { cellWidth: 14, halign: 'center' },
          v1: { cellWidth: 11, halign: 'center' }, v2: { cellWidth: 11, halign: 'center' }, v3: { cellWidth: 11, halign: 'center' },
          avg: { cellWidth: 11, halign: 'center' }, okng: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
          action: { cellWidth: 30 }, date: { cellWidth: 16, halign: 'center' },
          results: { cellWidth: 13, halign: 'center', fontStyle: 'bold' }, approve: { cellWidth: 13, halign: 'center' },
          remark: { cellWidth: 'auto' },
        },
        didParseCell(data) {
          const row = data.row.raw
          if (!row) return
          if (row._ng) {
            if (['v1', 'v2', 'v3', 'avg'].includes(data.column.dataKey)) {
              data.cell.styles.fillColor = [255, 240, 240]
              data.cell.styles.textColor = [180, 0, 0]
            }
            if (data.column.dataKey === 'okng') {
              data.cell.styles.fillColor = [255, 220, 220]
              data.cell.styles.textColor = [180, 0, 0]
            }
            if (data.column.dataKey === 'results') data.cell.styles.textColor = [180, 0, 0]
          }
          if (!row._ng && data.column.dataKey === 'okng' && data.cell.raw === 'OK') data.cell.styles.textColor = [0, 140, 0]
          if (!row._ng && data.column.dataKey === 'results' && data.cell.raw === 'OK') data.cell.styles.textColor = [0, 140, 0]
        },
      })

    } else {
      const rows = cps.map((cp) => {
        const r = results[cp.id]
        const ok = r?.value_attribute === 'ok' ? 'OK' : r?.value_attribute === 'ng' ? 'NG' : ''
        return {
          item: String(itemNoMap[cp.id]), name: cp.name, std: cp.name, checking: '', picture: '',
          okng: ok, action: r?.action_text ?? '', date: '', results: '', approve: '',
          remark: '', _ng: ok === 'NG',
        }
      })

      autoTable(doc, {
        startY: curY,
        margin: { left: M, right: M },
        tableWidth: W - 2 * M,
        columns: [
          { header: 'Item', dataKey: 'item' }, { header: 'Check Point', dataKey: 'name' },
          { header: 'Standard', dataKey: 'std' }, { header: 'Checking', dataKey: 'checking' },
          { header: 'Picture', dataKey: 'picture' }, { header: 'OK/NG', dataKey: 'okng' },
          { header: 'Action (การดำเนินการ NG)', dataKey: 'action' }, { header: 'Date/Time', dataKey: 'date' },
          { header: 'Results\nOK/NG', dataKey: 'results' }, { header: 'Approve\nResults', dataKey: 'approve' },
          { header: 'Remark', dataKey: 'remark' },
        ],
        body: rows,
        styles: { fontSize: 6.5, cellPadding: 0.8, lineWidth: 0.15, lineColor: [0, 0, 0], overflow: 'linebreak' },
        headStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 6, halign: 'center', cellPadding: 0.8 },
        columnStyles: {
          item: { cellWidth: 9, halign: 'center' }, name: { cellWidth: 28 },
          std: { cellWidth: 45, overflow: 'linebreak' }, checking: { cellWidth: 18, halign: 'center' },
          picture: { cellWidth: 40, halign: 'center', textColor: [180, 180, 180] },
          okng: { cellWidth: 10, halign: 'center', fontStyle: 'bold' }, action: { cellWidth: 38 },
          date: { cellWidth: 16, halign: 'center' }, results: { cellWidth: 13, halign: 'center', fontStyle: 'bold' },
          approve: { cellWidth: 13, halign: 'center' }, remark: { cellWidth: 'auto' },
        },
        didParseCell(data) {
          const row = data.row.raw
          if (!row) return
          if (row._ng && data.column.dataKey === 'okng') {
            data.cell.styles.fillColor = [255, 220, 220]
            data.cell.styles.textColor = [180, 0, 0]
          }
          if (!row._ng && data.column.dataKey === 'okng' && data.cell.raw === 'OK') data.cell.styles.textColor = [0, 140, 0]
        },
      })
    }

    curY = doc.lastAutoTable.finalY + 1.5
  }

  // SECTION 5: LEGEND
  const legendY = Math.max(curY + 2, H - 14)

  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('Code Check Point', M, legendY + 3)

  doc.setFont('helvetica', 'normal')
  const legendItems = Object.entries(CAT_LABEL).map(([k, v]) => `${k} = ${v}`)
  doc.text(legendItems.slice(0, 5).join('     '), M + 28, legendY + 3)
  doc.text(legendItems.slice(5).join('     '), M + 28, legendY + 7)
  doc.text('NG = ผิดปกติ     OK = ปกติ', M + 28, legendY + 11)

  doc.setFontSize(6)
  doc.text(`FM-JIG-003     Rev.00 Eff.date: 01/07/2020`, W - M, H - M, { align: 'right', baseline: 'bottom' })

  doc.save(`PM_JIG_${jig.jig_no ?? jig.name}_${datePart}.pdf`)
}
