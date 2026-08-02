import { Perf } from 'r3f-perf'
import { Leva, useControls } from 'leva'
import { useEffect, useState } from 'react'

/**
 * Development instrumentation: the frame HUD and the live tuning panel.
 *
 * Both are stripped from production builds via `import.meta.env.DEV`, and both are off by
 * default in a session so they never cost frames while playtesting. F1 toggles the frame
 * HUD, F2 the tuning panel.
 */

export function useDevToggles() {
  const [showPerf, setShowPerf] = useState(false)
  const [showPanel, setShowPanel] = useState(false)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F1') {
        e.preventDefault()
        setShowPerf((v) => !v)
      }
      if (e.code === 'F2') {
        e.preventDefault()
        setShowPanel((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { showPerf, showPanel }
}

/** Lives inside <Canvas>. */
export function DevPerf({ visible }: { visible: boolean }) {
  if (!import.meta.env.DEV || !visible) return null
  return <Perf position="top-left" minimal={false} />
}

/** Lives outside <Canvas> — leva renders DOM. */
export function DevPanel({ visible }: { visible: boolean }) {
  if (!import.meta.env.DEV) return null
  return <Leva collapsed={false} hidden={!visible} titleBar={{ title: 'Tuning' }} />
}

/** Scene-lighting knobs, so the greybox can be dialled in without a rebuild. */
export function useLightingControls() {
  const enabled = import.meta.env.DEV
  const values = useControls(
    'Lighting',
    {
      ambient: { value: 0.35, min: 0, max: 2, step: 0.01 },
      keyIntensity: { value: 2.5, min: 0, max: 20, step: 0.1 },
      keyHeight: { value: 6, min: 1, max: 12, step: 0.1 },
    },
    { collapsed: true },
  )
  return enabled ? values : { ambient: 0.35, keyIntensity: 2.5, keyHeight: 6 }
}
