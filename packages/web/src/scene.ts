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

const MOON_TEXTURE_URL = "/textures/moon.jpg";
const EARTH_TEXTURE_URL = "/textures/earth.png";

/** Load Moon texture with procedural fallback. */
function loadMoonTexture(): Promise<THREE.Texture> {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      MOON_TEXTURE_URL,
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        resolve(texture);
      },
      undefined,
      () => {
        resolve(createProceduralMoonTexture());
      },
    );
  });
}

function createProceduralMoonTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#8a8a8a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  function noise(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const n = noise(x * 0.05, y * 0.05) * 30 - 15;
      const fine = noise(x * 0.2, y * 0.2) * 10 - 5;
      const val = 138 + n + fine;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
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

function createProceduralEarthTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1a4d8a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#2d5a27";
  const continents = [
    { x: 0.25, y: 0.3, w: 0.15, h: 0.25 },
    { x: 0.5, y: 0.25, w: 0.12, h: 0.2 },
    { x: 0.7, y: 0.3, w: 0.15, h: 0.2 },
  ];
  for (const c of continents) {
    ctx.beginPath();
    ctx.ellipse(c.x * canvas.width, c.y * canvas.height, (c.w * canvas.width) / 2, (c.h * canvas.height) / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = Math.random() * 20 + 5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
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
    const moonGeometry = new THREE.SphereGeometry(MOON_SCENE_RADIUS, 64, 32);
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

    // Sun (overview)
    const sunScale = SUN_RADIUS_KM * OVERVIEW_SCALE;
    const sunGeometry = new THREE.SphereGeometry(sunScale, 32, 16);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    this.sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);

    // Sun Corona Glow
    const sunGlowGeometry = new THREE.SphereGeometry(sunScale * 1.8, 32, 16);
    const sunGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.35,
    });
    this.sunMesh.add(new THREE.Mesh(sunGlowGeometry, sunGlowMaterial));
    this.overviewGroup.add(this.sunMesh);

    // Solar Directional Light
    this.sunLight = new THREE.DirectionalLight(0xfff8e7, 2.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.overviewGroup.add(this.sunLight);

    // Earth (overview)
    const earthScale = EARTH_RADIUS_KM * OVERVIEW_SCALE;
    const earthGeometry = new THREE.SphereGeometry(earthScale, 32, 16);
    const earthTexture = await loadEarthTexture();
    const earthMaterial = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.7,
      metalness: 0.1,
    });
    this.earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    this.overviewGroup.add(this.earthMesh);

    // Landing Site Pin Marker
    this.siteMarker = new THREE.Group();
    const pinGeometry = new THREE.SphereGeometry(0.025, 16, 8);
    const pinMaterial = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
    const pinMesh = new THREE.Mesh(pinGeometry, pinMaterial);
    this.siteMarker.add(pinMesh);

    // Pulsing radar ring
    const ringGeometry = new THREE.RingGeometry(0.035, 0.05, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
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

    // Surface Sun
    const surfaceSunGeom = new THREE.SphereGeometry(0.35, 32, 16);
    const surfaceSunMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    this.surfaceSunMesh = new THREE.Mesh(surfaceSunGeom, surfaceSunMat);
    const surfaceSunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.4 }),
    );
    this.surfaceSunMesh.add(surfaceSunGlow);
    this.surfaceGroup.add(this.surfaceSunMesh);

    // Surface Earth
    const surfaceEarthGeom = new THREE.SphereGeometry(0.45, 32, 16);
    const surfaceEarthMat = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.6,
    });
    this.surfaceEarthMesh = new THREE.Mesh(surfaceEarthGeom, surfaceEarthMat);
    this.surfaceGroup.add(this.surfaceEarthMesh);
  }

  private buildSelenographicGrid() {
    const r = MOON_SCENE_RADIUS * 1.001;

    // Equator ring
    const eqCurve = new THREE.EllipseCurve(0, 0, r, r, 0, 2 * Math.PI, false, 0);
    const eqPoints = eqCurve.getPoints(90).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const eqGeom = new THREE.BufferGeometry().setFromPoints(eqPoints);
    const eqLine = new THREE.Line(
      eqGeom,
      new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.25 }),
    );
    this.gridGroup.add(eqLine);

    // Prime meridian ring
    const pmCurve = new THREE.EllipseCurve(0, 0, r, r, 0, 2 * Math.PI, false, 0);
    const pmPoints = pmCurve.getPoints(90).map((p) => new THREE.Vector3(p.x, p.y, 0));
    const pmGeom = new THREE.BufferGeometry().setFromPoints(pmPoints);
    const pmLine = new THREE.Line(
      pmGeom,
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.25 }),
    );
    this.gridGroup.add(pmLine);
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
    const starCount = 2500;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const radius = 600 + Math.random() * 600;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);
    }

    starsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const starsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.6,
      sizeAttenuation: true,
    });
    this.scene.add(new THREE.Points(starsGeometry, starsMaterial));
  }

  private setupControls() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener("mousedown", (e: MouseEvent) => {
      this.isDragging = true;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener("mousemove", (e: MouseEvent) => {
      if (!this.isDragging) return;

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
    };
    canvas.addEventListener("mouseup", stopDrag);
    canvas.addEventListener("mouseleave", stopDrag);

    canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        if (this.viewMode === "overview") {
          this.targetSpherical.radius *= e.deltaY > 0 ? 1.08 : 0.92;
          this.targetSpherical.radius = Math.max(2.1, Math.min(18, this.targetSpherical.radius));
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
            this.targetSpherical.radius = Math.max(2.1, Math.min(18, this.targetSpherical.radius));
          }
          touchStartDist = dist;
        }
      },
      { passive: false },
    );

    canvas.addEventListener("touchend", stopDrag);

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
          if (this.viewMode === "overview") this.targetSpherical.radius = Math.max(2.1, this.targetSpherical.radius - 0.5);
          break;
        case "-":
          if (this.viewMode === "overview") this.targetSpherical.radius = Math.min(18, this.targetSpherical.radius + 0.5);
          break;
      }
    });

    canvas.setAttribute("tabindex", "0");
    canvas.setAttribute("aria-label", "Interactive 3D lunar scene: drag to rotate, scroll to zoom, arrow keys to navigate.");
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
    this.siteMarker.lookAt(siteX * 2, siteY * 2, siteZ * 2);

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
    this.site = site;
    this.skyState = skyState;
    if (mask !== undefined) this.mask = mask;
    this.updateView();
  }

  public setViewMode(mode: "overview" | "site-level") {
    this.viewMode = mode;
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

      // Rotate Earth slowly
      this.earthMesh.rotation.y += 0.0001;

      // Pulse site pin marker
      const pulse = 1 + Math.sin(Date.now() * 0.004) * 0.15;
      this.siteMarker.scale.setScalar(pulse);
    } else {
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
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
