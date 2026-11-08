/* ── useTrialReasons — ทะเบียนเหตุผลจองเครื่องทดลอง (DR `trial_reasons`)  (2026-11-05) ──
   migration 20261105b_trial_reasons_container_categories_dr.sql · ปลายทาง production_plan_lots.trial_reason
   เก็บ **label** (text) · จัดการที่ /production-plan แท็บ ⚙️ ตั้งค่า · แก้แล้วเรียก invalidateTrialReasons() */
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster, mrows } from './masterCache';
import useMasterRows from './useMasterRows.js';

const KEY = 'trial_reasons:master';

/** ชุดเดียวกับ seed — ใช้เมื่อทะเบียนยังโหลดไม่ได้/ยังไม่ apply (จองต่อได้ จอเตือนผ่าน registryFailText) */
export const DEFAULT_TRIAL_REASONS = ['T0 tryout', 'T1 tryout / แก้ไข', 'Run@Rate', 'ECI / เปลี่ยนแบบ', '4M change', 'ทดลองวัสดุใหม่'];

export async function loadTrialReasons() {
  return cachedMaster(KEY, async () => mrows(await supabaseDR.from('trial_reasons')
    .select('code, label, note, sort_order, is_active').order('sort_order').order('code')));
}
export const invalidateTrialReasons = () => invalidateMaster(KEY);

/** `{ rows, failed, stale, message, loading, reload }` */
export function useTrialReasonsState() { return useMasterRows(KEY, loadTrialReasons); }

/** label ที่ใช้งานอยู่ (เรียงตามทะเบียน) · ทะเบียนว่าง = DEFAULT_TRIAL_REASONS */
export function trialReasonLabels(rows) {
  const act = (rows || []).filter(r => r && r.is_active !== false && String(r.label || '').trim()).map(r => String(r.label).trim());
  return act.length ? act : DEFAULT_TRIAL_REASONS;
}
