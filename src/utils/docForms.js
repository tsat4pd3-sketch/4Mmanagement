/**
 * Document Master — ทะเบียนเอกสาร & ฟอร์ม (ตาราง doc_forms ฝั่ง Main)
 * ฟังก์ชันพิมพ์ฟอร์มทุกตัวอ่าน เลขฟอร์ม/Rev/Effective/ช่องลายเซ็น/footer จากทะเบียนนี้
 * โดยส่ง fallback = ค่าที่เคย hardcode ในโค้ดเสมอ → ทะเบียนล่ม/แถวหาย = ฟอร์มยังพิมพ์ได้เหมือนเดิม
 * แก้ค่าจากหน้า /doc-forms (สิทธิ์ doc_forms:manage — document_control/manager/admin)
 */
import { supabase } from '../supabaseClient';

let cache = null; // Map<doc_key, row>

export async function loadDocForms(force = false) {
  if (cache && !force) return cache;
  try {
    const { data } = await supabase.from('doc_forms').select('*').eq('is_active', true);
    cache = new Map((data || []).map(r => [r.doc_key, r]));
  } catch { cache = cache || new Map(); }
  return cache;
}

const merge = (r, fb) => ({
  form_code: r?.form_code ?? fb.form_code ?? '',
  title: r?.title ?? fb.title ?? '',
  rev: r?.rev ?? fb.rev ?? '',
  effective_date: r?.effective_date ?? fb.effective_date ?? '',
  sig_blocks: (Array.isArray(r?.sig_blocks) && r.sig_blocks.length ? r.sig_blocks : fb.sig_blocks) ?? null,
  footer_note: r?.footer_note ?? fb.footer_note ?? '',
  logo_url: r?.logo_url ?? null,
  legend: r?.legend ?? fb.legend ?? '',
  issued_by: r?.issued_by ?? null,
});

/** ใช้ในฟังก์ชันพิมพ์ที่ async ได้ */
export async function getDocForm(key, fallback = {}) {
  const m = await loadDocForms();
  return merge(m.get(key), fallback);
}

/** ใช้ในฟังก์ชันพิมพ์ sync — ต้องเรียก loadDocForms() ที่ module/mount ของหน้านั้นก่อน */
export function docFormSync(key, fallback = {}) {
  return merge(cache?.get(key), fallback);
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
export function withDocFoot(html, key) {
  const df = docFormSync(key, {});
  const code = fullCode(df);
  if (!code && !df.footer_note) return html;
  const foot = `<div style="margin-top:8px;font-size:9px;color:#555;display:flex;justify-content:space-between;font-family:'Sarabun',sans-serif">
    <span>${df.footer_note || ''}</span>
    <span>${code}${df.effective_date ? ` · Effective: ${df.effective_date}` : ''}</span></div>`;
  return html.includes('</body>') ? html.replace('</body>', `${foot}</body>`) : html + foot;
}
