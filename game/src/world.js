// Foundry Yard: an original three-lane map with two bomb sites. Attackers spawn south,
// defenders north. A divider wall with three doors (west, mid, east) splits the map; a
// central spine wall separates Site A (west) from Site B (east) in the north half.
// Everything is plain boxes and one canvas-drawn letter per site — no borrowed art.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints the bot graph is built from. Edges are added at build time between nearby
// nodes whose straight line does not cross a tall collider.
const NODES = [
  [-8, 13], [0, 13.5], [8, 13], [-4, 12], [4, 12],
  [-14, 8], [-5, 8], [5, 8], [14, 8],
  [-3, 3], [0, 3], [3, 3],
  [-11, -2], [0, -2], [11, -2],
  [-3, -5], [0, -6.5], [3, -5], [-6, -8], [6, -8],
  [-14, -5], [-16, -9], [-11, -11], [-15, -12.5],
  [14, -5], [16, -9], [11, -11], [15, -12.5],
  [-8, -13], [0, -13.5], [8, -13],
];

const SITE_A = { name: 'A', center: new THREE.Vector3(-15.5, 0, -9), radius: 3.6, color: '#e05d44' };
const SITE_B = { name: 'B', center: new THREE.Vector3(15.5, 0, -9), radius: 3.6, color: '#3fa7d6' };

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const siteAMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(SITE_A.color), roughness: 0.6, metalness: 0.1, emissive: new THREE.Color(SITE_A.color), emissiveIntensity: 0.25 });
  const siteBMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(SITE_B.color), roughness: 0.6, metalness: 0.1, emissive: new THREE.Color(SITE_B.color), emissiveIntensity: 0.25 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Floor and outer walls: 40 x 30 m, 5 m high.
  box(40.4, 0.4, 30.4, 0, -0.2, 0, mats.canvas);
  box(0.4, 5, 30.4, -20.2, 2.5, 0, mats.surface);
  box(0.4, 5, 30.4, 20.2, 2.5, 0, mats.surface);
  box(40.4, 5, 0.4, 0, 2.5, -15.2, mats.surface);
  box(40.4, 5, 0.4, 0, 2.5, 15.2, mats.surface);

  // Divider wall at z = -2 with three doors: west [-13,-9], mid [-7,7], east [9,13].
  for (const [x0, x1] of [[-20, -13], [-9, -7], [7, 9], [13, 20]]) {
    box(x1 - x0, 4.2, 0.6, (x0 + x1) / 2, 2.1, -2, mats.surface);
  }
  // Lintels over the doors so the openings read as doorways.
  for (const [x0, x1] of [[-13, -9], [-7, 7], [9, 13]]) {
    box(x1 - x0, 1.4, 0.6, (x0 + x1) / 2, 3.5, -2, mats.hairline);
  }

  // Central spine wall in the north half, separating the two sites; it stops at z = -8
  // so the sites connect through the north corridor behind it.
  box(0.6, 4.2, 7, 0, 2.1, -11.5, mats.surface);

  // Site A structures: a container stack, crates and a low wall for cover.
  box(4.2, 2.4, 2.2, -17.5, 1.2, -12.5, mats.hairline);
  box(4.2, 1.2, 2.2, -17.5, 3.0, -12.5, mats.muted);
  box(1.6, 1.1, 1.6, -12.5, 0.55, -11.5, mats.hairline);
  box(1.6, 1.1, 1.6, -13.5, 0.55, -6.5, mats.hairline);
  box(3.4, 1.0, 0.8, -11, 0.5, -13.5, mats.hairline);
  // Site B mirrors A.
  box(4.2, 2.4, 2.2, 17.5, 1.2, -12.5, mats.hairline);
  box(4.2, 1.2, 2.2, 17.5, 3.0, -12.5, mats.muted);
  box(1.6, 1.1, 1.6, 12.5, 0.55, -11.5, mats.hairline);
  box(1.6, 1.1, 1.6, 13.5, 0.55, -6.5, mats.hairline);
  box(3.4, 1.0, 0.8, 11, 0.5, -13.5, mats.hairline);

  // South half cover: crates and pillars so the spawn side is not a bare field.
  box(1.8, 1.1, 1.8, -10, 0.55, 8, mats.hairline);
  box(1.8, 1.1, 1.8, 10, 0.55, 8, mats.hairline);
  box(2.4, 0.9, 1.2, 0, 0.45, 10, mats.hairline);
  box(1.2, 3.4, 1.2, -14, 1.7, 4, mats.surface);
  box(1.2, 3.4, 1.2, 14, 1.7, 4, mats.surface);
  box(1.2, 3.4, 1.2, -6, 1.7, -5.5, mats.surface);
  box(1.2, 3.4, 1.2, 6, 1.7, -5.5, mats.surface);
  // Mid-door cover crates, low enough to shoot over while crouched behind.
  box(1.4, 1.0, 1.4, -3.2, 0.5, -0.6, mats.hairline);
  box(1.4, 1.0, 1.4, 3.2, 0.5, -0.6, mats.hairline);
  // Defender spawn cover.
  box(2.2, 1.0, 1.2, -4, 0.5, -13.2, mats.hairline);
  box(2.2, 1.0, 1.2, 4, 0.5, -13.2, mats.hairline);

  // Site floor plates and letter signs (canvas-drawn, generated at runtime).
  function sitePlate(site, material) {
    const plate = box(6.4, 0.06, 6.4, site.center.x, 0.03, site.center.z, material, false);
    plate.castShadow = false;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#14161a';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = site.color;
    ctx.font = 'bold 190px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(site.name, 128, 138);
    const texture = new THREE.CanvasTexture(canvas);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: texture, transparent: false }),
    );
    sign.position.set(site.center.x, 3.1, -14.9);
    group.add(sign);
  }
  sitePlate(SITE_A, siteAMat);
  sitePlate(SITE_B, siteBMat);

  // Emissive strip lights along the site walls so each site reads at a glance.
  const stripA = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(SITE_A.color) }));
  stripA.position.set(-15.5, 4.2, -14.9);
  const stripB = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(SITE_B.color) }));
  stripB.position.set(15.5, 4.2, -14.9);
  group.add(stripA, stripB);

  // Light: warm key, cool fill, sky gradient; one soft point light per site.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 1.55);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.6);
  key.position.set(9, 15, 8);
  key.target.position.set(0, 0, -3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 55;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.7);
  fill.position.set(-9, 10, 11);
  scene.add(fill);
  const lightA = new THREE.PointLight(new THREE.Color(SITE_A.color), 12, 14, 1.6);
  lightA.position.set(-15.5, 3.4, -9);
  const lightB = new THREE.PointLight(new THREE.Color(SITE_B.color), 12, 14, 1.6);
  lightB.position.set(15.5, 3.4, -9);
  scene.add(lightA, lightB);

  // --- Waypoint graph: connect nearby nodes when the straight line clears tall cover.
  function segmentIntersectsRect(ax, az, bx, bz, minX, minZ, maxX, maxZ) {
    const dx = bx - ax;
    const dz = bz - az;
    let t0 = 0;
    let t1 = 1;
    for (const [p, q] of [[-dx, ax - minX], [dx, maxX - ax], [-dz, az - minZ], [dz, maxZ - az]]) {
      if (p === 0) {
        if (q < 0) return false;
      } else {
        const t = q / p;
        if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return true;
  }
  function segmentHitsTall(ax, az, bx, bz, margin) {
    for (const c of colliders) {
      if (c.max.y < 1.05) continue; // low crates: walkable around, not a path blocker
      const minX = c.min.x - margin;
      const maxX = c.max.x + margin;
      const minZ = c.min.z - margin;
      const maxZ = c.max.z + margin;
      if (segmentIntersectsRect(ax, az, bx, bz, minX, minZ, maxX, maxZ)) return true;
    }
    return false;
  }

  const nodes = NODES.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const edges = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > 10.5) continue;
      if (segmentHitsTall(a.x, a.z, b.x, b.z, 0.55)) continue;
      edges[i].push(j);
      edges[j].push(i);
    }
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  // Breadth-first path over the graph, returned as a list of node indices.
  function findPath(fromIndex, toIndex) {
    if (fromIndex === toIndex) return [toIndex];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [fromIndex];
    prev[fromIndex] = fromIndex;
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of edges[current]) {
        if (prev[next] !== -1) continue;
        prev[next] = current;
        if (next === toIndex) {
          const path = [toIndex];
          let step = current;
          while (step !== fromIndex) { path.unshift(step); step = prev[step]; }
          path.unshift(fromIndex);
          return path;
        }
        queue.push(next);
      }
    }
    return [toIndex];
  }

  return {
    colliders,
    shootables,
    group,
    nodes,
    edges,
    nearestNode,
    findPath,
    segmentHitsTall,
    sites: { A: SITE_A, B: SITE_B },
    attackerSpawns: [[-8, 13], [0, 13.5], [8, 13], [-4, 12], [4, 12]],
    defenderSpawns: [[-8, -13], [0, -13.5], [8, -13], [-4, -12], [4, -12]],
  };
}
