import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

/**
 * Cinematic grade, applied after tone mapping (display space):
 * deep greens, bright clean highlights, shadows lifted just enough to keep detail.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.14 },
    saturation: { value: 1.1 },
    shadowLift: { value: 0.025 },
    greenDepth: { value: 0.4 },
    highlight: { value: 0.15 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float contrast, saturation, shadowLift, greenDepth, highlight;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // keep detail in the darks: lift only the deepest tones a little
      c += shadowLift * (1.0 - smoothstep(0.0, 0.35, l));
      // gentle S-curve around mid grey
      c = (c - 0.5) * contrast + 0.5;
      // saturation
      l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      // deep, rich greens in the mids (less yellow, a touch darker), highlights untouched
      float green = clamp(c.g - max(c.r, c.b), 0.0, 1.0) * (1.0 - smoothstep(0.55, 0.95, l));
      c = mix(c, c * vec3(0.78, 0.97, 0.80), green * greenDepth);
      // clean, slightly brighter highlights
      c = mix(c, vec3(1.0), smoothstep(0.78, 1.0, l) * highlight);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }`,
};

/**
 * Soft volumetric light shafts from stage lights above (screen space, additive), a faint
 * low haze, and cold "fridge" vapour curling up from the bottom corners.
 * Subtle on purpose: it must not hurt readability.
 */
const ShaftShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    aspect: { value: 0.56 },
    intensity: { value: 0.22 },
    haze: { value: 0.04 },
    vapor: { value: 0.42 },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time, aspect, intensity, haze, vapor;
    varying vec2 vUv;
    // value noise + fbm for the cold vapour
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
      return v;
    }
    /** Ice vapour pooling in a bottom corner and curling upward. side = -1 left, +1 right. */
    float vapourAt(vec2 uv, float side) {
      vec2 p = vec2(uv.x * aspect, uv.y);
      float cx = side < 0.0 ? 0.0 : aspect;
      float dx = abs(p.x - cx);
      // corner mask: strongest at the very corner, fading up and inward
      float mask = (1.0 - smoothstep(0.0, 0.5 * aspect + 0.12, dx)) * (1.0 - smoothstep(0.0, 0.36, uv.y));
      // rising, sideways-drifting turbulence
      vec2 q = vec2(p.x * 3.0 + side * time * 0.05, p.y * 3.2 - time * 0.12);
      float n = fbm(q + fbm(q * 0.7 + time * 0.03));
      return mask * smoothstep(0.42, 0.9, n); // wispy, not a solid bank
    }
    float beam(vec2 uv, vec2 origin, vec2 dir, float width, float phase) {
      vec2 d = uv - origin; d.x *= aspect;
      vec2 n = normalize(vec2(dir.x * aspect, dir.y));
      float along = dot(d, n);
      if (along <= 0.0) return 0.0;
      float across = length(d - n * along);
      float w = width * (0.25 + along);                      // cone widens with distance
      float b = exp(-(across * across) / (w * w));
      b *= smoothstep(0.0, 0.12, along) * exp(-along * 1.5); // fade in at the source, out with length
      b *= 0.82 + 0.18 * sin(time * 0.6 + phase + along * 3.0); // slow breathing
      return b;
    }
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      float s = 0.0;
      s += beam(vUv, vec2(0.10, 1.06), vec2(0.30, -1.0), 0.10, 0.0);
      s += beam(vUv, vec2(0.62, 1.08), vec2(-0.12, -1.0), 0.08, 2.1) * 0.8;
      s += beam(vUv, vec2(0.95, 1.04), vec2(-0.38, -1.0), 0.11, 4.2);
      vec3 col = tex.rgb + vec3(0.72, 1.0, 0.78) * s * intensity;
      // low haze, drifting
      float h = (1.0 - smoothstep(0.0, 0.32, vUv.y)) * (0.6 + 0.4 * sin(vUv.x * 7.0 + time * 0.25));
      col += vec3(0.62, 0.86, 0.72) * h * haze;
      // cold ice vapour, bottom-left and bottom-right (screen blend keeps it soft/transparent)
      float v = (vapourAt(vUv, -1.0) + vapourAt(vUv, 1.0)) * vapor;
      vec3 vc = vec3(0.86, 0.96, 0.93);
      col = 1.0 - (1.0 - col) * (1.0 - vc * clamp(v, 0.0, 0.85));
      gl_FragColor = vec4(min(col, 1.0), tex.a);
    }`,
};

/** Very soft vignette (darkens only the far corners). */
const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.32 }, aspect: { value: 0.56 } },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float strength, aspect;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5; d.x *= aspect;
      float v = smoothstep(0.38, 0.85, length(d) * 1.25);
      gl_FragColor = vec4(tex.rgb * (1.0 - v * strength), tex.a);
    }`,
};

/**
 * Post-processing for the game view, tuned to the key visual:
 *   scene → ambient occlusion → light depth of field (focus on the can) → controlled green
 *   bloom (neon and bright lights only) → tone mapping → colour grade → volumetric light
 *   shafts → soft vignette → overlay (brand logo, exact colours, sharp) → SMAA.
 * Quality 'low' (touch devices) skips AO and DOF to stay smooth on phones.
 */
export class PostFX {
  constructor(renderer, scene, overlay, camera, { quality = 'high' } = {}) {
    this.renderer = renderer;
    this.camera = camera;
    this.quality = quality;
    const high = quality === 'high';
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    if (high) {
      this.gtao = new GTAOPass(scene, camera, 512, 512);
      this.gtao.blendIntensity = 0.9;
      this.gtao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.4, thickness: 2.5, scale: 1.8, samples: 12 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.gtao);

      // Light DOF: the can's plane stays sharp; the backdrop and far objects soften.
      this.dof = new BokehPass(scene, camera, { focus: 12, aperture: 0.0011, maxblur: 0.0055 });
      this.composer.addPass(this.dof);
    }

    // Controlled green bloom: shelf neon (HDR ~2.0) and side-wall neon (~2.2) glow evenly;
    // white tiles, cans and text stay below it. Low strength + wide radius = gentle halo.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.55, 1.3);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass()); // tone mapping + sRGB

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.shafts = new ShaderPass(ShaftShader);
    this.composer.addPass(this.shafts);
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);

    // Brand artwork and collectible stars last (display space, no tone mapping/grade/blur/
    // bloom) so their colours stay exact.
    const overlayPass = new RenderPass(overlay, camera);
    overlayPass.clear = false;
    overlayPass.clearDepth = true; // overlay objects only depth-test against each other
    this.composer.addPass(overlayPass);
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);
    this._time = 0;
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    const aspect = w / h;
    this.shafts.uniforms.aspect.value = aspect;
    this.vignette.uniforms.aspect.value = aspect;
  }

  /** Keep the depth-of-field focal plane on the can. */
  setFocusDistance(d) {
    if (this.dof) this.dof.uniforms.focus.value = d;
  }

  render(dt = 1 / 60) {
    this._time += dt;
    this.shafts.uniforms.time.value = this._time;
    this.composer.render(dt);
  }
}
