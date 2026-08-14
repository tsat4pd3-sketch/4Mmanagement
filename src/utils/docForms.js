/**
 * Document Master — ทะเบียนเอกสาร & ฟอร์ม (ตาราง doc_forms ฝั่ง Main)
 * ฟังก์ชันพิมพ์ฟอร์มทุกตัวอ่าน เลขฟอร์ม/Rev/Effective/ช่องลายเซ็น/footer จากทะเบียนนี้
 * โดยส่ง fallback = ค่าที่เคย hardcode ในโค้ดเสมอ → ทะเบียนล่ม/แถวหาย = ฟอร์มยังพิมพ์ได้เหมือนเดิม
 * แก้ค่าจากหน้า /doc-forms (สิทธิ์ doc_forms:manage — document_control/manager/admin)
 */
import { supabase } from '../supabaseClient';

let cache = null;       // Map<doc_key, row>
let scopeCache = null;  // Map<`${doc_key}|${section}`, row> — override รายส่วนงาน

export async function loadDocForms(force = false) {
  if (cache && !force) return cache;
  try {
    const { data } = await supabase.from('doc_forms').select('*').eq('is_active', true);
    cache = new Map((data || []).map(r => [r.doc_key, r]));
  } catch { cache = cache || new Map(); }
  // override รายส่วนงาน — ยังไม่ apply migration = ว่าง ไม่ล้ม (ใบพิมพ์ใช้ฐานกลางเหมือนเดิม)
  try {
    const { data } = await supabase.from('doc_form_scopes').select('*').eq('is_active', true);
    scopeCache = new Map((data || []).map(r => [`${r.doc_key}|${norm(r.section)}`, r]));
  } catch { scopeCache = scopeCache || new Map(); }
  return cache;
}

const norm = (s) => String(s ?? '').trim().toLowerCase();
const pick = (...vals) => vals.find(v => v != null && v !== '') ?? null;

/** ฐานกลาง → override รายส่วนงาน → fallback ในโค้ด (ค่าที่เคย hardcode) */
const merge = (r, fb, sc) => ({
  form_code: r?.form_code ?? fb.form_code ?? '',
  title: r?.title ?? fb.title ?? '',
  rev: r?.rev ?? fb.rev ?? '',
  effective_date: r?.effective_date ?? fb.effective_date ?? '',
  // ⚠️ จำนวนช่องเซ็นต้องเท่า layout ฟอร์มเสมอ — scope เปลี่ยนได้แค่ "ข้อความ" ไม่ใช่จำนวนช่อง
  sig_blocks: (Array.isArray(sc?.sig_blocks) && sc.sig_blocks.length ? sc.sig_blocks
    : Array.isArray(r?.sig_blocks) && r.sig_blocks.length ? r.sig_blocks : fb.sig_blocks) ?? null,
  // ชื่อผู้เซ็นประจำต่อช่อง (มีเฉพาะเมื่อตั้ง scope) — ช่องที่เว้นว่าง = เว้นให้เซ็นสดเหมือนเดิม
  sig_names: Array.isArray(sc?.sig_names) ? sc.sig_names : null,
  footer_note: pick(sc?.footer_note, r?.footer_note, fb.footer_note) ?? '',
  logo_url: r?.logo_url ?? null,
  legend: pick(sc?.legend, r?.legend, fb.legend) ?? '',
  issued_by: pick(sc?.issued_by, r?.issued_by) ?? null,
  paper_size: r?.paper_size ?? fb.paper_size ?? null,
  orientation: r?.orientation ?? fb.orientation ?? null,
  layout_locked: r?.layout_locked !== false,
  _section: sc?.section ?? null,   // ใบนี้ใช้ชุดของส่วนงานไหน
});

const scopeRow = (key, section) => (section ? scopeCache?.get(`${key}|${norm(section)}`) : null) || null;

/**
 * ใช้ในฟังก์ชันพิมพ์ที่ async ได้
 * @param {{section?:string}} opts ส่วนงานของ "ใบที่กำลังพิมพ์" → ได้ชุดช่องเซ็นของส่วนงานนั้น
 */
export async function getDocForm(key, fallback = {}, opts = {}) {
  const m = await loadDocForms();
  return merge(m.get(key), fallback, scopeRow(key, opts.section));
}

/** ใช้ในฟังก์ชันพิมพ์ sync — ต้องเรียก loadDocForms() ที่ module/mount ของหน้านั้นก่อน */
export function docFormSync(key, fallback = {}, opts = {}) {
  return merge(cache?.get(key), fallback, scopeRow(key, opts.section));
}

/** ส่วนงานที่ตั้ง override ไว้ของฟอร์มนี้ (ใช้โชว์ในทะเบียน) */
export function docFormScopes(key) {
  return [...(scopeCache?.values() || [])].filter(r => r.doc_key === key);
}

/**
 * ป้ายช่องเซ็น + ชื่อผู้เซ็นประจำของช่องที่ i — ฟอร์มพิมพ์เรียกตัวนี้แทนอ่าน sig_blocks ตรงๆ
 * จะได้ชื่อประจำส่วนงานมาให้เอง (ไม่ได้ตั้ง = name ว่าง → ใบเว้นช่องให้เซ็นสดเหมือนเดิม)
 */
export const sigAt = (df, i) => ({
  label: df?.sig_blocks?.[i] ?? '',
  name: (df?.sig_names?.[i] || '').trim(),
});

/**
 * ค่า `size` ของ CSS @page จากทะเบียน — มีผลเฉพาะฟอร์มที่ layout ไม่ล็อก (รายงานภายใน)
 * ฟอร์มทางการ layout ผูกกับแนวกระดาษตายตัว เปลี่ยนแล้วใบพัง → คืน fallback ของโค้ดเสมอ
 */
export function pageCss(df, fallback = 'A4 portrait') {
  if (!df || df.layout_locked !== false) return fallback;
  return `${df.paper_size || 'A4'} ${df.orientation || 'portrait'}`;
}

/** "FM-QMR-008 Rev.01" — เลขฟอร์ม + Rev (ตัดส่วนที่ว่าง) */
export const fullCode = (df, sep = ' ') => [df.form_code, df.rev].filter(Boolean).join(sep);

/** Revision History ของฟอร์ม (ตาราง doc_form_revisions) — ตารางยังไม่มี/ว่าง = [] ไม่ล้ม */
export async function getDocFormRevisions(key) {
  try {
    const { data } = await supabase.from('doc_form_revisions')
      .select('id, seq, record_date, rev, issued_date, description, responsible, approved_name')
      .eq('doc_key', key).order('seq');
    return data || [];
  } catch { return []; }
}

/** แถบท้ายเอกสารมาตรฐาน — ต่อท้าย html ก่อน </body> เมื่อทะเบียนมีเลขฟอร์ม/footer (ไม่ตั้ง = html เดิมเป๊ะ) */
export function withDocFoot(html, key, opts = {}) {
  const df = docFormSync(key, {}, opts);
  const code = fullCode(df);
  // แนวกระดาษจากทะเบียน — เฉพาะรายงานภายใน (layout_locked=false) และตั้งค่าไว้จริงเท่านั้น
  // ต่อท้าย <head> ให้ทับ @page เดิมของหน้า (specificity เท่ากัน = ตัวหลังชนะ)
  const pageRule = (!df.layout_locked && df.orientation)
    ? `<style>@media print{@page{size:${df.paper_size || 'A4'} ${df.orientation}}}</style>` : '';
  if (pageRule && html.includes('</head>')) html = html.replace('</head>', `${pageRule}</head>`);
  if (!code && !df.footer_note) return html;
  const foot = `<div style="margin-top:8px;font-size:9px;color:#555;display:flex;justify-content:space-between;font-family:'Sarabun',sans-serif">
    <span>${df.footer_note || ''}</span>
    <span>${code}${df.effective_date ? ` · Effective: ${df.effective_date}` : ''}</span></div>`;
  return html.includes('</body>') ? html.replace('</body>', `${foot}</body>`) : html + foot;
}
