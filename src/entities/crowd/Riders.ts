import * as THREE from 'three';
import type { AmbientVolume } from '../../gfx/AmbientVolume';
import { buildHuman, type Variant } from './HumanGeometry';
import { CROWD_ATTRS, createCrowdDepthMaterial, createCrowdMaterial } from './CrowdMaterial';
import type { Look } from './Crowd';

const VARIANTS: Variant[] = ['man', 'woman', 'saree', 'youth', 'girl'];

/**
 * People drawn in a local frame (the car being ridden, a platform far from the origin): the
 * crowd's instanced figures, written each frame by the owner with local positions. The group is
 * placed by the owner, so instance matrices stay small and precise.
 */
export class Riders {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private slots: { mesh: THREE.InstancedMesh; attrs: Record<string, THREE.InstancedBufferAttribute> }[] = [];
  private counts: number[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(av: AmbientVolume, cap: number, opts: { lod?: 0 | 1; shadows?: boolean; patch?: (m: THREE.Material) => void } = {}) {
    this.group.name = 'riders';
    this.material = createCrowdMaterial(av);
    opts.patch?.(this.material);
    const depth = createCrowdDepthMaterial();
    for (const v of VARIANTS) {
      const geo = buildHuman(v, opts.lod ?? 0);
      const attrs: Record<string, THREE.InstancedBufferAttribute> = {};
      for (const [name, size] of CROWD_ATTRS) {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
        a.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute(name, a);
        attrs[name] = a;
      }
      const mesh = new THREE.InstancedMesh(geo, this.material, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = opts.shadows ?? true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depth;
      this.group.add(mesh);
      this.slots.push({ mesh, attrs });
      this.counts.push(0);
    }
  }

  begin(): void {
    this.counts.fill(0);
  }

  /** pose: 0 standing/walking, 1 seated, 2 phone, 3 holding a rail or pole. */
  put(look: Look, x: number, y: number, z: number, heading: number, phase: number, amp: number, pose: number): void {
    const v = look.variant;
    const s = this.slots[v];
    const i = this.counts[v];
    if (i >= s.mesh.instanceMatrix.count) return;
    this.counts[v]++;
    this.q.setFromAxisAngle(this.up, heading);
    this.p.set(x, y, z);
    this.m.compose(this.p, this.q, this.one);
    s.mesh.setMatrixAt(i, this.m);
    const A = s.attrs;
    A.aAnim.setXYZW(i, phase, amp, pose, look.scale);
    A.aTop.setXYZ(i, ...look.top);
    A.aBottom.setXYZ(i, ...look.bottom);
    A.aAccent.setXYZ(i, ...look.accent);
    A.aSkinHair.setXYZW(i, ...look.skin, look.hair);
    A.aFlags.setXYZW(i, ...look.flags);
    A.aMisc.setXYZW(i, ...look.misc);
    A.aStyle.setXYZW(i, ...look.style);
  }

  end(): void {
    this.slots.forEach((s, v) => {
      const n = this.counts[v];
      s.mesh.count = n;
      // Upload only the instances in use (the buffers are sized for the most there can be).
      const upload = (a: THREE.BufferAttribute) => {
        a.clearUpdateRanges();
        if (n > 0) a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      };
      upload(s.mesh.instanceMatrix);
      for (const k in s.attrs) upload(s.attrs[k]);
    });
  }

  get count(): number {
    return this.counts.reduce((a, b) => a + b, 0);
  }
}
