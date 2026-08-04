/**
 * Writes a throwaway rigged, animated GLB.
 *
 *     node scripts/makeModelFixture.mjs public/models/skeleton-warrior.glb
 *
 * Sprint 2.7 built the model path against a CC0 pack that is deliberately not in this
 * repository, which left about two hundred lines — cloning, the skeleton, the mixer, the clip
 * plan, the material injection — that nothing could exercise. This is what exercises them: a
 * two-bone skinned box carrying the four clips a Quaternius character ships with (`Idle`,
 * `Walk`, `Attack`, `Death`), so the whole chain from fetch to a body that leans, walks, flashes
 * white and dissolves can be run without downloading anything.
 *
 * It is not art and it is not a fallback — the fallback is the primitive body, which is better
 * looking than this. Write it, look at it, delete it. `public/models/*.glb` is gitignored, so
 * there is nothing to clean up but the file itself.
 */
import { writeFileSync } from 'node:fs'
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  MeshStandardMaterial,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

const out = process.argv[2]
if (!out) throw new Error('usage: node scripts/makeModelFixture.mjs <path-to.glb>')

// `GLTFExporter` reaches for the browser's `FileReader` to turn its `Blob` into bytes, and node
// has `Blob` but not `FileReader`. Two methods is the whole of what it uses.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer
        this.onloadend?.()
      })
    }
  }
}

// A 2m box on two bones, so the export is a genuine skinned mesh with a skeleton.
const geometry = new BoxGeometry(0.6, 2, 0.4, 1, 4, 1)
const position = geometry.attributes.position
const indices = []
const weights = []
for (let i = 0; i < position.count; i += 1) {
  const y = position.getY(i)
  const upper = y > 0
  indices.push(upper ? 1 : 0, 0, 0, 0)
  weights.push(1, 0, 0, 0)
}
geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4))
geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))

const root = new Bone()
root.name = 'Root'
const upper = new Bone()
upper.name = 'Upper'
upper.position.y = 1
root.add(upper)

const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ color: '#c8c8c8' }))
mesh.name = 'Body'
const skeleton = new Skeleton([root, upper])
mesh.add(root)
mesh.bind(skeleton)

const scene = new Group()
scene.name = 'Scene'
scene.add(mesh)

// Four clips, named the way a Quaternius character names them.
const clips = ['Idle', 'Walk', 'Attack', 'Death'].map((name, i) => {
  const amount = 0.1 + i * 0.15
  return new AnimationClip(name, 1 + i * 0.5, [
    new QuaternionKeyframeTrack(
      `${upper.name}.quaternion`,
      [0, 0.5 + i * 0.25, 1 + i * 0.5],
      [0, 0, 0, 1, Math.sin(amount), 0, 0, Math.cos(amount), 0, 0, 0, 1],
    ),
  ])
})

new GLTFExporter().parse(
  scene,
  (result) => {
    writeFileSync(out, Buffer.from(result))
    console.log(`wrote ${out}`)
  },
  (error) => {
    console.error('export failed', error)
    process.exit(1)
  },
  { binary: true, animations: clips },
)
