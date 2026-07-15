import { useEffect, useRef, useState } from 'react';

/* ═══ GestureCam — ควบคุม UI ด้วยท่ามือผ่านกล้อง (MediaPipe Tasks Vision) ═══
   ใช้ในโหมดประชุมแถวเช้า: ปัดมือเปลี่ยนวาระ / กำมือค้างออกจากโหมด
   หลักความปลอดภัย:
   - ประมวลผลในเครื่อง 100% (WASM) — ภาพจากกล้องไม่ถูกส่งออกนอกเครื่องเด็ดขาด
   - โมเดล + WASM self-host ใน /public/mediapipe (ไม่พึ่ง CDN — กันเน็ตโรงงานบล็อก)
   - โหลดแบบ lazy เฉพาะตอนผู้ใช้กดเปิด 📷 เอง (opt-in) — bundle หลักไม่บวมขึ้น
   - มี preview + จุดแดงบอกชัดว่ากล้องทำงานอยู่ · ปิดโหมด = ปิด track กล้องทันที
   - gesture คุมได้แค่ "เปลี่ยนหน้า/ออกจากโหมด" — ห้ามผูกกับ action ที่แก้ข้อมูล

   ท่าที่รองรับ — ตัวหลักคือ "นิ้วชี้บอกทิศ + ค้าง" (มือนิ่ง จับแม่นกว่าการปัดที่ภาพเบลอ):
   - ☝️ ชี้นิ้ว ◀/▶ ค้าง ~0.45 วิ    → 'prev'/'next' (ทิศลูกศรตรงตัว)
   - ☝️ ชี้นิ้ว ▲/▼ ค้าง            → 'scroll_up'/'scroll_down' (ค้างต่อ = เลื่อนต่อเนื่อง)
   - ✋ ฝ่ามือปัดซ้าย/ขวา            → 'next'/'prev' (ตัวรอง — ยังใช้ได้)
   - 👍 ชูโป้งค้าง ~0.6 วิ            → 'next'
   - ✊ กำมือค้าง ~0.9 วิ            → 'exit'
   ทุก action มี cooldown กันรัวซ้ำ · ทิศนิ้วคิดจากเวกเตอร์ landmark โคนนิ้วชี้(5) → ปลายนิ้วชี้(8)
   โดยต้องเข้าเงื่อนไข "ชี้นิ้วเดียว": นิ้วชี้เหยียด + กลาง/นาง/ก้อยพับ (ตรรกะเดียวกับนับนิ้ว)
   ═══════════════════════════════════════════════════════════════════════════ */

const SWIPE_DX = 0.20;         // ระยะปัดขั้นต่ำ (สัดส่วนความกว้างเฟรม)
const SWIPE_WINDOW_MS = 550;   // ต้องปัดให้จบภายในเวลานี้
const TRAIL_GAP_MS = 220;      // มือหลุด track สั้นๆ (ภาพเบลอ) ไม่รีเซ็ตเส้นทางปัด — เกินนี้ค่อยล้าง
const HOLD_THUMB_MS = 600;     // ชูโป้งค้างกี่ ms ถึงนับ
const HOLD_FIST_MS = 900;      // กำมือค้างกี่ ms ถึงนับ (นานกว่า — เป็น action ออกจากโหมด)
const POINT_HOLD_MS = 450;     // ชี้นิ้วค้างกี่ ms ถึงนับ
const SCROLL_REPEAT_MS = 450;  // ชี้ ▲/▼ ค้างต่อเนื่อง = สั่งเลื่อนซ้ำทุกๆ กี่ ms
const POINT_MIN_LEN = 0.09;    // ความยาวเวกเตอร์นิ้วขั้นต่ำ (กันมือไกลจนอ่านทิศเพี้ยน)
const POINT_AXIS_RATIO = 1.4;  // แกนหลักต้องชนะอีกแกนกี่เท่า ถึงตัดสินทิศ (กันชี้เฉียงกำกวม)
const COOLDOWN_MS = 1200;      // เว้นหลัง action เปลี่ยนวาระ/ออก กันรัวซ้ำ

export default function GestureCam({ onGesture, onError }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | running | error
  const [lastAction, setLastAction] = useState(null); // โชว์ feedback ท่าล่าสุดบน preview

  useEffect(() => {
    let recognizer = null;
    let stream = null;
    let raf = 0;
    let stopped = false;

    // สถานะตรวจจับ (อยู่นอก React state — อัพเดททุกเฟรม)
    const trail = [];            // [{ x, t }] ตำแหน่งข้อมือ สำหรับตรวจปัด
    let holdStart = null;        // { name, t } gesture ที่กำลังค้างอยู่
    let pointHold = null;        // { dir, t, fired } ทิศนิ้วชี้ที่กำลังค้างอยู่
    let lastHandAt = 0;          // เวลาเฟรมล่าสุดที่เห็นมือ — ใช้ยอมให้ track หลุดสั้นๆ
    let cooldownUntil = 0;
    let lastVideoTime = -1;

    const fire = (action, label) => {
      cooldownUntil = performance.now() + COOLDOWN_MS;
      trail.length = 0;
      holdStart = null;
      setLastAction(label);
      setTimeout(() => setLastAction(null), 900);
      onGesture?.(action);
    };

    (async () => {
      try {
        // dynamic import — โค้ด MediaPipe แยก chunk โหลดเฉพาะตอนเปิดโหมดนี้
        const { FilesetResolver, GestureRecognizer } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        recognizer = await GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/mediapipe/gesture_recognizer.task', delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
        }).catch(async () => {
          // เครื่องที่ GPU delegate ใช้ไม่ได้ (webview เก่า) — ถอยมา CPU
          const { FilesetResolver: FR2, GestureRecognizer: GR2 } = await import('@mediapipe/tasks-vision');
          const fs2 = await FR2.forVisionTasks('/mediapipe/wasm');
          return GR2.createFromOptions(fs2, {
            baseOptions: { modelAssetPath: '/mediapipe/gesture_recognizer.task', delegate: 'CPU' },
            runningMode: 'VIDEO',
            numHands: 1,
          });
        });
        if (stopped) { recognizer?.close(); return; }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 } },
          audio: false,
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); recognizer?.close(); return; }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setStatus('running');

        const loop = () => {
          if (stopped) return;
          raf = requestAnimationFrame(loop);
          const now = performance.now();
          if (!video.videoWidth || video.currentTime === lastVideoTime) return;
          lastVideoTime = video.currentTime;
          const result = recognizer.recognizeForVideo(video, now);
          if (now < cooldownUntil) return;

          const gesture = result.gestures?.[0]?.[0]; // มือแรก ท่าที่มั่นใจสุด
          const hand = result.landmarks?.[0];
          const name = gesture && gesture.score > 0.55 ? gesture.categoryName : null;
          if (hand) lastHandAt = now;

          // ── ☝️ นิ้วชี้บอกทิศ (ตัวหลัก — มือนิ่ง จับแม่นกว่าการปัด): เข้าเงื่อนไข "ชี้นิ้วเดียว"
          //    (นิ้วชี้เหยียด + กลาง/นาง/ก้อยพับ — ตรรกะนับนิ้วมาตรฐาน) แล้วอ่านทิศจากเวกเตอร์ 5→8 ──
          const pointDir = (() => {
            if (!hand) return null;
            const d2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
            const w = hand[0];
            const idxExt   = d2(hand[8], w)  > d2(hand[6], w);   // นิ้วชี้เหยียด
            const midFold  = d2(hand[12], w) < d2(hand[10], w);  // กลางพับ
            const ringFold = d2(hand[16], w) < d2(hand[14], w);  // นางพับ
            const pinkFold = d2(hand[20], w) < d2(hand[18], w);  // ก้อยพับ
            if (!(idxExt && midFold && ringFold && pinkFold)) return null;
            const vx = hand[8].x - hand[5].x, vy = hand[8].y - hand[5].y;
            if (Math.hypot(vx, vy) < POINT_MIN_LEN) return null;
            // เฟรมกล้องไม่ mirror: ผู้ใช้ชี้ไปทางขวาของตัวเอง = x ลด · แกน y ของภาพชี้ลง
            if (Math.abs(vx) > Math.abs(vy) * POINT_AXIS_RATIO) return vx < 0 ? 'right' : 'left';
            if (Math.abs(vy) > Math.abs(vx) * POINT_AXIS_RATIO) return vy < 0 ? 'up' : 'down';
            return null; // ชี้เฉียงกำกวม — ไม่ตัดสิน
          })();

          if (pointDir) {
            if (!pointHold || pointHold.dir !== pointDir) pointHold = { dir: pointDir, t: now, fired: 0 };
            const held = now - pointHold.t;
            if (pointDir === 'up' || pointDir === 'down') {
              // เลื่อนหน้า: ค้างต่อเนื่อง = เลื่อนซ้ำเรื่อยๆ (ไม่ใช้ cooldown ใหญ่ — จะได้ไหลลื่น)
              if (held >= POINT_HOLD_MS && now - pointHold.fired >= SCROLL_REPEAT_MS) {
                pointHold.fired = now;
                trail.length = 0;
                setLastAction(pointDir === 'up' ? '☝️ เลื่อนขึ้น' : '👇 เลื่อนดูด้านล่าง');
                setTimeout(() => setLastAction(null), 500);
                onGesture?.(pointDir === 'up' ? 'scroll_up' : 'scroll_down');
              }
              return;
            }
            if (held >= POINT_HOLD_MS) {
              fire(pointDir === 'right' ? 'next' : 'prev', pointDir === 'right' ? '👉 วาระถัดไป' : '👈 วาระก่อนหน้า');
              return;
            }
          } else {
            pointHold = null;
          }

          // ── ✋ ปัดมือ (ตัวรอง): เก็บเส้นทางข้อมือทุกเฟรมที่เห็นมือ — มือหลุด track สั้นๆ
          //    (ภาพเบลอตอนเหวี่ยง) ไม่รีเซ็ต ปล่อยให้ค้างไว้จนเกิน TRAIL_GAP_MS ค่อยล้าง ──
          if (hand && name !== 'Closed_Fist') {
            trail.push({ x: hand[0].x, t: now });
            while (trail.length && now - trail[0].t > SWIPE_WINDOW_MS) trail.shift();
            if (trail.length >= 3) {
              const dx = trail[trail.length - 1].x - trail[0].x;
              // พิกัด landmark อยู่บนเฟรมกล้อง (ไม่ mirror): ผู้ใช้ปัดมือไปทางซ้ายของตัวเอง = x เพิ่ม
              if (dx >= SWIPE_DX) { fire('next', '👉 วาระถัดไป'); return; }
              if (dx <= -SWIPE_DX) { fire('prev', '👈 วาระก่อนหน้า'); return; }
            }
          } else if (name === 'Closed_Fist' || now - lastHandAt > TRAIL_GAP_MS) {
            trail.length = 0;
          }

          // ── ท่าค้าง: ชูโป้ง = ถัดไป · กำมือ = ออกจากโหมด ──
          if (name === 'Thumb_Up' || name === 'Closed_Fist') {
            if (!holdStart || holdStart.name !== name) holdStart = { name, t: now };
            const held = now - holdStart.t;
            if (name === 'Thumb_Up' && held >= HOLD_THUMB_MS) fire('next', '👍 วาระถัดไป');
            else if (name === 'Closed_Fist' && held >= HOLD_FIST_MS) fire('exit', '✊ ออกจากโหมดประชุม');
          } else {
            holdStart = null;
          }
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        console.error('GestureCam:', e);
        if (!stopped) { setStatus('error'); onError?.(e); }
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop()); // ดับกล้องทันทีที่ปิดโหมด
      recognizer?.close();
    };
  }, [onGesture, onError]);

  return (
    <div style={{
      position: 'absolute', right: 16, bottom: 16, zIndex: 30,
      borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border2)',
      background: '#000', boxShadow: '0 4px 20px rgba(0,0,0,0.6)', width: 176,
    }}>
      {/* mirror preview ให้เป็นธรรมชาติเหมือนส่องกระจก (การคำนวณใช้พิกัดเฟรมจริง ไม่เกี่ยว preview) */}
      <video ref={videoRef} muted playsInline style={{ width: '100%', height: 132, objectFit: 'cover', transform: 'scaleX(-1)', display: 'block', opacity: status === 'running' ? 1 : 0.3 }} />
      {/* จุดแดง = กล้องกำลังทำงาน (ต้องเห็นชัดเสมอ — privacy) */}
      <div style={{ position: 'absolute', top: 6, left: 8, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: '#fff', textShadow: '0 1px 2px #000' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444', display: 'inline-block' }} />
        กล้องทำงาน (ในเครื่อง)
      </div>
      {lastAction && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', fontSize: 13, fontWeight: 900, color: '#4ade80', textAlign: 'center', padding: 6 }}>
          {lastAction}
        </div>
      )}
      <div style={{ padding: '5px 8px', fontSize: 11, color: 'var(--text2)', background: 'var(--bg2)', lineHeight: 1.5 }}>
        {status === 'loading' && '⏳ กำลังโหลดโมเดล…'}
        {status === 'running' && <>☝️ ชี้ ◀▶ = เปลี่ยนวาระ · ชี้ ▲▼ = เลื่อน · ✊ ค้าง = ออก</>}
        {status === 'error' && '⚠️ เปิดกล้องไม่สำเร็จ — เช็คสิทธิ์กล้องของเบราว์เซอร์'}
      </div>
    </div>
  );
}
