// เทส paperBenefits — ล็อกกติกา "แผ่น ≠ ครั้งที่บันทึก" + การคาดการณ์เดือนที่ยังไม่จบ (2026-11-26)
// ตัวเลขในเคสถอดจากผล esm_benefits_rollup จริง (ต.ค./พ.ย. 2026)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  monthKeysBetween, projectFactor, keyingHours, buildPaperModel, buildFlowModel, flowTrend, PAPER_BASIS,
} from '../paperBenefits.js'

const FORMS = [
  { doc_key: 'daily_production_report', title: 'DPR', paper_basis: 'shift', paper_unit: 'ไลน์ × กะ', is_active: true },
  { doc_key: 'xlsx_am_monthly', title: 'AM', paper_basis: 'month', paper_unit: 'เครื่อง × กะ', is_active: true },
  { doc_key: 'mo_report', title: 'MO', paper_basis: 'event', is_active: true },
  { doc_key: 'mo_report_mtn', title: 'MO MTN', paper_basis: 'event', is_active: true },
  { doc_key: 'material_request', title: 'เบิก', paper_basis: 'event', is_active: true },
  { doc_key: 'pe_fmea', title: 'FMEA', paper_basis: 'document', is_active: true },
  { doc_key: 'csv_x', title: 'CSV', paper_basis: 'report', is_active: true },
  { doc_key: 'new_form', title: 'ใหม่', paper_basis: null, is_active: true },
  { doc_key: 'off_form', title: 'ปิด', paper_basis: 'shift', is_active: false },
]
const ROWS = [
  { key: 'daily_production_report', month_key: '2026-10', n: 783, val: 783 },
  { key: 'daily_production_report', month_key: '2026-11', n: 758, val: 758 },
  { key: 'xlsx_am_monthly', month_key: '2026-10', n: 53, val: 263 },
  { key: 'xlsx_am_monthly', month_key: '2026-11', n: 72, val: 716 },
  { key: 'mo_report', month_key: '2026-11', n: 920, val: 920 },
  { key: 'pokayoke_check', month_key: '2026-11', n: 98, val: 1476 },
  { key: 'lpa_plan', month_key: '2026-12', n: 20, val: 20 },   // แผนล่วงหน้า = ต้องถูกทิ้ง
]

test('monthKeysBetween ข้ามปีได้ · ปลายรวม', () => {
  assert.deepEqual(monthKeysBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02'])
  assert.deepEqual(monthKeysBetween('bad', '2026-01'), [])
})

test('projectFactor — เดือนจบแล้ว 1 · เดือนนี้ = วันในเดือน ÷ วันที่ผ่านมา · อนาคต null', () => {
  assert.equal(projectFactor('2026-10', '2026-11-22'), 1)
  assert.equal(projectFactor('2026-11', '2026-11-22'), 30 / 22)
  assert.equal(projectFactor('2026-12', '2026-11-22'), null)
})

test('keyingHours — ไม่รู้ = null ห้ามคืน 0', () => {
  assert.equal(keyingHours(600, 1), 10)
  assert.equal(keyingHours(NaN, 1), null)
  assert.equal(keyingHours(100, -1), null)
})

test('ใบรายเดือน: แผ่นห้ามคาดการณ์ แต่ครั้งที่บันทึกคาดการณ์ได้', () => {
  const m = buildPaperModel({ forms: FORMS, rows: ROWS, today: '2026-11-22', from: '2026-10' })
  const am = m.items.find(i => i.doc_key === 'xlsx_am_monthly')
  assert.equal(am.byMonth['2026-11'].sheetsProj, 72)
  assert.equal(am.byMonth['2026-11'].entriesProj, Math.round(716 * 30 / 22))
  const dpr = m.items.find(i => i.doc_key === 'daily_production_report')
  assert.equal(dpr.byMonth['2026-11'].sheetsProj, Math.round(758 * 30 / 22))
  assert.equal(dpr.byMonth['2026-10'].sheetsProj, 783)
})

test('สถานะฟอร์ม — ยังไม่จัด / นับไม่ได้ / นับรวมกับตัวอื่น / ไม่ใช่กระดาษ / ปิดใช้ ไม่หายเงียบ', () => {
  const m = buildPaperModel({ forms: FORMS, rows: ROWS, today: '2026-11-22', from: '2026-10' })
  const st = Object.fromEntries(m.items.map(i => [i.doc_key, i.status]))
  assert.equal(st.new_form, 'unclassified')
  assert.equal(st.material_request, 'not_countable')
  assert.equal(st.mo_report_mtn, 'counted_with')
  assert.equal(st.pe_fmea, 'excluded')
  assert.equal(st.csv_x, 'excluded')
  assert.equal(st.off_form, undefined)            // ฟอร์มปิดใช้ ไม่นับ
  assert.equal(st.pokayoke_check, 'counted')       // ฟอร์มนอกทะเบียน (EXTRA_FORMS) ยังนับ
  assert.deepEqual(m.unclassified.map(i => i.doc_key), ['new_form'])
  assert.deepEqual(m.notCountable.map(i => i.doc_key), ['material_request'])
})

test('ยอดรวม: เดือนอนาคตถูกทิ้ง · ไม่นับ report/document · ตั้งแต่เริ่มทดลอง', () => {
  const m = buildPaperModel({ forms: FORMS, rows: ROWS, today: '2026-11-22', from: '2026-09' })
  assert.deepEqual(m.months, ['2026-09', '2026-10', '2026-11'])
  assert.equal(m.totals['2026-10'].sheets, 783 + 53)
  assert.equal(m.totals['2026-11'].sheets, 758 + 72 + 920 + 98)
  assert.equal(m.totals['2026-11'].entries, 758 + 716 + 920 + 1476)
  assert.equal(m.sinceTrial.sheets, 783 + 53 + 758 + 72 + 920 + 98)
  assert.equal(m.totals['2026-09'].sheets, 0)
  assert.equal(m.partialMonth, true)
})

test('ทุก paper_basis มีป้าย · ชนิดที่ไม่ใช่กระดาษไม่ถูกนับ', () => {
  for (const b of ['document', 'report', 'other']) assert.equal(PAPER_BASIS[b].paper, false)
  for (const b of ['shift', 'month', 'quarter', 'event']) assert.equal(PAPER_BASIS[b].paper, true)
  assert.equal(PAPER_BASIS.quarter.project, false)   // skill matrix ทุก 3 เดือน — ห้ามคูณคาดการณ์
})

test('flow — ratio เป็น % · เดือนไม่มีข้อมูล = null · trend ดีขึ้น/แย่ลงตามทิศของตัวชี้วัด', () => {
  const rows = [
    { key: 'mo_linked', month_key: '2026-10', n: 832, val: 450 },
    { key: 'mo_linked', month_key: '2026-11', n: 1008, val: 507 },
    { key: 'mo_accept_min', month_key: '2026-10', n: 823, val: 10 },
    { key: 'mo_accept_min', month_key: '2026-11', n: 995, val: 9 },
  ]
  const f = buildFlowModel(rows, ['2026-09', '2026-10', '2026-11'])
  const linked = f.find(x => x.key === 'mo_linked')
  assert.equal(linked.byMonth['2026-10'].val, 54)
  assert.equal(linked.byMonth['2026-09'], null)
  const acc = f.find(x => x.key === 'mo_accept_min')
  assert.deepEqual(flowTrend(acc, ['2026-09', '2026-10', '2026-11']).vsBase, { from: 10, to: 9, fromMonth: '2026-10', toMonth: '2026-11', improved: true })
  assert.deepEqual(flowTrend(f.find(x => x.key === 'close_lag_h'), ['2026-10']), { vsBase: null, vsPrev: null })
})

test('flowTrend — ตัวอย่างน้อยไม่ตัดสิน · ดีขึ้นจากฐานแต่แย่ลงจากเดือนก่อน ต้องเห็นทั้งคู่', () => {
  const months = ['2026-09', '2026-10', '2026-11']
  // เคสจริง 4M: ต.ค. n=384 · พ.ย. n=5 ⇒ ห้ามบอกว่า "ดีขึ้น"
  const fourm = buildFlowModel([
    { key: 'fourm_approve_h', month_key: '2026-10', n: 384, val: 236.3 },
    { key: 'fourm_approve_h', month_key: '2026-11', n: 5, val: 3.1 },
  ], months).find(x => x.key === 'fourm_approve_h')
  assert.deepEqual(flowTrend(fourm, months), { vsBase: null, vsPrev: null })
  // เคสจริงปิดกะ: ก.ย. 16 → ต.ค. 4.4 → พ.ย. 10.9
  const lag = buildFlowModel([
    { key: 'close_lag_h', month_key: '2026-09', n: 300, val: 16 },
    { key: 'close_lag_h', month_key: '2026-10', n: 781, val: 4.4 },
    { key: 'close_lag_h', month_key: '2026-11', n: 847, val: 10.9 },
  ], months).find(x => x.key === 'close_lag_h')
  const t = flowTrend(lag, months)
  assert.equal(t.vsBase.improved, true)
  assert.equal(t.vsPrev.improved, false)
  assert.equal(t.vsPrev.fromMonth, '2026-10')
})
