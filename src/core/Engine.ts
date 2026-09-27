import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { FogEffect, GradeEffect } from '../gfx/PostEffects';
import { VolumetricPass } from '../gfx/VolumetricLight';
import { SkyDome } from '../gfx/SkyDome';
import { computeLighting, type LightingState } from '../gfx/TimeOfDay';

export type Quality = 'low' | 'medium' | 'high';

interface QualitySettings {
  maxPixelRatio: number;
  minPixelRatio: number;
  shadowSize: number;
  shadowExtent: number;
  msaa: number;
  smaa: boolean;
  ao: boolean;
  aoHalfRes: boolean;
  crowdScale: number;
  volumetric: boolean;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: { maxPixelRatio: 0.8, minPixelRatio: 0.5, shadowSize: 1024, shadowExtent: 60, msaa: 0, smaa: false, ao: false, aoHalfRes: true, crowdScale: 0.45, volumetric: false },
  medium: { maxPixelRatio: 1.0, minPixelRatio: 0.6, shadowSize: 2048, shadowExtent: 80, msaa: 0, smaa: true, ao: new URLSearchParams(location.search).get('ao') !== '0', aoHalfRes: true, crowdScale: 0.75, volumetric: true },
  high: { maxPixelRatio: 1.5, minPixelRatio: 0.7, shadowSize: 4096, shadowExtent: 100, msaa: 4, smaa: false, ao: true, aoHalfRes: true, crowdScale: 1, volumetric: true },
};

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly sky = new SkyDome();
  readonly lighting: LightingState;
  readonly stats: FrameStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, pixelRatio: 1 };

  quality: Quality;
  settings: QualitySettings;
  /** Multiplier for interior spaces (simple eye adaptation driven by the world). */
  exposureBias = 1;
  /** 0 when the camera is under a roof (the analytic sun glow is suppressed; shafts take over). */
  sunVisibleFromCamera = 1;
  /** How enclosed the camera is (0 street … 1 inside the train shed): dusty air indoors. */
  interior = 0;
  private exposureSmoothed = 1;

  private composer!: EffectComposer;
  private fog!: FogEffect;
  private grade!: GradeEffect;
  private toneMapping!: ToneMappingEffect;
  private bloom!: BloomEffect;
  aoPass: N8AOPostPass | null = null;
  private volumetric: VolumetricPass | null = null;
  /** Ambient-volume texture (sky visibility) used where rays leave the shadow frustum. */
  avSource: { map: THREE.Texture | null; bounds: THREE.Vector4 } | null = null;
  private readonly pmrem: THREE.PMREMGenerator;
  private pixelRatio = 1;
  private frameTimes: number[] = [];
  private lastAdjust = 0;
  private envDirty = true;
  private readonly container: HTMLElement;
  readonly dynamicResolution = { enabled: true };
  fade = 1;

  constructor(container: HTMLElement, quality: Quality) {
    this.container = container;
    this.quality = quality;
    this.settings = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('gl');

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.2, 16000);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.sky.mesh);

    this.lighting = computeLighting(17.85);
    this.buildPipeline();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildPipeline(): void {
    const q = this.settings;
    this.composer?.dispose();
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: Math.min(q.msaa, this.renderer.capabilities.maxSamples),
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.volumetric = null;
    if (q.volumetric) {
      this.volumetric = new VolumetricPass();
      this.composer.addPass(this.volumetric);
    }
    this.aoPass = null;
    if (q.ao) {
      const ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = q.aoHalfRes;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.gammaCorrection = false;
      ao.setQualityMode('Low');
      this.composer.addPass(ao);
      this.aoPass = ao;
    }
    this.fog = new FogEffect();
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.1, luminanceSmoothing: 0.35, intensity: 0.55, radius: 0.72 });
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.composer.addPass(new EffectPass(this.camera, this.fog, this.bloom, this.toneMapping, this.grade));
    if (q.smaa && q.msaa === 0) this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));

    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    const cam = this.sun.shadow.camera;
    cam.left = -q.shadowExtent / 2;
    cam.right = q.shadowExtent / 2;
    cam.top = q.shadowExtent / 2;
    cam.bottom = -q.shadowExtent / 2;
    cam.near = 1;
    cam.far = 900;
    cam.updateProjectionMatrix();
  }

  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.settings = QUALITY[quality];
    this.pixelRatio = Math.min(this.settings.maxPixelRatio, window.devicePixelRatio || 1);
    this.buildPipeline();
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (!this.pixelRatio || this.pixelRatio > this.settings.maxPixelRatio) this.pixelRatio = Math.min(this.settings.maxPixelRatio, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.stats.pixelRatio = this.pixelRatio;
  }

  setHour(hour: number): void {
    computeLighting(hour, this.lighting.cloudCover, this.lighting);
    this.envDirty = true;
  }

  /**
   * Compiles every visible material for the render state the post chain actually uses (the
   * composer's HDR input buffer), so nothing compiles mid-film when hidden parts appear.
   */
  precompile(): void {
    const rt = (this.composer as unknown as { inputBuffer: THREE.WebGLRenderTarget }).inputBuffer;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt ?? null);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
  }

  /** Pushes lighting state into lights, sky, fog and grade. */
  private applyLighting(time: number): void {
    const s = this.lighting;
    this.sky.update(s, time);
    if (this.envDirty) {
      this.scene.environment = this.sky.buildEnvironment(this.pmrem);
      this.envDirty = false;
    }
    this.scene.environmentIntensity = s.envIntensity;
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunIntensity;
    this.sun.castShadow = s.sunIntensity > 0.1;

    const f = this.fog;
    f.u<THREE.Color>('uFogColor').value.copy(s.fogColor);
    f.u<THREE.Color>('uSunColor').value.copy(s.sunColor).multiplyScalar(Math.min(1, s.sunIntensity / 2.5));
    f.u<THREE.Vector3>('uSunDir').value.copy(s.sunDir);
    f.u<number>('uDensity').value = s.fogDensity;
    f.u<number>('uSunScatter').value = s.hazeGlow * this.sunVisibleFromCamera;
    // Shafts are strongest with a low sun in hazy air.
    const low = 1 - THREE.MathUtils.smoothstep(s.sunElevation, 8, 45);
    // Outdoors: humid air scatters mostly forwards (a glow towards the sun, shafts through trees).
    // Indoors: dust makes the shafts visible from every angle.
    const ind = this.interior;
    f.u<number>('uVolStrength').value = this.volumetric ? (0.0009 + 0.0026 * low) * (0.3 + 0.7 * ind) * Math.min(1, s.sunIntensity / 1.5) : 0;
    f.u<number>('uVolG').value = THREE.MathUtils.lerp(0.72, 0.45, ind);
    f.u<number>('uVolIso').value = THREE.MathUtils.lerp(0.1, 0.35, ind);
    f.u<number>('uSunDirect').value = 1;

    const g = this.grade;
    g.u<THREE.Color>('uLift').value.copy(s.grade.lift);
    g.u<THREE.Color>('uGain').value.copy(s.grade.gain);
    g.u<number>('uSaturation').value = s.grade.saturation;
    g.u<number>('uContrast').value = s.grade.contrast;
    g.u<number>('uFade').value = this.fade;
  }

  setLocalHaze(amount: number, color: THREE.Color): void {
    this.fog.u<number>('uLocalHaze').value = amount;
    this.fog.u<THREE.Color>('uLocalHazeColor').value.copy(color);
  }

  setVignette(v: number): void {
    this.grade.u<number>('uVignette').value = v;
  }

  /** Keeps a crisp shadow map centred where the camera is looking. */
  private updateShadowFrustum(): void {
    const q = this.settings;
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const focus = cam.position.clone().addScaledVector(dir, q.shadowExtent * 0.3);
    focus.y = Math.min(cam.position.y, 2);

    const lightDir = this.lighting.sunDir.clone();
    if (lightDir.y < 0.05) lightDir.y = 0.05;
    lightDir.normalize();
    // Snap the focus to shadow texels to avoid shimmering.
    const texel = q.shadowExtent / q.shadowSize;
    const lookAt = new THREE.Matrix4().lookAt(new THREE.Vector3(), lightDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lookAt.clone().invert();
    focus.applyMatrix4(inv);
    focus.x = Math.round(focus.x / texel) * texel;
    focus.y = Math.round(focus.y / texel) * texel;
    focus.applyMatrix4(lookAt);

    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(lightDir, 450);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  private pendingResize = false;

  render(dt: number, time: number): void {
    if (this.pendingResize) {
      this.pendingResize = false;
      this.resize();
    }
    this.applyLighting(time);
    this.sky.follow(this.camera);
    this.updateShadowFrustum();
    this.camera.updateMatrixWorld();
    this.fog.setCamera(this.camera);
    if (this.volumetric) {
      this.volumetric.setInputs(this.camera, this.sun, this.avSource, this.lighting.sunIntensity > 0.05);
      this.fog.u<THREE.Texture>('uVolTex').value = this.volumetric.target.texture;
      this.fog.u<THREE.Vector2>('uVolTexel').value.set(1 / this.volumetric.target.width, 1 / this.volumetric.target.height);
    }

    // Smooth exposure adaptation.
    const target = this.lighting.exposure * this.exposureBias;
    const k = 1 - Math.exp(-dt * 1.6);
    this.exposureSmoothed += (target - this.exposureSmoothed) * k;
    this.renderer.toneMappingExposure = 1;
    this.fog.u<number>('uExposure').value = this.exposureSmoothed;
    this.bloom.intensity = 0.55 * this.exposureSmoothed;

    this.renderer.info.reset();
    this.composer.render(dt);
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.trackFrameTime(dt);
  }

  private trackFrameTime(dt: number): void {
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.stats.frameMs = avg;
    this.stats.fps = 1000 / avg;
    const now = performance.now();
    if (!this.dynamicResolution.enabled || now - this.lastAdjust < 1500 || this.frameTimes.length < 60) return;
    const q = this.settings;
    let pr = this.pixelRatio;
    if (avg > 24 && pr > q.minPixelRatio) pr = Math.max(q.minPixelRatio, pr - 0.1);
    else if (avg < 14 && pr < Math.min(q.maxPixelRatio, window.devicePixelRatio || 1)) pr = Math.min(q.maxPixelRatio, pr + 0.05);
    if (pr !== this.pixelRatio) {
      this.pixelRatio = pr;
      this.lastAdjust = now;
      this.frameTimes.length = 0;
      // Resizing clears the canvas: do it right before the next frame is drawn, not after this one.
      this.pendingResize = true;
    }
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }
}
