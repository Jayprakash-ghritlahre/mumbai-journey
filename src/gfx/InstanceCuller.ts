import * as THREE from 'three';

/**
 * CPU frustum + distance culling for large static InstancedMeshes (sleepers, trees…).
 * Keeps the full matrix list and writes only the visible ones into the mesh each time
 * the camera moves enough. Nearby instances are always kept so their shadows persist.
 */
export class InstanceCuller {
  private readonly all: THREE.Matrix4[];
  private readonly centres: THREE.Vector3[];
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly lastPos = new THREE.Vector3(1e9, 0, 0);
  private readonly lastQuat = new THREE.Quaternion();
  private readonly sphere = new THREE.Sphere();

  constructor(
    private readonly meshes: THREE.InstancedMesh[],
    matrices: THREE.Matrix4[],
    private readonly radius: number,
    private readonly maxDistance: number,
    private readonly keepNear = 30,
  ) {
    this.all = matrices;
    this.centres = matrices.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
    for (const mesh of meshes) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
  }

  update(camera: THREE.PerspectiveCamera, force = false): void {
    const moved = camera.position.distanceToSquared(this.lastPos) > 0.25 || 1 - Math.abs(camera.quaternion.dot(this.lastQuat)) > 0.0004;
    if (!moved && !force) return;
    this.lastPos.copy(camera.position);
    this.lastQuat.copy(camera.quaternion);
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const max2 = this.maxDistance * this.maxDistance;
    const near2 = this.keepNear * this.keepNear;
    let n = 0;
    for (let i = 0; i < this.all.length; i++) {
      const c = this.centres[i];
      const d2 = c.distanceToSquared(camera.position);
      if (d2 > max2) continue;
      if (d2 > near2) {
        this.sphere.set(c, this.radius);
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
      }
      for (const mesh of this.meshes) mesh.setMatrixAt(n, this.all[i]);
      n++;
    }
    for (const mesh of this.meshes) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
