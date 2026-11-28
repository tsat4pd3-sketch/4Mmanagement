/* ══ 📘 กลยุทธ์ของกิจกรรม — ตัวช่วย PDF + อ่านแถว act_strategy (2026-11-28 · ดูคำอธิบายเต็มที่ `src/components/StrategyBook.jsx`) ══ */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export const STRATEGY_BUCKET = 'act-public';
export const STRATEGY_MAX_PAGES = 5;
const MAX_BYTES = 20 * 1024 * 1024;
const RATIO = 16 / 9;

export async function openPdf(src) {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  return pdfjs.getDocument(typeof src === 'string' ? { url: src } : { data: src }).promise;
}

/** ตรวจไฟล์ก่อนอัป → { pages } หรือ { error } (ข้อความไทยพร้อมโชว์) */
export async function assertStrategyPdf(file) {
  if (file.type && file.type !== 'application/pdf') return { error: 'เลือกไฟล์ PDF' };
  if (file.size > MAX_BYTES) return { error: 'ไฟล์ใหญ่เกิน 20 MB' };
  let pdf;
  try { pdf = await openPdf(await file.arrayBuffer()); } catch { return { error: 'เปิดไฟล์ PDF นี้ไม่ได้' }; }
  if (pdf.numPages > STRATEGY_MAX_PAGES) return { error: `PDF มี ${pdf.numPages} หน้า · ได้ไม่เกิน ${STRATEGY_MAX_PAGES} หน้า` };
  for (let n = 1; n <= pdf.numPages; n++) {
    const v = (await pdf.getPage(n)).getViewport({ scale: 1 });
    if (Math.abs(v.width / v.height - RATIO) > RATIO * 0.02) return { error: `หน้า ${n} ไม่ใช่สัดส่วน 16:9 (แนวนอน)` };
  }
  return { pages: pdf.numPages };
}

/* ทุกหน้าเป็นรูป (≤ 5 หน้า) จำต่อ url — กลับมาแท็บเดิมไม่ต้องวาดใหม่ */
const pageCache = new Map();
export function pagesOf(url) {
  if (!pageCache.has(url)) {
    pageCache.set(url, (async () => {
      const pdf = await openPdf(url);
      const out = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 1600 / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
        out.push(canvas.toDataURL('image/jpeg', 0.9));
      }
      return out;
    })().catch((e) => { pageCache.delete(url); throw e; }));
  }
  return pageCache.get(url);
}

/** แถวกลยุทธ์ของกิจกรรม — { row, err, loading, reload } */
export function useStrategy(code) {
  const [got, setGot] = useState({ key: null, row: null, err: '' });
  const [tick, setTick] = useState(0);
  const key = `${code}|${tick}`;
  useEffect(() => {
    let alive = true;
    supabase.from('act_strategy').select('activity, url, file_path, file_name, pages, updated_at, updated_by_name').eq('activity', code).maybeSingle()
      .then(({ data, error }) => { if (alive) setGot({ key, row: error ? null : data, err: error ? error.message : '' }); });
    return () => { alive = false; };
  }, [code, key]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { row: got.key === key ? got.row : null, err: got.key === key ? got.err : '', loading: got.key !== key, reload };
}

