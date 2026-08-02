import { useEffect, useMemo } from 'react'
import { useGame } from '@/systems/game'
import { phaseLabel, useRun } from '@/systems/run'
import { createLabel, type Label } from '@/ui/label'

/**
 * The foyer's notice board: gold, and what the run is doing.
 *
 * This exists because of the rule Sprint 1.1 handed over — **feedback has to exist in the
 * world, or it does not exist.** A state machine and a persisted balance that only ever
 * appear in `console.info` are, from inside a headset, indistinguishable from nothing at
 * all. So the numbers go on a board on the wall by the door, where the player is already
 * looking as they leave and the first thing they see as they come back.
 *
 * World-space and diegetic, like every other piece of in-game UI here, so desktop and VR run
 * the same code. It is also a rehearsal for the Sprint 1.3 shop panel, which is the same
 * problem at ten times the size.
 */

/** Metres. Sized to read from across the room without dominating the wall. */
const LINE_HEIGHT = 0.13
const BOARD_WIDTH = 1.5
const BOARD_HEIGHT = 0.62

interface StatusBoardProps {
  position: [number, number, number]
  /** Yaw in radians. 0 faces +Z. */
  rotation?: number
}

export function StatusBoard({ position, rotation = 0 }: StatusBoardProps) {
  const gold = useGame((state) => state.save.gold)
  const phase = useRun((state) => state.phase)
  const wave = useRun((state) => state.wave)
  const lastReward = useRun((state) => state.lastReward)

  // Re-rendered only when one of these actually changes, which is a handful of times per
  // run. Everything read sixty times a second stays out of React entirely.
  const goldLine = `Gold  ${gold}`
  const statusLine =
    phase === 'waveComplete' && lastReward > 0
      ? `${phaseLabel(phase, wave)}  +${lastReward}`
      : phaseLabel(phase, wave)

  const goldLabel = useLabel(goldLine, '#ffd479')
  const statusLabel = useLabel(statusLine, '#d8cfc0')

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* The board itself. Dark and matte so the torchlight doesn't blow the text out. */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[BOARD_WIDTH, BOARD_HEIGHT, 0.05]} />
        <meshStandardMaterial color="#211d18" roughness={0.9} />
      </mesh>

      <LabelQuad label={goldLabel} y={0.13} />
      <LabelQuad label={statusLabel} y={-0.11} scale={0.78} />
    </group>
  )
}

function LabelQuad({ label, y, scale = 1 }: { label: Label; y: number; scale?: number }) {
  const height = LINE_HEIGHT * scale
  return (
    <mesh position={[0, y, 0.03]}>
      <planeGeometry args={[height * label.aspect, height]} />
      {/* Unlit and un-tone-mapped: this is UI, and text that dims with the torches is text
          nobody can read at the exact moment they want to check their gold. */}
      <meshBasicMaterial map={label.texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

/**
 * A label texture for a string, disposed when the string changes.
 *
 * No cache: unlike the interaction prompt these strings are unbounded (every gold total is a
 * new one), so keeping them all would be a slow leak across a long session.
 */
function useLabel(text: string, colour: string): Label {
  const label = useMemo(
    () => createLabel(text, { colour, background: 'none', fontSize: 72, padding: 8 }),
    [text, colour],
  )
  useEffect(() => () => label.dispose(), [label])
  return label
}
