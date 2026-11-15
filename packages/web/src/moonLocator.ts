/**
 * 3D Moon locator — a small orthographic WebGL globe that shows the current
 * 2D map footprint inside the lunar south polar cap.
 *
 * Ported from the competition frontend (`ShabuShabu2026/Frontend`,
 * `src/components/MoonLocator.jsx`).
 */

import * as THREE from "three";
import { globePosition, unprojectSite, viewportOutline, type ViewportBox } from "./lunar-projection";
import { createLocatorCamera, fitLocatorCamera } from "./locator-camera";

export interface MoonLocatorHandle {
  readonly update: (bbox: ViewportBox) => void;
  readonly dispose: () => void;
}

export function createMoonLocator(host: HTMLElement): MoonLocatorHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }

  const node = host;
  let disposed = false;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", "3D Moon showing the current 2D map footprint");
  node.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = createLocatorCamera();
  const globeGeometry = new THREE.SphereGeometry(1, 64, 40);
  const globeMaterial = new THREE.MeshStandardMaterial({ color: 0xbebec3, roughness: 1 });
  scene.add(new THREE.Mesh(globeGeometry, globeMaterial));
  scene.add(new THREE.AmbientLight(0xffffff, 2));
  const light = new THREE.DirectionalLight(0xffffff, 1.4);
  light.position.set(-2, -4, 4);
  scene.add(light);
  const lineGeometry = new THREE.BufferGeometry();
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xb5a2ff, depthTest: true });
  scene.add(new THREE.LineLoop(lineGeometry, lineMaterial));
  const patchGeometry = new THREE.BufferGeometry();
  const patchMaterial = new THREE.MeshBasicMaterial({ color: 0x9e83ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  scene.add(new THREE.Mesh(patchGeometry, patchMaterial));
  const dotGeometry = new THREE.SphereGeometry(0.025, 12, 8);
  const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xe8dbff });
  const dot = new THREE.Mesh(dotGeometry, dotMaterial);
  scene.add(dot);

  const indicator = document.createElement("div");
  indicator.className = "locator-position-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.hidden = true;
  node.appendChild(indicator);

  const draw = (): void => {
    renderer.render(scene, camera);
    // A screen-sized ring stays legible while the real footprint shrinks on zoom.
    const point = dot.position.clone().project(camera);
    if (indicator) {
      indicator.style.left = `${(point.x + 1) * 50}%`;
      indicator.style.top = `${(1 - point.y) * 50}%`;
      indicator.hidden = false;
    }
  };

  const update = (bbox: ViewportBox): void => {
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(viewportOutline(bbox), 3));
    lineGeometry.computeBoundingSphere();
    const positions: number[] = [];
    const indices: number[] = [];
    const steps = 12;
    for (let row = 0; row <= steps; row += 1) {
      for (let col = 0; col <= steps; col += 1) {
        const { latitude, longitude } = unprojectSite(bbox.xmin + ((bbox.xmax - bbox.xmin) * col) / steps, bbox.ymax - ((bbox.ymax - bbox.ymin) * row) / steps);
        const p = globePosition(latitude, longitude, 1.006);
        positions.push(p[0], p[1], p[2]);
        if (row < steps && col < steps) {
          const a = row * (steps + 1) + col;
          const b = a + 1;
          const c = a + steps + 1;
          const d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    }
    patchGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    patchGeometry.setIndex(indices);
    patchGeometry.computeBoundingSphere();
    const middle = unprojectSite((bbox.xmin + bbox.xmax) / 2, (bbox.ymin + bbox.ymax) / 2);
    dot.position.set(...globePosition(middle.latitude, middle.longitude, 1.025));
    draw();
  };

  const resize = (): void => {
    const width = node.clientWidth;
    const height = node.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    fitLocatorCamera(camera, width / height);
    draw();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(node);
  resize();

  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 512;
  textureCanvas.height = 256;
  const textureContext = textureCanvas.getContext("2d");
  if (!textureContext) {
    observer.disconnect();
    return null;
  }
  const images = [new Image(), new Image()];
  let texture: THREE.CanvasTexture | null = null;
  const load = (): void => {
    if (disposed || !images.every((img) => img.complete && img.naturalWidth > 0)) return;
    images.forEach((img, index) => textureContext.drawImage(img, index * 256, 0, 256, 256));
    texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    globeMaterial.map = texture;
    globeMaterial.color.set(0xffffff);
    globeMaterial.needsUpdate = true;
    draw();
  };
  images.forEach((img, index) => {
    img.onload = load;
    img.src = `/moon/globe/wac-${index ? "east" : "west"}.jpg`;
  });

  return {
    update,
    dispose: () => {
      disposed = true;
      observer.disconnect();
      images.forEach((img) => {
        img.onload = null;
      });
      texture?.dispose();
      globeGeometry.dispose();
      globeMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      patchGeometry.dispose();
      patchMaterial.dispose();
      dotGeometry.dispose();
      dotMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
