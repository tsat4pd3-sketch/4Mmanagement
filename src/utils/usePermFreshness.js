/* ── usePermFreshness — แก้สิทธิ์/ขอบเขตแล้วต้องมีผลกับเครื่องที่เปิดค้าง (2026-11-03 · ประชุมหน้างาน 02/11 ข้อ A5) ──
   กฎ/เหตุผลเต็มอยู่ที่ `permFreshness.js` (pure · มีเทส) · ไฟล์นี้แค่ยิง probe + ผูกเหตุการณ์

   ยิงเมื่อ:  ① ทันทีที่ login (จด baseline — ไม่โหลดอะไรเพิ่ม)
              ② กลับมาที่แท็บ (visibilitychange → visible · focus · online) — เพดาน `LIVE.PERMS`
              ③ กันเหนียวทุก `RATE.BOARD` เฉพาะตอนแท็บมองเห็นอยู่ (จอ TV ไม่เคยซ่อน/ไม่เคย focus ใหม่)
   ลายเซ็นเปลี่ยน ⇒ `onPerms()` (โหลด role_permissions ใหม่) / `onProfile()` (fetchProfile ใหม่)

   ⚠️ probe ล้ม = ไม่ทำอะไร (คง baseline · รอบหน้าลองใหม่) = พฤติกรรมเดิมก่อนมีไฟล์นี้ — ไม่ต้องเตือนบนจอ
   ⚠️ realtime ของ `role_permissions` ใน App.jsx ยังเป็นทางหลัก — ตัวนี้เก็บตกตอน socket หลุด
      หลัง realtime โหลดสิทธิ์ใหม่แล้ว ให้เรียก `rebasePerms()` กันโหลดชุดเต็มซ้ำรอบที่ 2 */
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { LIVE, RATE } from './refreshRates';
import { getWorkDate } from './workDate';
import { permProbeSignature, diffPermSignature, mergePermSignature, shouldProbe } from './permFreshness';

async function readProbe(userId) {
  const [prof, cnt, mx, asg] = await Promise.all([
    supabase.from('profiles').select('updated_at').eq('id', userId).maybeSingle(),
    supabase.from('role_permissions').select('id', { count: 'exact', head: true }),
    supabase.from('role_permissions').select('updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false }).limit(1),
    supabase.from('org_assignments')
      .select('id, org_node_id, kind, scope_depth, starts_on, ends_on').eq('profile_id', userId),
  ]);
  if (prof.error || cnt.error || mx.error || asg.error) {
    console.warn('[permFreshness] probe อ่านไม่ครบ — ส่วนที่ล้มถือว่า "ไม่รู้" (ไม่โหลดใหม่)',
      prof.error || cnt.error || mx.error || asg.error);
  }
  return permProbeSignature({
    // ไม่มีแถวโปรไฟล์ = ไม่ใช่เรื่องของตัวนี้ (fetchProfile จัดการ signOut เอง) ⇒ "ไม่รู้"
    profileUpdatedAt: prof.error ? null : (prof.data?.updated_at ?? null),
    assignRows: asg.error ? null : (asg.data || []),
    today: getWorkDate(),
    permCount: cnt.error ? null : cnt.count,
    permMaxUpdatedAt: mx.error ? null : (mx.data?.[0]?.updated_at ?? null),
  });
}

/**
 * @param {string|null} userId
 * @param {{ onPerms?: Function, onProfile?: Function }} handlers  เรียกได้ทั้ง sync/async
 * @returns {{ rebasePerms: Function }}
 */
export default function usePermFreshness(userId, handlers) {
  const cbRef = useRef(handlers);
  cbRef.current = handlers;
  const sigRef = useRef(null);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    let running = false;
    let lastAt = 0;
    sigRef.current = null;   // บัญชีใหม่ = baseline ใหม่

    const probe = async (force = false) => {
      if (!alive || running) return;
      if (!force) {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        if (!shouldProbe(Date.now(), lastAt, LIVE.PERMS)) return;
      }
      running = true;
      lastAt = Date.now();
      try {
        const next = await readProbe(userId);
        if (!alive) return;
        const d = diffPermSignature(sigRef.current, next);
        sigRef.current = mergePermSignature(sigRef.current, next);
        if (d.perms)   await cbRef.current?.onPerms?.();
        if (d.profile) await cbRef.current?.onProfile?.();
      } catch (e) {
        console.warn('[permFreshness] probe ล้ม — ลองใหม่รอบหน้า', e);
      } finally {
        running = false;
      }
    };

    probe(true);
    const onBack = () => { if (document.visibilityState !== 'hidden') probe(); };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    window.addEventListener('online', onBack);
    const iv = setInterval(() => probe(), RATE.BOARD);
    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
      window.removeEventListener('online', onBack);
    };
  }, [userId]);

  /* realtime โหลดสิทธิ์ใหม่ไปแล้ว ⇒ ล้าง baseline ฝั่งสิทธิ์ ให้ probe รอบหน้าจดใหม่แทนการโหลดซ้ำ */
  const rebasePerms = useCallback(() => {
    if (sigRef.current) sigRef.current = { ...sigRef.current, perms: null };
  }, []);

  return { rebasePerms };
}
