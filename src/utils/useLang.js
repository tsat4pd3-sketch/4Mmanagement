/* ══ 🌐 useLang — hook/Provider ของปุ่มสลับ ไทย/English (คู่กับ utils/i18n.js) ═══════════════
   · `LangProvider` ครอบที่รากแอป (App.jsx) — เก็บ state + เขียน `<html lang>` + localStorage
   · สลับภาษาแล้ว App ตั้ง `key={lang}` ให้ <Router> ⇒ ทั้งต้นไม้ mount ใหม่ — เพราะข้อความถูกแปลที่
     "จุดวาด" ด้วย `tr()` ซึ่งเป็นฟังก์ชันโมดูล (ไม่ใช่ context) · ของที่ `useMemo` ป้ายไว้จะไม่รู้ว่าภาษาเปลี่ยน
     ⇒ mount ใหม่คือทางเดียวที่รับประกันว่าทุกป้ายสลับพร้อมกัน (สลับภาษาเป็นงานนานๆ ครั้ง รับได้)
   · ไม่มี Provider (harness `audit/*.html` · เทส) = ใช้ค่าจากโมดูล + สลับแล้ว reload หน้า
   ═════════════════════════════════════════════════════════════════════════════════════════ */
import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react';
import { getLang, setLang, nextLang, tr } from './i18n';

const fallback = {
  lang: getLang(),
  setLang: (l) => { setLang(l); if (typeof location !== 'undefined') location.reload(); },
  toggleLang: () => { setLang(nextLang()); if (typeof location !== 'undefined') location.reload(); },
  tr,
};

export const LangContext = createContext(fallback);

export function LangProvider({ children }) {
  const [lang, setState] = useState(() => {
    const l = getLang();
    if (typeof document !== 'undefined') document.documentElement.lang = l;
    return l;
  });
  const set = useCallback((l) => setState(setLang(l)), []);
  const toggleLang = useCallback(() => setState(prev => setLang(nextLang(prev))), []);
  const value = useMemo(() => ({ lang, setLang: set, toggleLang, tr }), [lang, set, toggleLang]);
  return createElement(LangContext.Provider, { value }, children);
}

/** `{ lang, setLang, toggleLang, tr }` — ปุ่มสลับใช้ `toggleLang` · ป้ายใช้ `tr(str)` */
export default function useLang() {
  return useContext(LangContext);
}

/** ป้ายบนปุ่มสลับ — โชว์ "ภาษาที่จะสลับไป" (กดแล้วได้อะไร) ไม่ใช่ภาษาปัจจุบัน */
export const langToggleLabel = (lang) => (lang === 'th' ? 'EN' : 'ไทย');
export const langToggleTitle = (lang) => (lang === 'th' ? 'Switch to English' : 'สลับเป็นภาษาไทย');
