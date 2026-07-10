import { useEffect, useRef, useState } from 'react'

/* three.js viewer for a GLB model (PM equipment 3D).
   - orbit (drag) / zoom / pan · auto-rotate (pauses when the user grabs it)
   - auto-fits the camera to the model bounds
   three + loaders are imported dynamically so only pages that actually show a
   model pull the ~600KB three bundle. */
export default function Model3DViewer({ url, height = 340 }) {
  const mountRef = useRef(null)
  const autoRef = useRef(true)
  const [auto, setAuto] = useState(true)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let renderer, controls, raf, ro, disposed = false
    autoRef.current = true; setAuto(true); setLoading(true); setErr(null)
    ;(async () => {
      try {
        const THREE = await import('three')
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
        const mount = mountRef.current
        if (!mount || disposed) return
        const w = mount.clientWidth || 480, h = height
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000)
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setSize(w, h)
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
        mount.appendChild(renderer.domElement)
        renderer.domElement.style.display = 'block'
        renderer.domElement.style.touchAction = 'none'

        scene.add(new THREE.HemisphereLight(0xffffff, 0x40484a, 1.15))
        const key = new THREE.DirectionalLight(0xffffff, 1.25); key.position.set(4, 6, 5); scene.add(key)
        const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-5, 2, -3); scene.add(fill)

        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.addEventListener('start', () => { autoRef.current = false; setAuto(false) })

        const gltf = await new GLTFLoader().loadAsync(url)
        if (disposed) return
        const model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        model.position.sub(center) // recentre at origin
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        camera.position.set(maxDim * 0.6, maxDim * 0.5, maxDim * 1.9)
        camera.near = maxDim / 200; camera.far = maxDim * 200; camera.updateProjectionMatrix()
        controls.target.set(0, 0, 0); controls.update()
        scene.add(model)
        setLoading(false)

        const animate = () => {
          raf = requestAnimationFrame(animate)
          if (autoRef.current) model.rotation.y += 0.006
          controls.update()
          renderer.render(scene, camera)
        }
        animate()

        ro = new ResizeObserver(() => {
          const nw = mount.clientWidth || w
          renderer.setSize(nw, h); camera.aspect = nw / h; camera.updateProjectionMatrix()
        })
        ro.observe(mount)
      } catch (e) {
        if (!disposed) { setErr(e?.message || 'โหลดโมเดล 3D ไม่สำเร็จ'); setLoading(false) }
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro?.disconnect()
      controls?.dispose()
      if (renderer) { renderer.dispose(); renderer.domElement?.remove() }
    }
  }, [url, height])

  const toggleAuto = () => { autoRef.current = !autoRef.current; setAuto(autoRef.current) }

  return (
    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg2)', marginBottom: 16 }}>
      <div ref={mountRef} style={{ width: '100%', height }} />
      {loading && !err && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13, gap: 8 }}>
          <div style={{ width: 22, height: 22, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> โหลดโมเดล 3D…
        </div>
      )}
      {err && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e05c4a', fontSize: 12.5, textAlign: 'center', padding: 16 }}>⚠️ {err}</div>
      )}
      {!loading && !err && (
        <>
          <button onClick={toggleAuto} title={auto ? 'หยุดหมุนอัตโนมัติ' : 'หมุนอัตโนมัติ'}
            style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: 999, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {auto ? '⏸ หยุดหมุน' : '▶ หมุนเอง'}
          </button>
          <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11, fontWeight: 600, borderRadius: 12, padding: '3px 12px', pointerEvents: 'none' }}>🧊 ลากเพื่อหมุน · สกรอลล์ซูม · โมเดล 3D จริง</div>
        </>
      )}
    </div>
  )
}
