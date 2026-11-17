import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PostFX } from './PostFX.js';

/**
 * Renderer, camera, lights, soft shadows, backdrop and fog. Post-processing lives in PostFX.
 */
export class SceneManager {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping; // keeps brand reds and greens true (ACES shifts red to orange)
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = settings.get('graphics').shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Drawn after ambient occlusion so flat artwork (the brand logo) is not darkened by it.
    this.overlay = new THREE.Scene();
    // Simple key/fill light for the lit things drawn in the overlay (collectible stars).
    const ovKey = new THREE.DirectionalLight(0xffffff, 2.4);
    ovKey.position.set(3, 6, 10);
    this.overlay.add(new THREE.HemisphereLight(0xffffff, 0x7a9a7a, 2.6), ovKey);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);

    // Soft studio reflections for the glossy tiles, glass shelves and the metal can.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    // Lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x5f9f6a, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    const sc = this.sun.shadow.camera;
    sc.left = -12; sc.right = 12; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 60;
    this.scene.add(this.sun, this.sun.target);
    this._sunOffset = new THREE.Vector3(5, 9, 14);

    // Sky gradient canvas (screen-space background)
    this._skyCanvas = document.createElement('canvas');
    this._skyCanvas.width = 4;
    this._skyCanvas.height = 256;
    this.skyTex = new THREE.CanvasTexture(this._skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.skyTex;
    this.scene.fog = new THREE.Fog(0xffffff, 30, 95);

    this._initPost();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    // The canvas lives in the game box, which is shown/hidden and sized by CSS.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(this._onResize).observe(container);
    this.resize();
  }

  /** Post-processing (see PostFX). Phones get the lighter 'low' chain. */
  _initPost() {
    this.post = this.settings.get('graphics').ambientOcclusion !== false;
    if (!this.post) return;
    const touch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 1);
    this.postfx = new PostFX(this.renderer, this.scene, this.overlay, this.camera, { quality: touch ? 'low' : 'high' });
  }

  setTheme(theme) {
    const g = this._skyCanvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, theme.skyTop);
    grad.addColorStop(1, theme.skyBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    this.skyTex.needsUpdate = true; // fallback until the backdrop image has loaded
    this.scene.fog.color.set(theme.fog);
    this.hemi.groundColor.set(theme.fog);
  }

  /**
   * Full-screen stage backdrop behind the tower (stage lights + haze image).
   * Scaled like CSS `background-size: cover`, so it never stretches in portrait.
   */
  setBackdrop(url) {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      this.backdrop = tex;
      this.scene.background = tex;
      this._coverBackdrop();
    });
  }

  _coverBackdrop() {
    const tex = this.backdrop;
    if (!tex?.image) return;
    const img = tex.image.width / tex.image.height;
    const view = this.camera.aspect;
    if (view < img) {
      tex.repeat.set(view / img, 1);
    } else {
      tex.repeat.set(1, img / view);
    }
    tex.offset.set((1 - tex.repeat.x) / 2, (1 - tex.repeat.y) / 2);
  }

  /** Keep the shadow-casting light centred on the action. */
  setFocus(p) {
    this.sun.position.copy(p).add(this._sunOffset);
    this.sun.target.position.copy(p);
    this.postfx?.setFocusDistance(this.camera.position.distanceTo(p));
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return; // box hidden: keep the last size
    const cap = this.settings.get('graphics').pixelRatioCap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.setSize(w, h, false);
    // Post chain at most at 1.5× pixel ratio (AO/DOF/bloom are fill-rate heavy).
    this.postfx?.setSize(w, h, Math.min(window.devicePixelRatio || 1, 1.5));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix(); // fov per screen shape is set by CameraController
    this._coverBackdrop();
  }

  render() {
    if (this.postfx) this.postfx.render();
    else {
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.render(this.overlay, this.camera);
      this.renderer.autoClear = true;
    }
  }
}
