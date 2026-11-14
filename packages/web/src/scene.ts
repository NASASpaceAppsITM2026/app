/**
 * 3D lunar scene using Three.js.
 *
 * Renders:
 * - A procedural Moon sphere with crater-like noise texture
 * - Sun as a glowing sphere with directional light
 * - Earth as a smaller sphere with blue-green coloring
 * - Landing site markers at selenographic coordinates
 * - Orbit controls for rotation and zoom
 *
 * Two view modes:
 * - Overview: compressed distances showing all three bodies
 * - Site-level: local horizon view from the landing site
 */

import * as THREE from "three";
import type { LunarSite, SkyState } from "core";

/* ── Constants ── */

const MOON_RADIUS_KM = 1737.4;
const EARTH_RADIUS_KM = 6371;
const SUN_RADIUS_KM = 696_340;
const _EARTH_MOON_DIST_KM = 384_400;
const _SUN_MOON_DIST_KM = 149_600_000;

// Scene scale: 1 unit = 1000 km for overview
const OVERVIEW_SCALE = 0.001;

/* ── Moon Texture ── */

const MOON_TEXTURE_URL = "/textures/moon.jpg";
const EARTH_TEXTURE_URL = "/textures/earth.png";

/**
 * Load the real Moon texture from the bundled image.
 * Falls back to a procedural texture if the image fails to load.
 */
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
        // Fallback to procedural texture
        console.warn("Could not load moon.jpg, using procedural texture");
        resolve(createProceduralMoonTexture());
      },
    );
  });
}

/** Fallback procedural moon texture if the image fails to load. */
function createProceduralMoonTexture(size: number = 512): THREE.CanvasTexture {
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

/** Load the real Earth texture from the bundled image. Falls back to procedural. */
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
        console.warn("Could not load earth.png, using procedural texture");
        resolve(createProceduralEarthTexture());
      },
    );
  });
}

/** Fallback procedural Earth texture. */
function createProceduralEarthTexture(size: number = 256): THREE.CanvasTexture {
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
    ctx.ellipse(
      c.x * canvas.width, c.y * canvas.height,
      c.w * canvas.width / 2, c.h * canvas.height / 2,
      0, 0, Math.PI * 2,
    );
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

/* ── Scene State ── */

export interface SceneOptions {
  container: HTMLElement;
  site: LunarSite;
  skyState: SkyState;
  viewMode: "overview" | "site-level";
}

export class LunarScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private moonMesh!: THREE.Mesh;
  private terminatorMesh!: THREE.Mesh;
  private sunMesh!: THREE.Mesh;
  private earthMesh!: THREE.Mesh;
  private siteMarker!: THREE.Mesh;
  private sunLight!: THREE.DirectionalLight;
  private animationId: number | null = null;
  private site: LunarSite;
  private skyState: SkyState;
  private viewMode: "overview" | "site-level";

  // Orbit controls state
  private isDragging = false;
  private previousMousePosition = { x: 0, y: 0 };
  private rotationSpeed = { x: 0, y: 0 };
  private spherical = new THREE.Spherical(5, Math.PI / 3, 0);
  private targetSpherical = new THREE.Spherical(5, Math.PI / 3, 0);

  constructor(options: SceneOptions) {
    this.container = options.container;
    this.site = options.site;
    this.skyState = options.skyState;
    this.viewMode = options.viewMode;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // Camera
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Build scene objects (async — loads textures)
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

    // Moon — load real texture
    const moonGeometry = new THREE.SphereGeometry(MOON_RADIUS_KM * OVERVIEW_SCALE, 64, 32);
    const moonTexture = await loadMoonTexture();
    const moonMaterial = new THREE.MeshStandardMaterial({
      map: moonTexture,
      roughness: 0.9,
      metalness: 0.1,
    });
    this.moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
    this.moonMesh.castShadow = true;
    this.moonMesh.receiveShadow = true;
    this.scene.add(this.moonMesh);

    // Terminator overlay — dark hemisphere showing night side (only the back half)
    const terminatorGeometry = new THREE.SphereGeometry(
      MOON_RADIUS_KM * OVERVIEW_SCALE * 1.002, 64, 32, 0, Math.PI,
    );
    const terminatorMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    this.terminatorMesh = new THREE.Mesh(terminatorGeometry, terminatorMaterial);
    this.scene.add(this.terminatorMesh);

    // Sun
    const sunScale = SUN_RADIUS_KM * OVERVIEW_SCALE * 0.01;
    const sunGeometry = new THREE.SphereGeometry(sunScale, 32, 16);
    const sunMaterial = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
    });
    this.sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);

    // Sun glow
    const sunGlowGeometry = new THREE.SphereGeometry(sunScale * 1.5, 32, 16);
    const sunGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.3,
    });
    const sunGlow = new THREE.Mesh(sunGlowGeometry, sunGlowMaterial);
    this.sunMesh.add(sunGlow);

    // Earth — load real texture
    const earthScale = EARTH_RADIUS_KM * OVERVIEW_SCALE * 0.5;
    const earthGeometry = new THREE.SphereGeometry(earthScale, 32, 16);
    const earthTexture = await loadEarthTexture();
    const earthMaterial = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.7,
      metalness: 0.1,
    });
    this.earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    this.scene.add(this.earthMesh);

    // Site marker
    const markerGeometry = new THREE.SphereGeometry(0.02, 16, 8);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
    });
    this.siteMarker = new THREE.Mesh(markerGeometry, markerMaterial);
    this.scene.add(this.siteMarker);

    // Marker ring
    const ringGeometry = new THREE.RingGeometry(0.03, 0.04, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    this.siteMarker.add(ring);
    ring.lookAt(new THREE.Vector3(0, 0, 0));

    // Lighting
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2);
    this.sunLight.castShadow = true;
    this.scene.add(this.sunLight);

    const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
    this.scene.add(ambientLight);
  }

  private addStars() {
    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 2000;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const radius = 500 + Math.random() * 500;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);
    }

    starsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const starsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      sizeAttenuation: true,
    });

    const stars = new THREE.Points(starsGeometry, starsMaterial);
    this.scene.add(stars);
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

      this.targetSpherical.theta -= deltaMove.x * 0.01;
      this.targetSpherical.phi -= deltaMove.y * 0.01;
      this.targetSpherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.targetSpherical.phi));

      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    canvas.addEventListener("mouseleave", () => {
      this.isDragging = false;
    });

    canvas.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();
      this.targetSpherical.radius *= e.deltaY > 0 ? 1.1 : 0.9;
      this.targetSpherical.radius = Math.max(2, Math.min(20, this.targetSpherical.radius));
    }, { passive: false });

    // Touch support
    let touchStartDistance = 0;
    canvas.addEventListener("touchstart", (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDistance = Math.sqrt(dx * dx + dy * dy);
      }
    });

    canvas.addEventListener("touchmove", (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.isDragging) {
        const deltaMove = {
          x: e.touches[0].clientX - this.previousMousePosition.x,
          y: e.touches[0].clientY - this.previousMousePosition.y,
        };

        this.targetSpherical.theta -= deltaMove.x * 0.01;
        this.targetSpherical.phi -= deltaMove.y * 0.01;
        this.targetSpherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.targetSpherical.phi));

        this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const scale = touchStartDistance / distance;
        this.targetSpherical.radius *= scale;
        this.targetSpherical.radius = Math.max(2, Math.min(20, this.targetSpherical.radius));
        touchStartDistance = distance;
      }
    }, { passive: false });

    canvas.addEventListener("touchend", () => {
      this.isDragging = false;
    });

    // Keyboard controls
    canvas.addEventListener("keydown", (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          this.targetSpherical.theta -= 0.1;
          break;
        case "ArrowRight":
          this.targetSpherical.theta += 0.1;
          break;
        case "ArrowUp":
          this.targetSpherical.phi = Math.max(0.1, this.targetSpherical.phi - 0.1);
          break;
        case "ArrowDown":
          this.targetSpherical.phi = Math.min(Math.PI - 0.1, this.targetSpherical.phi + 0.1);
          break;
        case "+":
        case "=":
          this.targetSpherical.radius = Math.max(2, this.targetSpherical.radius - 0.5);
          break;
        case "-":
          this.targetSpherical.radius = Math.min(20, this.targetSpherical.radius + 0.5);
          break;
      }
    });

    canvas.setAttribute("tabindex", "0");
    canvas.setAttribute("aria-label", "3D lunar scene - drag to rotate, scroll to zoom, arrow keys to navigate");
  }

  private updateView() {
    // Convert selenographic coordinates to 3D position on Moon surface
    const latRad = (this.site.latDeg * Math.PI) / 180;
    const lonRad = (this.site.eastLonDeg * Math.PI) / 180;

    const siteX = MOON_RADIUS_KM * OVERVIEW_SCALE * Math.cos(latRad) * Math.cos(lonRad);
    const siteY = MOON_RADIUS_KM * OVERVIEW_SCALE * Math.sin(latRad);
    const siteZ = MOON_RADIUS_KM * OVERVIEW_SCALE * Math.cos(latRad) * Math.sin(lonRad);

    this.siteMarker.position.set(siteX, siteY, siteZ);

    // Position Sun based on sky state azimuth/elevation
    // In overview mode, place Sun at a compressed distance
    const sunAzRad = ((this.skyState.sunAzimuthDeg - 90) * Math.PI) / 180;
    const sunElRad = (this.skyState.sunElevationDeg * Math.PI) / 180;

    const sunDistance = 15; // Compressed distance for overview
    this.sunMesh.position.set(
      Math.cos(sunElRad) * Math.sin(sunAzRad) * sunDistance,
      Math.sin(sunElRad) * sunDistance,
      Math.cos(sunElRad) * Math.cos(sunAzRad) * sunDistance,
    );

    // Update sun light direction
    this.sunLight.position.copy(this.sunMesh.position);

    // Update terminator — rotate so dark side faces away from Sun
    const sunDir = this.sunMesh.position.clone().normalize();
    const terminatorQuat = new THREE.Quaternion();
    terminatorQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sunDir);
    this.terminatorMesh.quaternion.copy(terminatorQuat);

    // Position Earth based on sky state
    const earthAzRad = ((this.skyState.earthAzimuthDeg - 90) * Math.PI) / 180;
    const earthElRad = (this.skyState.earthElevationDeg * Math.PI) / 180;

    const earthDistance = 8; // Compressed distance for overview
    this.earthMesh.position.set(
      Math.cos(earthElRad) * Math.sin(earthAzRad) * earthDistance,
      Math.sin(earthElRad) * earthDistance,
      Math.cos(earthElRad) * Math.cos(earthAzRad) * earthDistance,
    );

    // Set camera position based on view mode
    if (this.viewMode === "site-level") {
      // Site-level: camera close to surface, looking out
      const camDistance = MOON_RADIUS_KM * OVERVIEW_SCALE * 1.05;
      this.targetSpherical.radius = camDistance;
      this.targetSpherical.phi = Math.PI / 4; // 45 degrees elevation
    } else {
      // Overview: show all bodies
      this.targetSpherical.radius = 5;
      this.targetSpherical.phi = Math.PI / 3;
    }
  }

  public update(site: LunarSite, skyState: SkyState) {
    this.site = site;
    this.skyState = skyState;
    this.updateView();
  }

  public setViewMode(mode: "overview" | "site-level") {
    this.viewMode = mode;
    this.updateView();
  }

  private animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    // Smooth camera movement
    this.spherical.radius += (this.targetSpherical.radius - this.spherical.radius) * 0.1;
    this.spherical.theta += (this.targetSpherical.theta - this.spherical.theta) * 0.1;
    this.spherical.phi += (this.targetSpherical.phi - this.spherical.phi) * 0.1;

    // Auto-rotate when not dragging
    if (!this.isDragging) {
      this.targetSpherical.theta += 0.001;
    }

    // Update camera position
    this.camera.position.setFromSpherical(this.spherical);
    this.camera.lookAt(0, 0, 0);

    // Rotate Earth slowly
    this.earthMesh.rotation.y += 0.002;

    // Pulse site marker
    const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.2;
    this.siteMarker.scale.setScalar(pulse);

    this.renderer.render(this.scene, this.camera);
  }

  public resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
