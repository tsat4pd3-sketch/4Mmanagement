/* ═══════════════════════════════════════════════════════════════════════════════
   ✍️ ลายเซ็นของ "รอบเอกสาร" จาก e-Workflow → ช่องเซ็นบนใบพิมพ์ (2026-11-25 · BBS นำร่อง)
   คำสั่ง user: "ทุกเอกสารคุม issued/checked/approved ผ่าน e-workflow · เซ็นบนเอกสารเอง ไม่ต้องออกใบแยก"

   · ใบงานที่ผูกเอกสาร (`flow_schema.binding.subject`) ตั้งที่ /workflow-designer — ช่องเซ็น = ขั้นของใบงาน
   · ลายเซ็น = `profiles.signature_url` ของคนที่กดเซ็นขั้นนั้นเอง (เจ้าตัวกดเอง · utils/selfSign.js)
   · คืน `null` = ไม่มีใบงานผูกเอกสารนี้ (ใบพิมพ์ใช้ช่องเซ็นเดิมจากทะเบียน /doc-forms)
   · อ่านไม่ได้ = `{ error }` — ห้ามพิมพ์ช่องว่างแล้วทำเหมือน "ยังไม่มีใครเซ็น"
   ═══════════════════════════════════════════════════════════════════════════════ */
import { wfPeriodRange, roundKey, signoffRows } from '../utils/wfBound';

const ACTIVE = ['in_progress', 'returned', 'approved'];

/**
 * @returns {Promise<null | { error: string } | { defName, docNo, status, rows: [{label,name,at,sigUrl}] }>}
 */
export async function loadRoundSignoff(supabase, { subject, defKey = null, line, date, shift = null }) {
  const dRes = await supabase.from('wf_defs')
    .select('id, key, name, wf_versions!wf_defs_current_version_fk(flow_schema)').eq('status', 'active');
  if (dRes.error) return { error: dRes.error.message };
  const def = (dRes.data || []).find(d => d.wf_versions?.flow_schema?.binding?.subject === subject && (!defKey || d.key === defKey));
  if (!def) return null;
  const flow = def.wf_versions.flow_schema;
  const [from] = wfPeriodRange(flow.binding.period, date) || [];
  if (!from) return { error: 'แกะช่วงวันของรอบไม่ออก' };
  const sh = flow.binding.perShift ? shift : null;
  const iRes = await supabase.from('wf_instances')
    .select('id, doc_no, status, wf_actions(action, step_index, actor_id, actor_name, acted_at)')
    .eq('def_id', def.id).eq('subject_key', roundKey(line, from, sh)).in('status', ACTIVE)
    .order('created_at', { ascending: false }).limit(1);
  if (iRes.error) return { error: iRes.error.message };
  const inst = (iRes.data || [])[0] || null;
  const rows = signoffRows(flow, inst?.wf_actions || []);
  const ids = [...new Set(rows.map(r => r.actorId).filter(Boolean))];
  let sig = {};
  if (ids.length) {
    const pRes = await supabase.from('profiles').select('id, signature_url').in('id', ids);
    if (pRes.error) return { error: pRes.error.message };
    sig = Object.fromEntries((pRes.data || []).map(p => [p.id, p.signature_url || null]));
  }
  return {
    defName: def.name, docNo: inst?.doc_no || null, status: inst?.status || null,
    rows: rows.map(r => ({ label: r.label, name: r.name, at: r.at, sigUrl: r.actorId ? sig[r.actorId] || null : null })),
  };
}
