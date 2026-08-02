import { useState } from 'react'
import { useXRSessionModeSupported } from '@react-three/xr'
import { isBlockedByInsecureContext, xrStore } from '@/core/xr'

/**
 * Entry point into VR.
 *
 * One of the two places DOM is allowed (the other being the main menu in Sprint 4.4):
 * entering a session requires a user gesture on a real HTML element, before any of the
 * world-space UI exists to be clicked.
 *
 * The failure messages matter more than the button. "No VR button on the headset" is
 * almost always plain http rather than a broken build, and a silent absence sends people
 * hunting through the wrong layer.
 */
export function VRButton() {
  const supported = useXRSessionModeSupported('immersive-vr')
  const [error, setError] = useState<string | null>(null)
  const [entering, setEntering] = useState(false)

  const enter = async () => {
    setError(null)
    setEntering(true)
    try {
      await xrStore.enterVR()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the VR session.')
    } finally {
      setEntering(false)
    }
  }

  if (supported === false) {
    return (
      <div className="vr-entry vr-entry--unavailable">
        {isBlockedByInsecureContext() ? (
          <>
            <strong>VR needs HTTPS.</strong> Run <code>npm run dev:xr</code> and open the
            https:// address on the headset.
          </>
        ) : (
          <>VR not available in this browser — desktop mode only.</>
        )}
      </div>
    )
  }

  // `undefined` while the support check is still in flight. Rendering nothing avoids a
  // button that appears and then vanishes.
  if (supported == null) return null

  return (
    <div className="vr-entry">
      <button type="button" className="vr-button" onClick={enter} disabled={entering}>
        {entering ? 'Starting…' : 'Enter VR'}
      </button>
      {error && <p className="vr-error">{error}</p>}
    </div>
  )
}
