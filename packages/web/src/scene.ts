/**
 * 3D lunar scene using Three.js.
 *
 * Provides two interconnected view modes:
 * 1. Overview Mode: Moon-centered view with Sun and Earth context at compressed distances,
 *    sub-solar terminator shadow, selenographic grid lines, and landing site pin.
 * 2. Site-Level Surface Mode: Local horizon view from the landing site looking out across
 *    the lunar terrain, with ground disc, 360° compass rose (N, E, S, W), 0° horizon line,
 *    3D LOLA terrain silhouette profile, and Sun and Earth positioned at exact AZ-EL.
 *
 * Implements smooth OrbitControls navigation, camera presets, touch support, and keyboard controls.
 */

import * as THREE from "three";
import type { HorizonMask, LunarSite, SkyState } from "core";

/* ── Constants ── */

const MOON_RADIUS_KM = 1737.4;
const EARTH_RADIUS_KM = 6371;
const SUN_RADIUS_KM = 696_340;
const MOON_EARTH_DISTANCE_KM = 384_400;
const SUN_DISTANCE_KM = 149_600_000;

// Overview scale: 1 unit = 1000 km
const OVERVIEW_SCALE = 0.001;
const MOON_SCENE_RADIUS = MOON_RADIUS_KM * OVERVIEW_SCALE; // ~1.7374 units
const MIN_OVERVIEW_CAMERA_RADIUS = 3.5; // Avoid magnifying the 2K base map beyond its useful detail.
const SITE_FOCUS_CAMERA_RADIUS = 4.5;

const MOON_TEXTURE_URL = "/textures/moon.jpg";
const EARTH_TEXTURE_URL = "/textures/earth.png";

/** Load Moon texture with procedural fallback. */
function loadMoonTexture(): Promise<THREE.Texture> {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      MOON_TEXTURE_URL,
      (texture) => {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 16;
        resolve(texture);
      },
      undefined,
      () => {
        resolve(createProceduralMoonTexture());
      },
    );
  });
}

function createProceduralMoonTexture(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext("2d")!;

  // Base regolith color
  ctx.fillStyle = "#8a8a8a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Seeded random for reproducibility
  let seed = 42;
  function seededRandom() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  // Draw maria (dark basalt plains) — larger dark patches
  const maria = [
    { x: 0.15, y: 0.35, rx: 0.12, ry: 0.08 }, // Mare Imbrium
    { x: 0.25, y: 0.45, rx: 0.08, ry: 0.1 },  // Mare Serenitatis
    { x: 0.35, y: 0.38, rx: 0.1, ry: 0.07 },  // Mare Nectaris
    { x: 0.55, y: 0.42, rx: 0.15, ry: 0.12 }, // Mare Tranquillitatis
    { x: 0.65, y: 0.35, rx: 0.09, ry: 0.09 }, // Mare Crisium
    { x: 0.45, y: 0.5, rx: 0.07, ry: 0.06 },  // Mare Fecunditatis
    { x: 0.75, y: 0.45, rx: 0.11, ry: 0.08 }, // Mare Humorum
    { x: 0.1, y: 0.4, rx: 0.06, ry: 0.05 },   // Mare Frigoris (partial)
  ];
  for (const m of maria) {
    const grad = ctx.createRadialGradient(
      m.x * canvas.width, m.y * canvas.height, 0,
      m.x * canvas.width, m.y * canvas.height, Math.max(m.rx, m.ry) * canvas.width,
    );
    grad.addColorStop(0, "rgba(60, 58, 55, 0.7)");
    grad.addColorStop(0.6, "rgba(70, 68, 65, 0.4)");
    grad.addColorStop(1, "rgba(80, 78, 75, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(m.x * canvas.width, m.y * canvas.height, m.rx * canvas.width, m.ry * canvas.height, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw craters of various sizes (scaled for 1024×512 resolution)
  const craters: { x: number; y: number; r: number }[] = [];
  // Large craters
  for (let i = 0; i < 20; i++) {
    craters.push({
      x: seededRandom() * canvas.width,
      y: seededRandom() * canvas.height,
      r: 15 + seededRandom() * 35,
    });
  }
  // Medium craters
  for (let i = 0; i < 60; i++) {
    craters.push({
      x: seededRandom() * canvas.width,
      y: seededRandom() * canvas.height,
      r: 5 + seededRandom() * 15,
    });
  }
  // Small craters
  for (let i = 0; i < 120; i++) {
    craters.push({
      x: seededRandom() * canvas.width,
      y: seededRandom() * canvas.height,
      r: 1.5 + seededRandom() * 5,
    });
  }

  for (const c of craters) {
    // Crater floor (darker)
    const floorGrad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r * 0.7);
    floorGrad.addColorStop(0, "rgba(90, 88, 85, 0.5)");
    floorGrad.addColorStop(1, "rgba(100, 98, 95, 0)");
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r * 0.7, 0, Math.PI * 2);
    ctx.fill();

    // Crater rim (lighter highlight on one side, shadow on other)
    ctx.strokeStyle = "rgba(170, 168, 165, 0.4)";
    ctx.lineWidth = Math.max(1, c.r * 0.15);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.stroke();

    // Rim shadow (bottom-right)
    ctx.strokeStyle = "rgba(50, 48, 45, 0.3)";
    ctx.lineWidth = Math.max(1, c.r * 0.1);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r * 1.02, 0.2 * Math.PI, 1.2 * Math.PI);
    ctx.stroke();

    // Rim highlight (top-left)
    ctx.strokeStyle = "rgba(190, 188, 185, 0.3)";
    ctx.lineWidth = Math.max(1, c.r * 0.08);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r * 1.02, 1.3 * Math.PI, 2.3 * Math.PI);
    ctx.stroke();

    // Central peak for larger craters
    if (c.r > 20) {
      ctx.fillStyle = "rgba(160, 158, 155, 0.5)";
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Fine noise texture for regolith detail
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  function noise2D(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const n = noise2D(x * 0.05, y * 0.05) * 20 - 10;
      const fine = noise2D(x * 0.3, y * 0.3) * 8 - 4;
      const val = n + fine;
      data[i] = Math.max(0, Math.min(255, data[i] + val));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + val));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + val));
    }
  }
  ctx.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 16;
  return texture;
}

/** Load Earth texture with procedural fallback. */
function loadEarthTexture(): Promise<THREE.Texture> {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      EARTH_TEXTURE_URL,
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        resolve(texture);
      },
      undefined,
      () => {
        resolve(createProceduralEarthTexture());
      },
    );
  });
}

function createProceduralEarthTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext("2d")!;

  // Seeded random
  let seed = 123;
  function seededRandom() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  // Deep ocean base
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  oceanGrad.addColorStop(0, "#1a3a5c");
  oceanGrad.addColorStop(0.3, "#1a5090");
  oceanGrad.addColorStop(0.5, "#1a5a9a");
  oceanGrad.addColorStop(0.7, "#1a5090");
  oceanGrad.addColorStop(1, "#1a3a5c");
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Ice caps at poles
  const northIce = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.12);
  northIce.addColorStop(0, "rgba(240, 245, 255, 0.95)");
  northIce.addColorStop(0.5, "rgba(220, 230, 245, 0.6)");
  northIce.addColorStop(1, "rgba(200, 220, 240, 0)");
  ctx.fillStyle = northIce;
  ctx.fillRect(0, 0, canvas.width, canvas.height * 0.12);

  const southIce = ctx.createLinearGradient(0, canvas.height * 0.88, 0, canvas.height);
  southIce.addColorStop(0, "rgba(200, 220, 240, 0)");
  southIce.addColorStop(0.5, "rgba(220, 230, 245, 0.6)");
  southIce.addColorStop(1, "rgba(240, 245, 255, 0.95)");
  ctx.fillStyle = southIce;
  ctx.fillRect(0, canvas.height * 0.88, canvas.width, canvas.height * 0.12);

  // Continents with more realistic shapes using multiple overlapping ellipses
  const continentColor = "#3a7a3a";
  const desertColor = "#8a7a4a";
  const highlandColor = "#5a6a4a";

  type LandMass = { x: number; y: number; rx: number; ry: number; color: string; rotation: number };
  const landMasses: LandMass[] = [
    // North America
    { x: 0.18, y: 0.28, rx: 0.08, ry: 0.1, color: continentColor, rotation: -0.2 },
    { x: 0.15, y: 0.22, rx: 0.06, ry: 0.06, color: continentColor, rotation: 0.1 },
    { x: 0.22, y: 0.35, rx: 0.03, ry: 0.05, color: continentColor, rotation: 0.3 },
    // South America
    { x: 0.25, y: 0.55, rx: 0.04, ry: 0.12, color: continentColor, rotation: 0.15 },
    { x: 0.24, y: 0.48, rx: 0.05, ry: 0.04, color: continentColor, rotation: -0.1 },
    { x: 0.26, y: 0.65, rx: 0.03, ry: 0.06, color: continentColor, rotation: -0.1 },
    // Europe
    { x: 0.48, y: 0.25, rx: 0.04, ry: 0.05, color: continentColor, rotation: 0.2 },
    { x: 0.5, y: 0.22, rx: 0.03, ry: 0.03, color: continentColor, rotation: 0 },
    // Africa
    { x: 0.5, y: 0.45, rx: 0.06, ry: 0.12, color: continentColor, rotation: 0 },
    { x: 0.48, y: 0.38, rx: 0.05, ry: 0.04, color: desertColor, rotation: 0.1 },
    { x: 0.52, y: 0.55, rx: 0.04, ry: 0.06, color: continentColor, rotation: -0.1 },
    // Asia
    { x: 0.65, y: 0.25, rx: 0.12, ry: 0.08, color: continentColor, rotation: 0.1 },
    { x: 0.72, y: 0.22, rx: 0.08, ry: 0.06, color: continentColor, rotation: -0.1 },
    { x: 0.6, y: 0.3, rx: 0.05, ry: 0.04, color: highlandColor, rotation: 0.2 },
    { x: 0.75, y: 0.35, rx: 0.04, ry: 0.05, color: continentColor, rotation: 0.3 },
    // India
    { x: 0.68, y: 0.42, rx: 0.03, ry: 0.05, color: continentColor, rotation: 0 },
    // Southeast Asia / Indonesia
    { x: 0.78, y: 0.45, rx: 0.04, ry: 0.02, color: continentColor, rotation: 0.2 },
    { x: 0.8, y: 0.48, rx: 0.02, ry: 0.015, color: continentColor, rotation: 0.1 },
    // Australia
    { x: 0.85, y: 0.6, rx: 0.05, ry: 0.04, color: desertColor, rotation: -0.1 },
    { x: 0.84, y: 0.58, rx: 0.03, ry: 0.02, color: continentColor, rotation: 0 },
    // Antarctica hint
    { x: 0.5, y: 0.85, rx: 0.15, ry: 0.03, color: "#d0d8e8", rotation: 0 },
  ];

  for (const land of landMasses) {
    ctx.save();
    ctx.translate(land.x * canvas.width, land.y * canvas.height);
    ctx.rotate(land.rotation);
    ctx.fillStyle = land.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, land.rx * canvas.width, land.ry * canvas.height, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Add terrain noise to continents
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  function noise2D(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      // Only add noise to non-ocean pixels (green channel > blue channel indicates land)
      if (data[i + 1] > data[i + 2] * 0.8) {
        const n = noise2D(x * 0.08, y * 0.08) * 15 - 7;
        const fine = noise2D(x * 0.4, y * 0.4) * 6 - 3;
        data[i] = Math.max(0, Math.min(255, data[i] + n + fine));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n + fine));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n * 0.5));
      } else {
        // Subtle ocean variation
        const n = noise2D(x * 0.03, y * 0.03) * 8 - 4;
        data[i] = Math.max(0, Math.min(255, data[i] + n * 0.5));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n * 0.3));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // Cloud layer — soft white wisps (fewer for performance)
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 25; i++) {
    const x = seededRandom() * canvas.width;
    const y = seededRandom() * canvas.height;
    const rx = 15 + seededRandom() * 50;
    const ry = 8 + seededRandom() * 20;
    const cloudGrad = ctx.createRadialGradient(x, y, 0, x, y, rx);
    cloudGrad.addColorStop(0, "rgba(255, 255, 255, 0.6)");
    cloudGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.2)");
    cloudGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = cloudGrad;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, seededRandom() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/* ── Scene Options ── */

export interface SceneOptions {
  container: HTMLElement;
  site: LunarSite;
  skyState: SkyState;
  mask?: HorizonMask | null;
  viewMode: "overview" | "site-level";
  /** Invoked when the user clicks the landing site marker in the scene. */
  onSiteMarkerClick?: (site: LunarSite) => void;
}

export class LunarScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  // Overview objects
  private overviewGroup = new THREE.Group();
  private moonMesh!: THREE.Mesh;
  private terminatorMesh!: THREE.Mesh;
  private sunMesh!: THREE.Mesh;
  private earthMesh!: THREE.Mesh;
  private siteMarker!: THREE.Group;
  private sunLight!: THREE.DirectionalLight;
  private gridGroup = new THREE.Group();
  private gridRaycaster = new THREE.Raycaster();
  private gridTooltip: HTMLDivElement | null = null;
  private siteGuideSvg: SVGSVGElement | null = null;
  private siteGuideLine: SVGLineElement | null = null;
  private siteGuideDot: SVGCircleElement | null = null;
  private siteGuideBadge: HTMLDivElement | null = null;
  private siteGuideArrow: HTMLSpanElement | null = null;

  // Site-level surface objects
  private surfaceGroup = new THREE.Group();
  private groundDisc!: THREE.Mesh;
  private horizonRing!: THREE.Line;
  private terrainSilhouetteLine!: THREE.Line;
  private compassGroup = new THREE.Group();
  private surfaceSunMesh!: THREE.Mesh;
  private surfaceEarthMesh!: THREE.Mesh;

  private animationId: number | null = null;
  private site: LunarSite;
  private skyState: SkyState;
  private mask: HorizonMask | null = null;
  private viewMode: "overview" | "site-level";

  /** Callback fired on landing-site marker click (overview mode). */
  private onSiteMarkerClick?: (site: LunarSite) => void;

  // Controls state
  private isDragging = false;
  private previousMousePosition = { x: 0, y: 0 };
  private spherical = new THREE.Spherical(5, Math.PI / 3, 0);
  private targetSpherical = new THREE.Spherical(5, Math.PI / 3, 0);

  // Surface view camera angles
  private surfaceYaw = 0; // Azimuth looking angle (radians)
  private surfacePitch = 0.2; // Elevation looking angle (radians)
  private targetSurfaceYaw = 0;
  private targetSurfacePitch = 0.2;

  constructor(options: SceneOptions) {
    this.container = options.container;
    this.site = options.site;
    this.skyState = options.skyState;
    this.mask = options.mask ?? null;
    this.viewMode = options.viewMode;
    this.onSiteMarkerClick = options.onSiteMarkerClick;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0f);

    // Camera
    const aspect = this.container.clientWidth / this.container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.05, 1_000_000);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(this.overviewGroup);
    this.scene.add(this.surfaceGroup);

    this.initScene();
  }

  private async initScene() {
    await this.buildScene();
    this.setupControls();
    this.focusCameraOnSelectedSite();
    this.updateView();
    this.animate();
  }

  private async buildScene() {
    // Stars background
    this.addStars();

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(ambientLight);

    /* ── Overview Group ── */

    // Moon sphere
    const moonGeometry = new THREE.SphereGeometry(MOON_SCENE_RADIUS, 128, 64);
    const moonTexture = await loadMoonTexture();
    const moonMaterial = new THREE.MeshStandardMaterial({
      map: moonTexture,
      roughness: 0.95,
      metalness: 0.05,
    });
    this.moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
    this.moonMesh.castShadow = true;
    this.moonMesh.receiveShadow = true;
    this.overviewGroup.add(this.moonMesh);

    // Terminator overlay (soft shadow for unlit side)
    const terminatorGeometry = new THREE.SphereGeometry(MOON_SCENE_RADIUS * 1.002, 64, 32, 0, Math.PI);
    const terminatorMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.65,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    this.terminatorMesh = new THREE.Mesh(terminatorGeometry, terminatorMaterial);
    this.overviewGroup.add(this.terminatorMesh);

    // Selenographic Grid Lines (Equator & Prime Meridian)
    this.buildSelenographicGrid();
    this.overviewGroup.add(this.gridGroup);

    // Sun (overview) — multi-layer smooth halo for gradual light falloff
    const sunScale = SUN_RADIUS_KM * OVERVIEW_SCALE;
    const sunGeometry = new THREE.SphereGeometry(sunScale, 16, 8);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
    this.sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);

    // Inner glow — warm yellow, close to the Sun surface
    const sunInnerGlowGeom = new THREE.SphereGeometry(sunScale * 1.6, 16, 8);
    const sunInnerGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffee88,
      transparent: true,
      opacity: 0.45,
      side: THREE.BackSide,
    });
    this.sunMesh.add(new THREE.Mesh(sunInnerGlowGeom, sunInnerGlowMat));

    // Mid glow — golden orange, bridges inner and outer
    const sunMidGlowGeom = new THREE.SphereGeometry(sunScale * 2.5, 16, 8);
    const sunMidGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffcc55,
      transparent: true,
      opacity: 0.2,
      side: THREE.BackSide,
    });
    this.sunMesh.add(new THREE.Mesh(sunMidGlowGeom, sunMidGlowMat));

    // Outer glow — soft amber, extends far for smooth light transition
    const sunOuterGlowGeom = new THREE.SphereGeometry(sunScale * 4, 16, 8);
    const sunOuterGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    this.sunMesh.add(new THREE.Mesh(sunOuterGlowGeom, sunOuterGlowMat));
    this.overviewGroup.add(this.sunMesh);

    // Solar Directional Light
    this.sunLight = new THREE.DirectionalLight(0xfff8e7, 2.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.overviewGroup.add(this.sunLight);

    // Earth (overview) — multi-layer atmosphere for stronger, smoother glow
    const earthScale = EARTH_RADIUS_KM * OVERVIEW_SCALE;
    const earthGeometry = new THREE.SphereGeometry(earthScale, 24, 12);
    const earthTexture = await loadEarthTexture();
    const earthMaterial = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.7,
      metalness: 0.1,
    });
    this.earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);

    // Inner atmosphere — bright blue, close to surface
    const atmosInnerGeom = new THREE.SphereGeometry(earthScale * 1.06, 16, 8);
    const atmosInnerMat = new THREE.MeshBasicMaterial({
      color: 0x6699ff,
      transparent: true,
      opacity: 0.25,
      side: THREE.BackSide,
    });
    this.earthMesh.add(new THREE.Mesh(atmosInnerGeom, atmosInnerMat));

    // Mid atmosphere — deeper blue, extends further
    const atmosMidGeom = new THREE.SphereGeometry(earthScale * 1.12, 16, 8);
    const atmosMidMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
    });
    this.earthMesh.add(new THREE.Mesh(atmosMidGeom, atmosMidMat));

    // Outer haze — light blue, soft edge
    const atmosOuterGeom = new THREE.SphereGeometry(earthScale * 1.2, 16, 8);
    const atmosOuterMat = new THREE.MeshBasicMaterial({
      color: 0x88bbff,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    this.earthMesh.add(new THREE.Mesh(atmosOuterGeom, atmosOuterMat));

    this.overviewGroup.add(this.earthMesh);

    // Landing Site Pin Marker
    this.siteMarker = new THREE.Group();
    const pinGeometry = new THREE.SphereGeometry(0.04, 16, 8);
    const pinMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const pinMesh = new THREE.Mesh(pinGeometry, pinMaterial);
    this.siteMarker.add(pinMesh);

    // Invisible hit-area sphere so the landing site is easy to click
    const hitAreaGeometry = new THREE.SphereGeometry(0.3, 12, 8);
    const hitAreaMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const hitArea = new THREE.Mesh(hitAreaGeometry, hitAreaMaterial);
    this.siteMarker.add(hitArea);

    // Flag group: will be oriented to point outward from moon surface
    const flagGroup = new THREE.Group();
    
    // Flag pole — points along +Y (upward from surface)
    const poleGeom = new THREE.CylinderGeometry(0.003, 0.003, 0.12, 8);
    const poleMat = new THREE.MeshBasicMaterial({ color: 0xf7f7f8 });
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pole.position.y = 0.08;
    flagGroup.add(pole);

    // Flag triangle — extends along +X from pole top
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(0.06, 0.02);
    flagShape.lineTo(0, 0.04);
    flagShape.lineTo(0, 0);
    const flagGeom = new THREE.ShapeGeometry(flagShape);
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeom, flagMat);
    flag.position.set(0, 0.12, 0);
    flagGroup.add(flag);

    this.siteMarker.add(flagGroup);

    // Pulsing radar ring on ground
    const ringGeometry = new THREE.RingGeometry(0.05, 0.07, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    this.siteMarker.add(ring);
    this.overviewGroup.add(this.siteMarker);

    /* ── Site-Level Surface Group ── */

    // Ground Disc (lunar regolith floor)
    const groundGeometry = new THREE.CircleGeometry(10, 64);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x222228,
      roughness: 0.95,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    this.groundDisc = new THREE.Mesh(groundGeometry, groundMaterial);
    this.groundDisc.rotation.x = -Math.PI / 2;
    this.surfaceGroup.add(this.groundDisc);

    // 0° Elevation Horizon Ring
    const horizonCurve = new THREE.EllipseCurve(0, 0, 9.8, 9.8, 0, 2 * Math.PI, false, 0);
    const horizonPoints = horizonCurve.getPoints(120).map((p) => new THREE.Vector3(p.x, 0.02, p.y));
    const horizonGeom = new THREE.BufferGeometry().setFromPoints(horizonPoints);
    this.horizonRing = new THREE.Line(
      horizonGeom,
      new THREE.LineDashedMaterial({ color: 0x71717a, dashSize: 0.4, gapSize: 0.2 }),
    );
    this.horizonRing.computeLineDistances();
    this.surfaceGroup.add(this.horizonRing);

    // 3D Terrain Horizon Mask Silhouette Line
    const terrainPoints: THREE.Vector3[] = [];
    const rTerrain = 9.5;
    for (let az = 0; az <= 360; az += 2) {
      const azRad = (az * Math.PI) / 180;
      const elevDeg = 0; // updated in updateSurfaceScene
      const elevRad = (elevDeg * Math.PI) / 180;
      const x = rTerrain * Math.sin(azRad) * Math.cos(elevRad);
      const y = rTerrain * Math.sin(elevRad);
      const z = -rTerrain * Math.cos(azRad) * Math.cos(elevRad);
      terrainPoints.push(new THREE.Vector3(x, y, z));
    }
    const terrainGeom = new THREE.BufferGeometry().setFromPoints(terrainPoints);
    this.terrainSilhouetteLine = new THREE.Line(
      terrainGeom,
      new THREE.LineBasicMaterial({ color: 0xa1a1aa, linewidth: 2 }),
    );
    this.surfaceGroup.add(this.terrainSilhouetteLine);

    // Compass Rose with N, E, S, W labels
    this.buildCompassRose();
    this.surfaceGroup.add(this.compassGroup);

    // Surface Sun — multi-layer smooth halo (closer view, more detail)
    const surfaceSunGeom = new THREE.SphereGeometry(0.35, 24, 12);
    const surfaceSunMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
    this.surfaceSunMesh = new THREE.Mesh(surfaceSunGeom, surfaceSunMat);

    // Inner glow — warm yellow, close to surface
    const surfSunInnerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.5, side: THREE.BackSide }),
    );
    this.surfaceSunMesh.add(surfSunInnerGlow);

    // Mid glow — golden bridge layer
    const surfSunMidGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0.25, side: THREE.BackSide }),
    );
    this.surfaceSunMesh.add(surfSunMidGlow);

    // Outer glow — soft amber, far reach
    const surfSunOuterGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.1, side: THREE.BackSide }),
    );
    this.surfaceSunMesh.add(surfSunOuterGlow);

    this.surfaceGroup.add(this.surfaceSunMesh);

    // Surface Earth with multi-layer atmosphere (closer view)
    const surfaceEarthGeom = new THREE.SphereGeometry(0.45, 24, 12);
    const surfaceEarthMat = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.6,
    });
    this.surfaceEarthMesh = new THREE.Mesh(surfaceEarthGeom, surfaceEarthMat);

    // Inner atmosphere — bright blue, close to surface
    const surfAtmosInnerGeom = new THREE.SphereGeometry(0.49, 16, 8);
    const surfAtmosInnerMat = new THREE.MeshBasicMaterial({
      color: 0x6699ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide,
    });
    this.surfaceEarthMesh.add(new THREE.Mesh(surfAtmosInnerGeom, surfAtmosInnerMat));

    // Mid atmosphere — deeper blue
    const surfAtmosMidGeom = new THREE.SphereGeometry(0.54, 16, 8);
    const surfAtmosMidMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.18,
      side: THREE.BackSide,
    });
    this.surfaceEarthMesh.add(new THREE.Mesh(surfAtmosMidGeom, surfAtmosMidMat));

    // Outer haze — light blue, soft edge
    const surfHazeGeom = new THREE.SphereGeometry(0.62, 16, 8);
    const surfHazeMat = new THREE.MeshBasicMaterial({
      color: 0x88bbff,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    this.surfaceEarthMesh.add(new THREE.Mesh(surfHazeGeom, surfHazeMat));

    this.surfaceGroup.add(this.surfaceEarthMesh);
  }

  private buildSelenographicGrid() {
    const r = MOON_SCENE_RADIUS * 1.003;

    const addRing = (points: THREE.Vector3[], color: THREE.Color, phase: number, label: string) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const vertexColors = new Float32Array(points.length * 3);
      const highlightColor = new THREE.Color(0xf7f7f8);

      for (let i = 0; i < points.length; i++) {
        const progress = i / (points.length - 1);
        const glint = (Math.cos(progress * Math.PI * 4 + phase) + 1) / 2;
        const vertexColor = color.clone().lerp(highlightColor, 0.12 + glint * 0.48);
        vertexColor.toArray(vertexColors, i * 3);
      }

      geometry.setAttribute("color", new THREE.BufferAttribute(vertexColors, 3));
      const glowLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }));
      const detailLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }));
      glowLine.userData.gridLabel = label;
      glowLine.userData.gridColor = `#${color.getHexString()}`;
      detailLine.userData.gridLabel = label;
      detailLine.userData.gridColor = `#${color.getHexString()}`;
      this.gridGroup.add(glowLine, detailLine);
    };

    const equatorCurve = new THREE.EllipseCurve(0, 0, r, r, 0, 2 * Math.PI, false, 0);
    const equatorPoints = equatorCurve.getPoints(180).map((p) => new THREE.Vector3(p.x, 0, p.y));
    addRing(equatorPoints, new THREE.Color(0x3b82f6), 0, "Lunar equator · 0° latitude");

    const meridianCurve = new THREE.EllipseCurve(0, 0, r, r, 0, 2 * Math.PI, false, 0);
    const meridianPoints = meridianCurve.getPoints(180).map((p) => new THREE.Vector3(p.x, p.y, 0));
    addRing(meridianPoints, new THREE.Color(0xf59e0b), Math.PI / 2, "Prime meridian · 0° longitude");
  }

  private buildCompassRose() {
    // Cardinal directions: North is +Z (or -Z depending on convention; let North be -Z, East be +X)
    const dirs = [
      { label: "N", az: 0, color: 0xf59e0b },
      { label: "E", az: 90, color: 0xa1a1aa },
      { label: "S", az: 180, color: 0xa1a1aa },
      { label: "W", az: 270, color: 0xa1a1aa },
    ];

    for (const d of dirs) {
      const azRad = (d.az * Math.PI) / 180;
      const x = 9.2 * Math.sin(azRad);
      const z = -9.2 * Math.cos(azRad);

      // Line from center to direction
      const points = [new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(x, 0.01, z)];
      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: d.color, transparent: true, opacity: 0.4 }));
      this.compassGroup.add(line);

      // Text billboard marker for Cardinal label
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = d.label === "N" ? "#f59e0b" : "#f7f7f8";
      ctx.font = "bold 44px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(d.label, 32, 32);

      const spriteMat = new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(x * 1.05, 0.5, z * 1.05);
      sprite.scale.set(1.2, 1.2, 1);
      this.compassGroup.add(sprite);
    }
  }

  private addStars() {
    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 1500;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    // Star color palette: white, blue-white, yellow, orange
    const starColors = [
      new THREE.Color(0xffffff),  // white
      new THREE.Color(0xaaccff),  // blue-white
      new THREE.Color(0xffffcc),  // yellow
      new THREE.Color(0xffccaa),  // orange
    ];

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const radius = 500 + Math.random() * 700;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);

      // Assign color — brighter stars are bluer
      const brightness = Math.random();
      const colorIdx = brightness > 0.8 ? 1 : brightness > 0.5 ? 2 : brightness > 0.2 ? 0 : 3;
      const color = starColors[colorIdx];
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
    }

    starsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starsGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const starsMaterial = new THREE.PointsMaterial({
      size: 0.5,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
    });
    this.scene.add(new THREE.Points(starsGeometry, starsMaterial));
  }

  private setupControls() {
    const canvas = this.renderer.domElement;
    this.gridTooltip = document.createElement("div");
    this.gridTooltip.className =
      "pointer-events-none absolute z-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)]/95 px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] shadow-lg backdrop-blur";
    this.gridTooltip.setAttribute("role", "tooltip");
    this.gridTooltip.style.display = "none";
    this.container.appendChild(this.gridTooltip);

    const guideSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    guideSvg.setAttribute("aria-hidden", "true");
    guideSvg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;display:none";
    const guideLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    guideLine.setAttribute("stroke", "#f59e0b");
    guideLine.setAttribute("stroke-opacity", "0.55");
    guideLine.setAttribute("stroke-width", "1.5");
    guideLine.setAttribute("stroke-dasharray", "5 7");
    guideSvg.appendChild(guideLine);
    const guideDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    guideDot.setAttribute("r", "3.5");
    guideDot.setAttribute("fill", "#f59e0b");
    guideDot.setAttribute("stroke", "#f7f7f8");
    guideDot.setAttribute("stroke-width", "1.5");
    guideSvg.appendChild(guideDot);
    this.container.appendChild(guideSvg);
    this.siteGuideSvg = guideSvg;
    this.siteGuideLine = guideLine;
    this.siteGuideDot = guideDot;

    const guideBadge = document.createElement("div");
    guideBadge.className =
      "pointer-events-none absolute z-20 flex items-center gap-1 rounded-full border border-[var(--color-accent)] bg-[var(--color-bg-surface)]/95 px-2 py-1 text-[10px] font-semibold text-[var(--color-accent)] shadow-lg backdrop-blur";
    guideBadge.setAttribute("role", "status");
    guideBadge.setAttribute("aria-live", "polite");
    guideBadge.setAttribute("aria-label", "The selected landing site is out of sight. Rotate toward the direction shown.");
    guideBadge.style.display = "none";
    const guideArrow = document.createElement("span");
    guideArrow.textContent = "➤";
    guideBadge.append(guideArrow, document.createTextNode("SITE"));
    this.container.appendChild(guideBadge);
    this.siteGuideBadge = guideBadge;
    this.siteGuideArrow = guideArrow;

    canvas.addEventListener("mousedown", (e: MouseEvent) => {
      this.isDragging = true;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
      this.hideGridTooltip();
      canvas.style.cursor = "grabbing";
    });

    canvas.addEventListener("mousemove", (e: MouseEvent) => {
      if (!this.isDragging) {
        this.updateGridHover(e);
        return;
      }

      this.hideGridTooltip();

      const deltaMove = {
        x: e.clientX - this.previousMousePosition.x,
        y: e.clientY - this.previousMousePosition.y,
      };

      if (this.viewMode === "overview") {
        this.targetSpherical.theta -= deltaMove.x * 0.008;
        this.targetSpherical.phi -= deltaMove.y * 0.008;
        this.targetSpherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.targetSpherical.phi));
      } else {
        // Site-level: yaw & pitch
        this.targetSurfaceYaw -= deltaMove.x * 0.006;
        this.targetSurfacePitch += deltaMove.y * 0.004;
        this.targetSurfacePitch = Math.max(-0.2, Math.min(1.4, this.targetSurfacePitch));
      }

      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    const stopDrag = () => {
      this.isDragging = false;
      canvas.style.cursor = "grab";
    };
    canvas.addEventListener("mouseup", stopDrag);
    canvas.addEventListener("mouseleave", () => {
      stopDrag();
      this.hideGridTooltip();
    });

    canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        if (this.viewMode === "overview") {
          this.targetSpherical.radius *= e.deltaY > 0 ? 1.08 : 0.92;
          this.targetSpherical.radius = Math.max(MIN_OVERVIEW_CAMERA_RADIUS, Math.min(18, this.targetSpherical.radius));
        } else {
          // In surface view, adjust FOV / zoom
          this.camera.fov = Math.max(30, Math.min(75, this.camera.fov + (e.deltaY > 0 ? 3 : -3)));
          this.camera.updateProjectionMatrix();
        }
      },
      { passive: false },
    );

    // Touch controls
    let touchStartDist = 0;
    canvas.addEventListener("touchstart", (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.hypot(dx, dy);
      }
    });

    canvas.addEventListener(
      "touchmove",
      (e: TouchEvent) => {
        e.preventDefault();
        if (e.touches.length === 1 && this.isDragging) {
          const deltaMove = {
            x: e.touches[0].clientX - this.previousMousePosition.x,
            y: e.touches[0].clientY - this.previousMousePosition.y,
          };
          if (this.viewMode === "overview") {
            this.targetSpherical.theta -= deltaMove.x * 0.008;
            this.targetSpherical.phi -= deltaMove.y * 0.008;
            this.targetSpherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.targetSpherical.phi));
          } else {
            this.targetSurfaceYaw -= deltaMove.x * 0.006;
            this.targetSurfacePitch += deltaMove.y * 0.004;
            this.targetSurfacePitch = Math.max(-0.2, Math.min(1.4, this.targetSurfacePitch));
          }
          this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else if (e.touches.length === 2 && this.viewMode === "overview") {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          if (touchStartDist > 0) {
            const scale = touchStartDist / dist;
            this.targetSpherical.radius *= scale;
            this.targetSpherical.radius = Math.max(MIN_OVERVIEW_CAMERA_RADIUS, Math.min(18, this.targetSpherical.radius));
          }
          touchStartDist = dist;
        }
      },
      { passive: false },
    );

    canvas.addEventListener("touchend", stopDrag);

    // Landing site marker click → forward to app callback (ignore drags)
    let downPos: { x: number; y: number } | null = null;
    canvas.addEventListener("mousedown", (e: MouseEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("mouseup", (e: MouseEvent) => {
      const start = downPos;
      downPos = null;
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return; // was a drag
      if (this.viewMode !== "overview") return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, this.camera);
      const hits = raycaster.intersectObject(this.siteMarker, true);
      if (hits.length > 0) this.onSiteMarkerClick?.(this.site);
    });

    // Keyboard navigation
    canvas.addEventListener("keydown", (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          if (this.viewMode === "overview") this.targetSpherical.theta -= 0.1;
          else this.targetSurfaceYaw += 0.1;
          break;
        case "ArrowRight":
          if (this.viewMode === "overview") this.targetSpherical.theta += 0.1;
          else this.targetSurfaceYaw -= 0.1;
          break;
        case "ArrowUp":
          if (this.viewMode === "overview") this.targetSpherical.phi = Math.max(0.1, this.targetSpherical.phi - 0.1);
          else this.targetSurfacePitch = Math.min(1.4, this.targetSurfacePitch + 0.1);
          break;
        case "ArrowDown":
          if (this.viewMode === "overview") this.targetSpherical.phi = Math.min(Math.PI - 0.1, this.targetSpherical.phi + 0.1);
          else this.targetSurfacePitch = Math.max(-0.2, this.targetSurfacePitch - 0.1);
          break;
        case "+":
        case "=":
          if (this.viewMode === "overview") {
            this.targetSpherical.radius = Math.max(MIN_OVERVIEW_CAMERA_RADIUS, this.targetSpherical.radius - 0.5);
          }
          break;
        case "-":
          if (this.viewMode === "overview") this.targetSpherical.radius = Math.min(18, this.targetSpherical.radius + 0.5);
          break;
      }
    });

    canvas.setAttribute("tabindex", "0");
    canvas.setAttribute(
      "aria-label",
      "Interactive 3D lunar scene: drag to rotate, scroll to zoom, arrow keys to navigate. Blue marks the lunar equator at 0 degrees latitude; amber marks the prime meridian at 0 degrees longitude.",
    );
  }

  private updateGridHover(event: MouseEvent) {
    const tooltip = this.gridTooltip;
    if (!tooltip || this.viewMode !== "overview") {
      this.hideGridTooltip();
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.hideGridTooltip();
      return;
    }

    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const visibleDistance = Math.max(0.25, this.camera.position.length() - MOON_SCENE_RADIUS);
    this.gridRaycaster.params.Line!.threshold =
      (2 * visibleDistance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 6) / rect.height;
    this.gridRaycaster.setFromCamera(pointer, this.camera);

    const moonDistance = this.gridRaycaster.intersectObject(this.moonMesh)[0]?.distance ?? Infinity;
    const hit = this.gridRaycaster
      .intersectObjects(this.gridGroup.children)
      .find((intersection) => intersection.distance < moonDistance);

    if (!hit) {
      this.hideGridTooltip();
      return;
    }

    const label = hit?.object.userData.gridLabel;
    if (typeof label !== "string") {
      this.hideGridTooltip();
      return;
    }

    tooltip.textContent = label;
    tooltip.style.borderLeft = `3px solid ${hit.object.userData.gridColor}`;
    tooltip.style.display = "block";
    const x = event.clientX - rect.left + 14;
    const y = event.clientY - rect.top + 14;
    tooltip.style.left = `${Math.max(0, Math.min(x, rect.width - tooltip.offsetWidth))}px`;
    tooltip.style.top = `${Math.max(0, Math.min(y, rect.height - tooltip.offsetHeight))}px`;
    this.renderer.domElement.style.cursor = "help";
  }

  private hideGridTooltip() {
    if (this.gridTooltip) this.gridTooltip.style.display = "none";
    this.renderer.domElement.style.cursor = this.isDragging ? "grabbing" : "grab";
  }

  private focusCameraOnSelectedSite() {
    const latRad = THREE.MathUtils.degToRad(this.site.latDeg);
    const lonRad = THREE.MathUtils.degToRad(this.site.eastLonDeg);
    const siteTheta = Math.PI / 2 - lonRad;
    const thetaDelta = THREE.MathUtils.euclideanModulo(
      siteTheta - this.targetSpherical.theta + Math.PI,
      2 * Math.PI,
    ) - Math.PI;

    this.targetSpherical.theta += thetaDelta;
    this.targetSpherical.phi = THREE.MathUtils.clamp(Math.PI / 2 - latRad, 0.1, Math.PI - 0.1);
    this.targetSpherical.radius = Math.max(
      MIN_OVERVIEW_CAMERA_RADIUS,
      Math.min(this.targetSpherical.radius, SITE_FOCUS_CAMERA_RADIUS),
    );
  }

  private updateSiteGuide() {
    const svg = this.siteGuideSvg;
    const line = this.siteGuideLine;
    const dot = this.siteGuideDot;
    const badge = this.siteGuideBadge;
    const arrow = this.siteGuideArrow;
    if (!svg || !line || !dot || !badge || !arrow || this.viewMode !== "overview") {
      this.hideSiteGuide();
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.hideSiteGuide();
      return;
    }

    this.camera.updateMatrixWorld();
    const siteNormal = this.siteMarker.position.clone().normalize();
    const isOnVisibleHemisphere = this.camera.position.dot(siteNormal) > MOON_SCENE_RADIUS;
    const projectedSite = this.siteMarker.position.clone().project(this.camera);
    const isOnScreen = Math.abs(projectedSite.x) < 0.92 && Math.abs(projectedSite.y) < 0.92;
    if (isOnVisibleHemisphere && isOnScreen) {
      this.hideSiteGuide();
      return;
    }

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const screenMargin = 20;
    const endX = THREE.MathUtils.clamp(
      (projectedSite.x * 0.5 + 0.5) * rect.width,
      screenMargin,
      rect.width - screenMargin,
    );
    const endY = THREE.MathUtils.clamp(
      (-projectedSite.y * 0.5 + 0.5) * rect.height,
      screenMargin,
      rect.height - screenMargin,
    );
    const direction = new THREE.Vector2(endX - centerX, endY - centerY);
    if (direction.lengthSq() < 1e-8) {
      const siteInCameraSpace = this.siteMarker.position.clone().applyMatrix4(this.camera.matrixWorldInverse);
      direction.set(siteInCameraSpace.x, -siteInCameraSpace.y);
    }
    if (direction.lengthSq() < 1e-8) direction.set(1, 0);
    direction.normalize();
    const badgeX = THREE.MathUtils.clamp(endX - direction.y * 18, 30, rect.width - 30);
    const badgeY = THREE.MathUtils.clamp(endY + direction.x * 18, 20, rect.height - 20);

    svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    line.setAttribute("x1", String(centerX));
    line.setAttribute("y1", String(centerY));
    line.setAttribute("x2", String(endX));
    line.setAttribute("y2", String(endY));
    dot.setAttribute("cx", String(endX));
    dot.setAttribute("cy", String(endY));
    badge.style.left = `${badgeX}px`;
    badge.style.top = `${badgeY}px`;
    badge.style.transform = "translate(-50%, -50%)";
    arrow.style.transform = `rotate(${Math.atan2(direction.y, direction.x)}rad)`;
    svg.style.display = "block";
    badge.style.display = "flex";
  }

  private hideSiteGuide() {
    if (this.siteGuideSvg) this.siteGuideSvg.style.display = "none";
    if (this.siteGuideBadge) this.siteGuideBadge.style.display = "none";
  }

  private updateView() {
    const isOverview = this.viewMode === "overview";
    this.overviewGroup.visible = isOverview;
    this.surfaceGroup.visible = !isOverview;

    if (isOverview) {
      this.updateOverviewScene();
    } else {
      this.updateSurfaceScene();
    }
  }

  private updateOverviewScene() {
    // Landing site position in selenographic coords
    const latRad = (this.site.latDeg * Math.PI) / 180;
    const lonRad = (this.site.eastLonDeg * Math.PI) / 180;

    const r = MOON_SCENE_RADIUS;
    const siteX = r * Math.cos(latRad) * Math.cos(lonRad);
    const siteY = r * Math.sin(latRad);
    const siteZ = r * Math.cos(latRad) * Math.sin(lonRad);

    this.siteMarker.position.set(siteX, siteY, siteZ);
    // Orient the marker so its +Y axis points outward from the moon surface (surface normal)
    const normal = new THREE.Vector3(siteX, siteY, siteZ).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, normal);
    this.siteMarker.quaternion.copy(quat);

    // Position Sun
    const sunAzRad = ((this.skyState.sunAzimuthDeg - 90) * Math.PI) / 180;
    const sunElRad = (this.skyState.sunElevationDeg * Math.PI) / 180;
    const sunDistance = SUN_DISTANCE_KM * OVERVIEW_SCALE;

    this.sunMesh.position.set(
      Math.cos(sunElRad) * Math.sin(sunAzRad) * sunDistance,
      Math.sin(sunElRad) * sunDistance,
      Math.cos(sunElRad) * Math.cos(sunAzRad) * sunDistance,
    );
    this.sunLight.position.copy(this.sunMesh.position);

    // Update terminator rotation
    const sunDir = this.sunMesh.position.clone().normalize();
    const terminatorQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), sunDir);
    this.terminatorMesh.quaternion.copy(terminatorQuat);

    // Position Earth
    const earthAzRad = ((this.skyState.earthAzimuthDeg - 90) * Math.PI) / 180;
    const earthElRad = (this.skyState.earthElevationDeg * Math.PI) / 180;
    const earthDistance = MOON_EARTH_DISTANCE_KM * OVERVIEW_SCALE;

    this.earthMesh.position.set(
      Math.cos(earthElRad) * Math.sin(earthAzRad) * earthDistance,
      Math.sin(earthElRad) * earthDistance,
      Math.cos(earthElRad) * Math.cos(earthAzRad) * earthDistance,
    );
  }

  private updateSurfaceScene() {
    // Reset camera FOV
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();

    // Position Sun in local horizon sky
    // Local convention: North is -Z, East is +X, Zenith is +Y
    const sunAzRad = (this.skyState.sunAzimuthDeg * Math.PI) / 180;
    const sunElRad = (this.skyState.sunElevationDeg * Math.PI) / 180;
    const rSky = 9.0;

    const sunX = rSky * Math.sin(sunAzRad) * Math.cos(sunElRad);
    const sunY = rSky * Math.sin(sunElRad);
    const sunZ = -rSky * Math.cos(sunAzRad) * Math.cos(sunElRad);
    this.surfaceSunMesh.position.set(sunX, sunY, sunZ);

    // Position Earth in local horizon sky
    const earthAzRad = (this.skyState.earthAzimuthDeg * Math.PI) / 180;
    const earthElRad = (this.skyState.earthElevationDeg * Math.PI) / 180;

    const earthX = rSky * Math.sin(earthAzRad) * Math.cos(earthElRad);
    const earthY = rSky * Math.sin(earthElRad);
    const earthZ = -rSky * Math.cos(earthAzRad) * Math.cos(earthElRad);
    this.surfaceEarthMesh.position.set(earthX, earthY, earthZ);

    // Update 3D terrain silhouette if mask is available
    if (this.mask && this.mask.elevationDeg && this.mask.elevationDeg.length > 0) {
      const samples = this.mask.elevationDeg;
      const points: THREE.Vector3[] = [];
      const rTerrain = 9.3;
      for (let az = 0; az <= 360; az += 1) {
        const azRad = (az * Math.PI) / 180;
        const idx = Math.min(samples.length - 1, Math.floor((az / 360) * samples.length));
        const elevDeg = samples[idx] ?? 0;
        const elevRad = (elevDeg * Math.PI) / 180;

        const x = rTerrain * Math.sin(azRad) * Math.cos(elevRad);
        const y = Math.max(0.02, rTerrain * Math.sin(elevRad));
        const z = -rTerrain * Math.cos(azRad) * Math.cos(elevRad);
        points.push(new THREE.Vector3(x, y, z));
      }
      this.terrainSilhouetteLine.geometry.dispose();
      this.terrainSilhouetteLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
      this.terrainSilhouetteLine.visible = true;
    } else {
      this.terrainSilhouetteLine.visible = false;
    }
  }

  public update(site: LunarSite, skyState: SkyState, mask?: HorizonMask | null) {
    const siteChanged = site.latDeg !== this.site.latDeg || site.eastLonDeg !== this.site.eastLonDeg;
    this.site = site;
    this.skyState = skyState;
    if (mask !== undefined) this.mask = mask;
    if (siteChanged) this.focusCameraOnSelectedSite();
    this.updateView();
  }

  public setViewMode(mode: "overview" | "site-level") {
    this.viewMode = mode;
    this.hideGridTooltip();
    this.hideSiteGuide();
    this.updateView();
  }

  /** Set camera to predefined vantage points */
  public setCameraPreset(preset: "overview" | "site" | "south-pole" | "equator" | "earth-view") {
    if (preset === "site") {
      this.setViewMode("site-level");
      // Align yaw towards Sun azimuth
      this.targetSurfaceYaw = (this.skyState.sunAzimuthDeg * Math.PI) / 180;
      this.targetSurfacePitch = 0.25;
      return;
    }

    this.setViewMode("overview");
    switch (preset) {
      case "overview":
        this.targetSpherical.radius = 5.2;
        this.targetSpherical.phi = Math.PI / 3;
        this.targetSpherical.theta = 0.5;
        break;
      case "south-pole":
        this.targetSpherical.radius = 4.2;
        this.targetSpherical.phi = 0.15; // looking down at pole
        this.targetSpherical.theta = 0;
        break;
      case "equator":
        this.targetSpherical.radius = 4.5;
        this.targetSpherical.phi = Math.PI / 2; // equatorial plane
        this.targetSpherical.theta = 1.2;
        break;
      case "earth-view":
        // Look from behind Earth towards Moon
        this.targetSpherical.radius = 7.0;
        this.targetSpherical.phi = (Math.PI / 2) - ((this.skyState.earthElevationDeg * Math.PI) / 180);
        this.targetSpherical.theta = (this.skyState.earthAzimuthDeg * Math.PI) / 180;
        break;
    }
  }

  private animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    if (this.viewMode === "overview") {
      // Smooth spherical camera interpolation
      this.spherical.radius += (this.targetSpherical.radius - this.spherical.radius) * 0.1;
      this.spherical.theta += (this.targetSpherical.theta - this.spherical.theta) * 0.1;
      this.spherical.phi += (this.targetSpherical.phi - this.spherical.phi) * 0.1;

      // Auto slow rotate when idle
      if (!this.isDragging) {
        this.targetSpherical.theta += 0.0002;
      }

      this.camera.position.setFromSpherical(this.spherical);
      this.camera.lookAt(0, 0, 0);
      this.updateSiteGuide();

      // Rotate Earth slowly
      this.earthMesh.rotation.y += 0.0001;

      // Pulse site pin marker
      const pulse = 1 + Math.sin(Date.now() * 0.004) * 0.15;
      this.siteMarker.scale.setScalar(pulse);

      // Animate Sun glow — subtle pulsing
      const sunPulse = 0.95 + Math.sin(Date.now() * 0.002) * 0.05;
      this.sunMesh.scale.setScalar(sunPulse);
    } else {
      this.hideSiteGuide();
      // Surface view: camera sits at center of local horizon plane (0, 0.4, 0)
      this.surfaceYaw += (this.targetSurfaceYaw - this.surfaceYaw) * 0.12;
      this.surfacePitch += (this.targetSurfacePitch - this.surfacePitch) * 0.12;

      const eyeY = 0.45;
      this.camera.position.set(0, eyeY, 0);

      // Look direction from yaw and pitch
      const lookDist = 10;
      const targetX = lookDist * Math.sin(this.surfaceYaw) * Math.cos(this.surfacePitch);
      const targetY = eyeY + lookDist * Math.sin(this.surfacePitch);
      const targetZ = -lookDist * Math.cos(this.surfaceYaw) * Math.cos(this.surfacePitch);

      this.camera.lookAt(targetX, targetY, targetZ);
    }

    this.renderer.render(this.scene, this.camera);
  }

  public resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.gridTooltip?.remove();
    this.siteGuideSvg?.remove();
    this.siteGuideBadge?.remove();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
