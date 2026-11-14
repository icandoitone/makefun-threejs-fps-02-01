// The HE Charge: a thrown grenade with a real arc, one bounce, a 2.6 s fuse and a
// radial blast. Damage falls off with distance and is blocked by walls between the
// blast and the victim.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 14;
const FUSE = 2.6;
const BLAST_RADIUS = 9;
const BLAST_DAMAGE = 130;

export function createGrenades(scene, world, hooks) {
  const live = [];
  const flashes = [];
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.5 });
  const ballGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.95, depthWrite: false });
  const flashGeo = new THREE.SphereGeometry(1, 16, 12);
  const probe = new THREE.Box3();

  function overlaps(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }

  function explode(g) {
    scene.remove(g.mesh);
    const flash = new THREE.Mesh(flashGeo, flashMat.clone());
    flash.position.copy(g.position);
    flash.scale.setScalar(0.4);
    scene.add(flash);
    flashes.push({ mesh: flash, life: 0.35 });
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 22, 1.4);
    light.position.copy(g.position);
    scene.add(light);
    flashes.push({ mesh: light, life: 0.3, isLight: true });
    hooks.onExplosion(g.position, BLAST_RADIUS, BLAST_DAMAGE, g.owner);
  }

  return {
    count: 0,
    throwGrenade(origin, direction, owner) {
      if (this.count <= 0) return false;
      this.count -= 1;
      const mesh = new THREE.Mesh(ballGeo, grenadeMat);
      mesh.position.copy(origin);
      scene.add(mesh);
      const velocity = direction.clone().multiplyScalar(13);
      velocity.y += 3.4;
      live.push({ mesh, position: mesh.position, velocity, fuse: FUSE, bounced: false, owner });
      return true;
    },
    step(dt) {
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const g = live[i];
        g.velocity.y -= GRAVITY * dt;
        const nx = g.position.x + g.velocity.x * dt;
        const ny = g.position.y + g.velocity.y * dt;
        const nz = g.position.z + g.velocity.z * dt;
        let hit = overlaps(nx, g.position.y, g.position.z);
        if (hit) { g.velocity.x *= -0.35; g.velocity.z *= 0.7; }
        else g.position.x = nx;
        hit = overlaps(g.position.x, g.position.y, nz);
        if (hit) { g.velocity.z *= -0.35; g.velocity.x *= 0.7; }
        else g.position.z = nz;
        hit = overlaps(g.position.x, ny, g.position.z);
        if (hit) {
          if (ny <= 0.1) {
            g.position.y = 0.09;
            g.velocity.y = Math.abs(g.velocity.y) > 2 ? -g.velocity.y * 0.4 : 0;
            g.velocity.x *= 0.7;
            g.velocity.z *= 0.7;
          } else {
            g.velocity.y = -g.velocity.y * 0.35;
          }
        } else {
          g.position.y = ny;
        }
        if (g.position.y < 0.09) { g.position.y = 0.09; g.velocity.y = 0; }
        g.fuse -= dt;
        if (g.fuse <= 0) {
          explode(g);
          live.splice(i, 1);
        }
      }
      for (let i = flashes.length - 1; i >= 0; i -= 1) {
        const f = flashes[i];
        f.life -= dt;
        if (f.life <= 0) {
          scene.remove(f.mesh);
          if (f.isLight) f.mesh.dispose?.();
          flashes.splice(i, 1);
          continue;
        }
        if (f.isLight) f.mesh.intensity = 60 * (f.life / 0.3);
        else f.mesh.scale.setScalar(0.4 + (0.35 - f.life) * 22);
      }
    },
    reset() {
      for (const g of live) scene.remove(g.mesh);
      live.length = 0;
      for (const f of flashes) scene.remove(f.mesh);
      flashes.length = 0;
    },
  };
}
