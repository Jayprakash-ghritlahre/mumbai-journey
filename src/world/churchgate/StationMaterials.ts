import * as THREE from 'three';
import type { TextureFactory } from '../../gfx/TextureFactory';
import { AmbientVolume, addShaderPatch } from '../../gfx/AmbientVolume';
import {
  ballast,
  coping,
  decalAtlas,
  paintedSteel,
  plaster,
  platformConcrete,
  roofSheet,
  skylightSheet,
  stoneTiles,
  tactileTiles,
  type SurfaceSet,
} from '../../gfx/Surfaces';

function repeatSet(s: SurfaceSet, metres: number): SurfaceSet {
  const out: SurfaceSet = { map: s.map.clone() };
  out.map.repeat.set(1 / metres, 1 / metres);
  out.map.needsUpdate = true;
  if (s.normalMap) {
    out.normalMap = s.normalMap.clone();
    out.normalMap.repeat.set(1 / metres, 1 / metres);
    out.normalMap.needsUpdate = true;
  }
  if (s.roughnessMap) {
    out.roughnessMap = s.roughnessMap.clone();
    out.roughnessMap.repeat.set(1 / metres, 1 / metres);
    out.roughnessMap.needsUpdate = true;
  }
  if (s.emissiveMap) {
    out.emissiveMap = s.emissiveMap.clone();
    out.emissiveMap.repeat.set(1 / metres, 1 / metres);
    out.emissiveMap.needsUpdate = true;
  }
  return out;
}

/** Shared material library for the station, with ambient-volume lighting injected. */
export class StationMaterials {
  readonly m: Record<string, THREE.Material> = {};
  /** Materials whose emissive output follows the lamps (0..1). */
  readonly lampMats: { mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; color: THREE.Color; intensity: number }[] = [];
  /** Skylight materials whose emissive follows daylight. */
  readonly skyMats: THREE.MeshStandardMaterial[] = [];
  private macroTex: THREE.Texture;

  constructor(
    private readonly tf: TextureFactory,
    private readonly av: AmbientVolume,
  ) {
    this.macroTex = tf.tex(tf.noise[0], { srgb: false });
    this.build();
  }

  private std(name: string, params: THREE.MeshStandardMaterialParameters, opts: { macro?: number; macroScale?: number; roof?: boolean } = {}): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial(params);
    mat.name = name;
    this.av.patch(mat, opts.roof ? 'roof' : 'default');
    if (opts.macro) this.macro(mat, opts.macro, opts.macroScale ?? 0.045);
    this.m[name] = mat;
    return mat;
  }

  /** Breaks up visible tiling with low-frequency world-space variation. */
  macro(mat: THREE.Material, strength: number, scale: number): void {
    const tex = this.macroTex;
    addShaderPatch(mat, 'macro', (shader) => {
      shader.uniforms.uMacroTex = { value: tex };
      shader.uniforms.uMacro = { value: new THREE.Vector2(strength, scale) };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uMacroTex;\nuniform vec2 uMacro;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            float mv = texture2D(uMacroTex, vAVPos.xz * uMacro.y).r * 0.6 + texture2D(uMacroTex, vAVPos.xz * uMacro.y * 3.7 + 0.37).r * 0.4;
            diffuseColor.rgb *= mix(1.0, 0.72 + 0.56 * mv, uMacro.x);
          }`,
        );
    });
  }

  private build(): void {
    const tf = this.tf;
    const pc = repeatSet(platformConcrete(tf), 4);
    this.std('concrete', { ...pc, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }, { macro: 0.35 });
    this.std('platformSide', { map: pc.map, normalMap: pc.normalMap, color: 0x6b665e, roughness: 0.95 }, { macro: 0.5 });
    const st = repeatSet(stoneTiles(tf), 2.4);
    this.std('stone', { ...st, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) }, { macro: 0.4 });
    const tt = repeatSet(tactileTiles(tf), 0.6);
    this.std('tactile', { ...tt, roughness: 0.92 }, { macro: 0.4 });
    const cp = coping(tf);
    const cpm = cp.map.clone();
    cpm.repeat.set(1 / 1.2, 1 / 0.6);
    cpm.needsUpdate = true;
    this.std('coping', { map: cpm, roughness: 0.85 }, { macro: 0.35 });
    this.std('yellowLine', { color: 0xd4ae1e, roughness: 0.75 }, { macro: 0.6 });
    const bl = repeatSet(ballast(tf), 2);
    this.std('ballast', { ...bl, roughness: 0.95, normalScale: new THREE.Vector2(1.2, 1.2) }, { macro: 0.5, macroScale: 0.08 });
    this.std('sleeper', { color: 0x8e8b85, roughness: 0.9 }, { macro: 0.5, macroScale: 0.2 });
    this.std('rail', { color: 0x5a4a3e, metalness: 0.55, roughness: 0.6 });
    this.std('railTop', { color: 0xc2beb8, metalness: 1, roughness: 0.22 });
    this.std('railClip', { color: 0x3a3632, metalness: 0.4, roughness: 0.7 });

    const green = repeatSet(paintedSteel(tf, '#a3b3a6', 91), 1);
    this.std('steelGreen', { ...green, roughness: 0.7, metalness: 0.2 });
    this.std('steelTruss', { color: 0xa9b8ab, roughness: 0.72, metalness: 0.15 });
    const yel = repeatSet(paintedSteel(tf, '#c7a33a', 93), 1);
    this.std('steelYellow', { ...yel, roughness: 0.65, metalness: 0.2 });
    this.std('steelGrey', { color: 0x6c6c6a, roughness: 0.6, metalness: 0.5 });

    const rs = repeatSet(roofSheet(tf), 2);
    this.std('roof', { ...rs, roughness: 0.95, side: THREE.DoubleSide }, { roof: true });
    const sk = repeatSet(skylightSheet(tf), 2);
    const skm = this.std('skylight', { map: sk.map, emissiveMap: sk.emissiveMap, emissive: 0xfff4e0, emissiveIntensity: 1, roughness: 0.8, side: THREE.DoubleSide }, { roof: true });
    this.skyMats.push(skm);

    const wall = repeatSet(plaster(tf, '#d8d0bd', 81), 4);
    this.std('wall', { ...wall, roughness: 0.92 }, { macro: 0.35 });
    const wallGrey = repeatSet(plaster(tf, '#b9b4a8', 83), 4);
    this.std('wallGrey', { ...wallGrey, roughness: 0.92 }, { macro: 0.35 });
    const dado = repeatSet(plaster(tf, '#6f7a70', 85), 4);
    this.std('dado', { ...dado, roughness: 0.6 }, { macro: 0.35 });
    const blue = repeatSet(plaster(tf, '#2f63b3', 87), 4);
    this.std('bluePaint', { ...blue, roughness: 0.5 }, { macro: 0.25 });
    const facade = repeatSet(plaster(tf, '#e4e1d8', 89), 4);
    this.std('facade', { ...facade, roughness: 0.9 }, { macro: 0.35 });

    this.std('stainless', { color: 0x9a9c9e, metalness: 0.9, roughness: 0.38 });
    this.std('rod', { color: 0x8f9a91, metalness: 0.3, roughness: 0.6 });
    this.std('darkMetal', { color: 0x2b2b2b, metalness: 0.5, roughness: 0.55 });
    this.std('blackPaint', { color: 0x121212, metalness: 0.2, roughness: 0.6 });
    this.std('whiteEnamel', { color: 0xdedcd6, metalness: 0.3, roughness: 0.4 });
    this.std('bufferRed', { color: 0x4a1a15, roughness: 0.65, metalness: 0.3 });
    this.std('glassDark', { color: 0x1c2226, metalness: 0.6, roughness: 0.15 });
    this.std('louvre', { color: 0x55615a, roughness: 0.7, metalness: 0.2 });
    this.std('wood', { color: 0x6b4a2f, roughness: 0.75 });
    this.std('rubber', { color: 0x1a1a1a, roughness: 0.9 });
    this.std('cable', { color: 0x151515, roughness: 0.7 });
    this.std('copper', { color: 0xb07a50, metalness: 1, roughness: 0.35 });
    this.std('greenBin', { color: 0x2e6b35, roughness: 0.55 });
    this.std('plasticWhite', { color: 0xe6e4df, roughness: 0.5 });
    this.std('shutter', { color: 0x8c8e8a, metalness: 0.6, roughness: 0.5 });
    this.std('redPaint', { color: 0xa12a22, roughness: 0.55 });
    this.std('vertexLit', { vertexColors: true, roughness: 0.8 });

    this.lamp('lampWarm', 0xffe2b8, 7);
    this.lamp('lampTube', 0xeaf4ff, 6);
    this.lamp('lampSodium', 0xffa04a, 7);

    const decals = decalAtlas(tf);
    const dm = this.std('decals', { map: decals, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    dm.alphaTest = 0.02;
  }

  /** Registers an externally created lit material (patched with the ambient volume). */
  add(name: string, mat: THREE.Material, macro = 0): THREE.Material {
    mat.name = name;
    this.av.patch(mat);
    if (macro) this.macro(mat, macro, 0.045);
    this.m[name] = mat;
    return mat;
  }

  private lamp(name: string, color: number, intensity: number): void {
    const c = new THREE.Color(color);
    const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: c.clone(), emissiveIntensity: intensity, roughness: 0.5 });
    mat.name = name;
    this.m[name] = mat;
    this.lampMats.push({ mat, color: c, intensity });
  }

  /** Updates time-of-day driven emissives. */
  update(lamps: number, daylight: THREE.Color, daylightLevel: number): void {
    for (const l of this.lampMats) {
      const m = l.mat as THREE.MeshStandardMaterial;
      m.emissiveIntensity = l.intensity * (0.08 + 0.92 * lamps);
    }
    for (const s of this.skyMats) {
      s.emissive.copy(daylight);
      s.emissiveIntensity = 0.1 + 2.4 * daylightLevel;
    }
  }
}
