// นำเข้า/อัพเดทคลังอะไหล่จากไฟล์ Excel/CSV — ตัวแปลงล้วน (pure) ไม่แตะ DB/DOM
// ใช้กับแท็บคลังอะไหล่: อัพโหลดไฟล์เดิมซ้ำได้เรื่อยๆ ระบบจะ "อัพเดททับ" ไม่สร้างซ้ำ
//   (key = รหัสภายใน หรือ เลข MAT — เลือกได้ตอนนำเข้า)
//
// รองรับหัวคอลัมน์ทั้งไทย/อังกฤษ และคอลัมน์เดือน 'YYYY-MM' (ยอดเบิกใช้ย้อนหลังจากไฟล์เดิม)
// ⚠️ ไม่แตะ stock_qty ตรงๆ — ยอดคงเหลือต้องผ่าน RPC mtn_stock_move เสมอ (ดูกฎเหล็กใน CLAUDE.md)
//    ตัวแปลงจึงคืนค่า stock ไว้ต่างหากใน `stockQty` ให้ผู้เรียกตัดสินใจว่าจะลง ledger ยังไง

/** ฟิลด์ที่นำเข้าได้ + ชื่อหัวคอลัมน์ที่ยอมรับ (เทียบแบบตัดช่องว่าง/สัญลักษณ์/ตัวพิมพ์) */
export const COLUMN_ALIASES = {
  code:           ['รหัส', 'รหัสภายใน', 'รหัสอะไหล่', 'code', 'partcode', 'itemcode', 'sparecode'],
  name:           ['ชื่อ', 'ชื่ออะไหล่', 'รายการ', 'name', 'partname', 'description', 'item'],
  unit:           ['หน่วย', 'unit', 'uom'],
  team:           ['ทีม', 'ทีมที่ดูแล', 'หน่วยงาน', 'แผนก', 'team', 'dept', 'department'],
  mat_no:         ['mat', 'matno', 'matsap', 'เลขmat', 'matsapno', 'sap', 'sapno', 'materialno', 'material'],
  part_no:        ['partno', 'partnumber', 'pn', 'เลขพาร์ท', 'พาร์ทนัมเบอร์', 'modelno', 'model'],
  supplier:       ['ผู้ขาย', 'ซัพพลายเออร์', 'ผู้จำหน่าย', 'supplier', 'vendor', 'maker', 'brand'],
  category:       ['หมวด', 'หมวดหมู่', 'ประเภท', 'category', 'type', 'group'],
  shelf:          ['ชั้นวาง', 'ตำแหน่ง', 'ตำแหน่งชั้นวาง', 'ที่เก็บ', 'shelf', 'location', 'bin', 'rack', 'position'],
  min_qty:        ['ขั้นต่ำ', 'min', 'minqty', 'minstock', 'safetystock', 'safety', 'จุดสั่งซื้อ'],
  max_qty:        ['สูงสุด', 'max', 'maxqty', 'maxstock'],
  unit_price:     ['ราคา', 'ราคาต่อหน่วย', 'ราคาหน่วย', 'price', 'unitprice', 'cost'],
  lead_time_days: ['leadtime', 'leadtimeday', 'leadtimedays', 'lt', 'ระยะเวลาสั่ง', 'ระยะเวลาจัดส่ง', 'วันสั่งของ'],
  used_with:      ['ใช้กับ', 'ใช้กับเครื่อง', 'เครื่องจักร', 'จิ๊ก', 'usedwith', 'machine', 'usedfor', 'application'],
  note:           ['หมายเหตุ', 'note', 'remark', 'remarks', 'comment'],
  rank_override:  ['rank', 'จัดrank', 'ระดับ', 'ranking', 'class'],
  stock_qty:      ['คงเหลือ', 'จำนวน', 'สต็อก', 'สต๊อก', 'qty', 'stock', 'stockqty', 'onhand', 'balance'],
}

/** คอลัมน์ในไฟล์ตัวอย่างที่ให้ดาวน์โหลด (เรียงตามฟอร์ม FM-JIG-009) */
export const TEMPLATE_HEADERS = [
  'รหัส', 'ชื่ออะไหล่', 'หน่วย', 'ทีม', 'MAT SAP', 'Part no.', 'ผู้ขาย', 'หมวด',
  'ชั้นวาง', 'คงเหลือ', 'ขั้นต่ำ', 'สูงสุด', 'ราคา', 'Leadtime', 'ใช้กับ', 'หมายเหตุ',
]

/** ตัดช่องว่าง/จุด/ขีด/วงเล็บ + ตัวพิมพ์ ให้เทียบหัวคอลัมน์ได้แม้พิมพ์ไม่เป๊ะ */
export const normHeader = (s) =>
  String(s ?? '').toLowerCase().replace(/[\s._\-()/\\:]|['"]/g, '').trim()

const MONTH_RE = /^(\d{4})-(\d{2})$/

/** จับคู่หัวคอลัมน์ → ฟิลด์ · คืน { map, monthCols, unknown } */
export function mapHeaders(headerRow = []) {
  const map = {}
  const monthCols = {}
  const unknown = []
  const lookup = new Map()
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES))
    for (const a of aliases) lookup.set(normHeader(a), field)

  headerRow.forEach((raw, i) => {
    const label = String(raw ?? '').trim()
    if (!label) return
    // คอลัมน์เดือน 'YYYY-MM' = ยอดเบิกใช้ย้อนหลัง (แทนคอลัมน์ PI/PO ในไฟล์เดิม)
    const m = label.match(MONTH_RE)
    if (m && +m[2] >= 1 && +m[2] <= 12) { monthCols[label] = i; return }
    const field = lookup.get(normHeader(label))
    if (field) { if (!(field in map)) map[field] = i }   // หัวซ้ำ = ใช้คอลัมน์แรก
    else unknown.push(label)
  })
  return { map, monthCols, unknown }
}

const numOrNull = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const txt = (v) => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

/** แปลงตาราง (array of arrays แถวแรก = หัวคอลัมน์) → แถวพร้อมนำเข้า
 *  @param matrix  ผลจาก XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
 *  @param opts.teamKeyOf  ฟังก์ชัน normalize ชื่อทีม → mtn_teams.key
 *  @param opts.categories รายการหมวด [{key,label}] — ยอมรับทั้ง key และ label
 *  @returns { rows, headerMap, monthCols, unknown, headerRowIndex } */
export function parseSpareSheet(matrix = [], opts = {}) {
  const { teamKeyOf = (v) => v, categories = [] } = opts

  // หาแถวหัวคอลัมน์: แถวแรกใน 10 แถวแรกที่จับคู่ได้อย่างน้อย 2 ฟิลด์ และมี name หรือ code
  //   (ไฟล์จริงมักมีหัวเรื่อง/โลโก้อยู่บนสุดก่อนตารางจริง)
  let headerRowIndex = -1, best = null
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const h = mapHeaders(matrix[i] || [])
    const n = Object.keys(h.map).length + Object.keys(h.monthCols).length
    if (n >= 2 && ('name' in h.map || 'code' in h.map)) { headerRowIndex = i; best = h; break }
  }
  if (headerRowIndex < 0) {
    return { rows: [], headerMap: {}, monthCols: {}, unknown: [], headerRowIndex: -1 }
  }

  const { map, monthCols, unknown } = best
  const catByKey = new Map()
  for (const c of categories) {
    catByKey.set(normHeader(c.key), c.key)
    if (c.label) catByKey.set(normHeader(c.label), c.key)
  }

  const rows = []
  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const r = matrix[i] || []
    const cell = (f) => (f in map ? r[map[f]] : undefined)
    const name = txt(cell('name'))
    const code = txt(cell('code'))
    const mat = txt(cell('mat_no'))
    // ข้ามแถวว่างสนิท (ไฟล์ Excel มักมีแถวเปล่าท้ายตาราง)
    if (!name && !code && !mat && r.every(c => String(c ?? '').trim() === '')) continue

    const errors = []
    if (!name) errors.push('ไม่มีชื่ออะไหล่')

    const rank = txt(cell('rank_override'))?.toUpperCase()
    const data = {
      code, name,
      unit: txt(cell('unit')) || 'ชิ้น',
      mat_no: mat,
      part_no: txt(cell('part_no')),
      supplier: txt(cell('supplier')),
      shelf: txt(cell('shelf')),
      used_with: txt(cell('used_with')),
      note: txt(cell('note')),
      min_qty: numOrNull(cell('min_qty')) ?? 0,
      max_qty: numOrNull(cell('max_qty')) ?? 0,
      unit_price: numOrNull(cell('unit_price')),
      lead_time_days: numOrNull(cell('lead_time_days')),
      rank_override: ['A', 'B', 'C'].includes(rank) ? rank : null,
    }
    if ('team' in map) {
      const t = txt(cell('team'))
      if (t) data.team = teamKeyOf(t)
    }
    if ('category' in map) {
      const c = txt(cell('category'))
      if (c) {
        const hit = catByKey.get(normHeader(c))
        if (hit) data.category = hit
        else errors.push(`ไม่รู้จักหมวด "${c}"`)
      }
    }
    // หมายเหตุ: rank ที่กรอกมาแต่ไม่ใช่ A/B/C ถูกปัดเป็น null เงียบๆ โดยตั้งใจ
    //   (ปล่อยให้ระบบคำนวณเองตาม WI ดีกว่าบล็อกทั้งแถวเพราะช่องที่ไม่จำเป็น)

    // ยอดเบิกใช้ย้อนหลังจากคอลัมน์เดือน
    const usage = {}
    for (const [mk, ci] of Object.entries(monthCols)) {
      const v = numOrNull(r[ci])
      if (v != null && v >= 0) usage[mk] = v
    }

    rows.push({
      rowNo: i + 1,                      // เลขแถวจริงในไฟล์ (1-based) ไว้บอก user ตอน error
      data,
      usage,
      stockQty: numOrNull(cell('stock_qty')),
      errors,
    })
  }
  return { rows, headerMap: map, monthCols, unknown, headerRowIndex }
}

/** จับคู่แถวที่นำเข้ากับอะไหล่ที่มีอยู่ → บอกว่าอันไหน "เพิ่มใหม่" อันไหน "อัพเดท"
 *  @param rows       ผลจาก parseSpareSheet().rows
 *  @param existing   อะไหล่ในระบบ (mtn_spare_parts)
 *  @param keyField   'code' | 'mat_no'
 *  @param opts.section  หน่วยงานเจ้าของที่กำลังนำเข้า — **ส่งมาแล้วจะจับคู่เฉพาะในหน่วยงานนั้น**
 *
 *  ⚠️ ทำไมต้องมีขอบเขตหน่วยงาน (feedback 2026-08-25 "มีการใช้ Mat. No. ซ้ำกัน")
 *     คลังของแต่ละหน่วยงานมีของชิ้นเดียวกันได้ (เลข MAT เดียวกัน คนละพื้นที่เก็บ คนละคนดูแล)
 *     ถ้าจับคู่ข้ามหน่วยงาน → PD1 นำเข้าไฟล์ตัวเอง แล้วไป **อัพเดททับสต็อกของ PD3** แบบเงียบๆ
 *     → จับคู่เฉพาะหน่วยงานเดียวกัน · เจอคีย์ซ้ำที่หน่วยงานอื่นถือ = สร้างใหม่ + **เตือนให้เห็น ห้ามเงียบ**
 *     ไม่ส่ง section มา = พฤติกรรมเดิมทุกประการ (จับคู่ทั้งคลัง) */
export function matchExisting(rows = [], existing = [], keyField = 'code', opts = {}) {
  const scoped = Object.prototype.hasOwnProperty.call(opts, 'section')
  const secOf = (v) => String(v ?? '').trim().toUpperCase()
  const target = secOf(opts.section)
  const idx = new Map()        // คีย์ → แถวในหน่วยงานที่นำเข้า (ตัวที่อัพเดททับได้)
  const otherSec = new Map()   // คีย์ → หน่วยงานอื่นที่ถือคีย์นี้อยู่ (ไว้เตือน)
  for (const p of existing) {
    const k = normHeader(p?.[keyField])
    if (!k) continue
    if (!scoped || secOf(p.section) === target) { if (!idx.has(k)) idx.set(k, p) }
    else if (!otherSec.has(k)) otherSec.set(k, secOf(p.section) || 'ของกลาง')
  }
  const seen = new Map()          // กันไฟล์เดียวมีคีย์ซ้ำกันเอง
  return rows.map(r => {
    const kv = r.data[keyField]
    const k = normHeader(kv)
    const errors = [...r.errors]
    let action = 'create', existingRow = null

    if (!k) {
      // ไม่มีคีย์ = เพิ่มใหม่เสมอ (อัพโหลดซ้ำจะได้ของซ้ำ — เตือนให้ใส่คีย์)
      errors.push(`ไม่มี${keyField === 'code' ? 'รหัส' : 'เลข MAT'} — อัพโหลดซ้ำจะได้รายการซ้ำ`)
    } else if (seen.has(k)) {
      action = 'skip'
      errors.push(`คีย์ซ้ำกับแถว ${seen.get(k)} ในไฟล์เดียวกัน`)
    } else {
      seen.set(k, r.rowNo)
      if (idx.has(k)) { action = 'update'; existingRow = idx.get(k) }
      else if (otherSec.has(k)) {
        errors.push(`คีย์นี้มีอยู่แล้วในหน่วยงาน ${otherSec.get(k)} — จะสร้างเป็นรายการใหม่ของหน่วยงานนี้ (ไม่ทับของเขา)`)
      }
    }
    if (errors.some(e => e === 'ไม่มีชื่ออะไหล่')) action = 'skip'
    return { ...r, errors, action, existing: existingRow }
  })
}
