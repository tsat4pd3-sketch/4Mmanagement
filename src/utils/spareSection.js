/* แกน "หน่วยงานเจ้าของอะไหล่" — คลังอะไหล่แยกตามส่วนงาน (2026-08-27)
 *
 * ที่มา (feedback หน้างาน ณัฐพล สีพิมขัด · 25/08): "แยกคลังอะไหล่ Production เป็น Production 1–4
 *   เนื่องจากแต่ละทีมมีพื้นที่จัดเก็บและผู้รับผิดชอบแตกต่างกัน รวมถึงมีการใช้ Mat. No. ซ้ำกัน"
 *
 * ⚠️⚠️ ทำไมไม่แตก `mtn_teams` เป็น production_1..4 (คำถามแรกที่ทุกคนจะคิดถึง)
 *   `mtn_teams` เป็น data-driven จริง (เพิ่มแถวได้ไม่ต้องแก้โค้ด) **แต่ key `production` ถูกอ้างเป็น
 *   ค่าคงที่ในโค้ดอีก 6 จุดที่ไม่เกี่ยวกับคลังอะไหล่เลย** — แตกทีมเมื่อไหร่พังเงียบทั้งหมด:
 *     1) `MTN_TEAMS` (mtnTeams.js) — `teamsForUser` กรองด้วย array นี้ → production_1 ถูกทิ้งจาก profiles.mtn_teams
 *     2) `SEE_ALL_TEAMS = ['production']` — AM เห็นทุกลักษณะปัญหา · ทีมใหม่จะไม่เห็น
 *     3) `teamKindOf` fallback `key === 'production' ? 'am' : 'pm'` — ทีมใหม่ตกเป็น PM
 *     4) `checklists.department = 'production'` (DailyPM · PMCheckData · OrderTrace · pmDailyAlarm)
 *        = ทะเบียน AM ตรวจทุกต้นกะ — แตกทีมแล้วต้องแตกทะเบียน AM ตามไปด้วยทั้งชุด
 *     5) `mtn_mo_seq` / `mo_code` — เลขรัน MO ต่อทีม (PRD) ต้องแจกรหัสใหม่ 4 ตัว
 *     6) `mtn_orders.mtn_dept` ของใบเก่าทั้งหมดชี้ 'production' → ต้อง migrate ทั้งประวัติ
 *   ตรงกับกฎเหล็กที่โปรเจคใช้กับ `user_role` มาแล้ว 3 ครั้ง:
 *   **"เจอแกนใหม่ → เพิ่ม attribute ห้ามเพิ่ม role/ทีม"** (precedent: sections[] · is_dept_admin · mtn_teams[])
 *   → แกนที่ขาดจริงคือ "หน่วยงานย่อยที่เป็นเจ้าของของชิ้นนี้" ไม่ใช่ "ทีมช่างอีก 4 ทีม"
 *
 * โมเดล: `mtn_spare_parts.section` / `mtn_rack_maps.section` = `org_nodes.code` ของ kind='section'
 *   **null/ว่าง = ของกลางของทีมนั้น (ทุกหน่วยงานเห็น+ใช้ร่วม)**
 *   pattern เดียวกับ `mtn_*.team` null = common และ `lpa_questions.line_name` null = ข้อ common
 *
 * ⚠️ แกนนี้ **ซ้อนบน** แกนทีม (`team`) ไม่ได้แทนที่ — ทีมตอบว่า "คลังของช่างกลุ่มไหน"
 *    ส่วน section ตอบว่า "ในกลุ่มนั้น ใครเป็นเจ้าของชิ้นนี้" · กรองทั้ง 2 แกนพร้อมกันได้
 */
import { supabase } from '../supabaseClient'

let _cache = null          // [{ code, name }] — โหลดครั้งเดียวต่อ session
let _inflight = null

/** ลิสต์ส่วนงานจากผังองค์กร (kind='section') — ยึด org_nodes ตามกฎ CLAUDE.md ห้าม derive จาก production_lines
 *  โหลดไม่สำเร็จ = คืน [] (จอจะ fallback ไปใช้ค่าที่พบจริงในข้อมูลแทน ไม่ปล่อยให้ตัวเลือกว่างเปล่า) */
export async function loadSpareSections() {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = (async () => {
    const { data, error } = await supabase
      .from('org_nodes').select('code, name, sort_order')
      .eq('kind', 'section').eq('is_active', true).order('sort_order', { nullsFirst: false })
    _inflight = null
    if (error) { console.warn('[spareSection] โหลดผังส่วนงานไม่สำเร็จ:', error.message); return [] }
    _cache = (data || [])
      .map(n => ({ code: String(n.code || n.name || '').trim(), name: String(n.name || n.code || '').trim() }))
      .filter(s => s.code)
    return _cache
  })()
  return _inflight
}
export const spareSectionsSync = () => _cache || []
export const invalidateSpareSections = () => { _cache = null }

/** normalize ค่าหน่วยงาน — ตัดช่องว่าง + ตัวพิมพ์ใหญ่ (รหัสส่วนงานเป็นอังกฤษล้วน: PD1..PD4) */
export const sectionKeyOf = (v) => String(v ?? '').trim().toUpperCase()

/** แถวนี้อยู่ในขอบเขตหน่วยงานที่เลือกไหม — null/ว่าง = ของกลาง เห็นเสมอ */
export function inSectionScope(rowSection, selected) {
  if (!selected) return true                                   // ยังไม่เลือก = เห็นทั้งหมด
  const r = sectionKeyOf(rowSection)
  if (!r) return true                                          // ของกลาง
  return r === sectionKeyOf(selected)
}
export const filterBySection = (rows, selected, key = 'section') =>
  (rows || []).filter(r => inSectionScope(r?.[key], selected))

/** ป้ายที่ใช้แสดง — ไม่มีค่า = "ของกลาง" (ต้องเขียนให้ชัด ห้ามปล่อยช่องว่างให้เดาเอง) */
export const COMMON_SECTION_LABEL = '🌐 ใช้ร่วมทุกหน่วยงาน'
export function sectionLabel(v, sections = spareSectionsSync()) {
  const k = sectionKeyOf(v)
  if (!k) return COMMON_SECTION_LABEL
  const hit = sections.find(s => sectionKeyOf(s.code) === k)
  return hit ? (hit.name || hit.code) : k
}

/** ตัวเลือกสำหรับ dropdown = ส่วนงานในผัง + ค่าที่พบจริงในข้อมูลแต่ไม่มีในผัง (ติดป้าย ⚠ นอกผัง)
 *  **ห้ามซ่อนค่านอกผัง** — ซ่อนแล้วหาแถวที่ต้องแก้ไม่เจอ (กฎเดียวกับ optgroup "นอกผัง" ใน /operator) */
export function sectionOptions(rows = [], sections = spareSectionsSync(), key = 'section') {
  const inOrg = sections.map(s => ({ code: sectionKeyOf(s.code), label: s.name || s.code, offOrg: false }))
  const known = new Set(inOrg.map(s => s.code))
  const extra = [...new Set((rows || []).map(r => sectionKeyOf(r?.[key])).filter(c => c && !known.has(c)))]
    .sort()
    .map(c => ({ code: c, label: `⚠ ${c} (นอกผัง)`, offOrg: true }))
  return [...inOrg, ...extra]
}

/** เดาหน่วยงานจาก "รหัสภายใน" ที่หน้างานตั้งเอง (เช่น `PD3-SP-UPE-001` → PD3)
 *  ⚠️ ใช้ได้แค่ **เสนอค่าตั้งต้นให้คนกดยืนยัน / backfill ที่พิสูจน์ได้** ห้ามเขียนทับค่าที่คนตั้งไว้แล้ว
 *     (prefix เป็นธรรมเนียมที่หน้างานคิดเอง ไม่ใช่กติกาของระบบ — เดาผิดแล้วสต็อกไปโผล่ผิดหน่วยงาน) */
export function guessSectionFromCode(code, sections = spareSectionsSync()) {
  const head = sectionKeyOf(String(code ?? '').split(/[-_/\s]/)[0])
  if (!head) return null
  return sections.some(s => sectionKeyOf(s.code) === head) ? head : null
}
