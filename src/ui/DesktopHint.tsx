import { useEffect, useState } from 'react'

/**
 * The click-to-look prompt, and the desktop control legend.
 *
 * Pointer lock cannot be requested without a user gesture, so on desktop the game opens
 * with mouselook inert. Without something saying so, that reads as a broken build rather
 * than a browser requirement.
 *
 * DOM rather than world-space, unlike the rest of the game's UI, because it is only ever
 * shown *outside* a session — it is part of the page, not part of the world.
 */
export function DesktopHint() {
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    const onChange = () => setLocked(document.pointerLockElement != null)
    document.addEventListener('pointerlockchange', onChange)
    return () => document.removeEventListener('pointerlockchange', onChange)
  }, [])

  if (locked) {
    return (
      <div className="hint hint--locked">
        WASD move · Shift sprint · Space jump · Esc release cursor
      </div>
    )
  }

  return (
    <div className="hint">
      Click to look around
      {import.meta.env.DEV && <> · F1 perf · F2 tuning</>}
    </div>
  )
}
