// The armoury: five weapons with distinct roles, prices and feel. The module owns the
// numbers, the ammo, the view model and the scope; main.js owns the ray and the damage.
// Accuracy is a resource: spread grows with movement and with sustained fire, and the
// scoped rifle is only steady when the shooter is still and scoped.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = [
  {
    id: 'pistol', key: '1', name: 'P9 Sidearm', price: 0, slot: 'sidearm',
    desc: 'Reliable sidearm. Free, always in your holster.',
    damage: 34, headMult: 4, mag: 12, reserve: Infinity, fireGap: 0.14, auto: false,
    reloadTime: 1.4, spreadStill: 0.004, spreadMove: 0.03, pellets: 1, zoom: 1,
    kick: 0.03, range: 60,
  },
  {
    id: 'rifle', key: '2', name: 'VK-7 Carbine', price: 2700, slot: 'primary',
    desc: 'The workhorse rifle. Accurate in short bursts, wild when sprayed.',
    damage: 33, headMult: 4, mag: 25, reserve: 75, fireGap: 0.1, auto: true,
    reloadTime: 2.2, spreadStill: 0.0025, spreadMove: 0.026, pellets: 1, zoom: 1,
    kick: 0.05, range: 80,
  },
  {
    id: 'smg', key: '3', name: 'Hornet-9 SMG', price: 1500, slot: 'primary',
    desc: 'Fast and close. Melts at short range, sprays wide at distance.',
    damage: 26, headMult: 4, mag: 32, reserve: 96, fireGap: 0.075, auto: true,
    reloadTime: 1.9, spreadStill: 0.005, spreadMove: 0.03, pellets: 1, zoom: 1,
    kick: 0.035, range: 55,
  },
  {
    id: 'shotgun', key: '4', name: 'Breacher-12', price: 1200, slot: 'primary',
    desc: 'Eight pellets per shell. Devastating up close, a peashooter past 15 m.',
    damage: 13, headMult: 2, mag: 6, reserve: 24, fireGap: 0.85, auto: false,
    reloadTime: 2.6, spreadStill: 0.02, spreadMove: 0.035, pellets: 8, zoom: 1,
    kick: 0.09, range: 30,
  },
  {
    id: 'dmr', key: '5', name: 'Longshot DMR', price: 4750, slot: 'primary',
    desc: 'One shot, one kill on a still target. Right-click to scope; hold still.',
    damage: 88, headMult: 4, mag: 5, reserve: 15, fireGap: 1.1, auto: false,
    reloadTime: 3.0, spreadStill: 0.0008, spreadMove: 0.05, pellets: 1, zoom: 2.6,
    kick: 0.11, range: 120,
  },
];

export const GRENADE_PRICE = 300;

const BLOOM_PER_SHOT = 0.011;
const BLOOM_DECAY = 0.09;

export function createWeaponSystem(camera, audio) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0e1013'), roughness: 0.6, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.2 });

  // One view model per weapon, built from boxes; only the selected one is visible.
  function buildModel(def) {
    const model = new THREE.Group();
    const add = (w, h, d, x, y, z, mat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      model.add(mesh);
      return mesh;
    };
    if (def.id === 'pistol') {
      add(0.07, 0.09, 0.24, 0, 0.01, -0.08, body);
      add(0.06, 0.12, 0.07, 0, -0.05, 0.05, grip);
      add(0.02, 0.02, 0.05, 0, 0.065, -0.18, accent);
    } else if (def.id === 'rifle') {
      add(0.09, 0.1, 0.42, 0, 0, -0.05, body);
      add(0.045, 0.045, 0.4, 0, 0.025, -0.42, dark);
      add(0.075, 0.08, 0.22, 0, -0.02, 0.28, grip);
      add(0.06, 0.14, 0.1, 0, -0.07, -0.02, grip);
      add(0.03, 0.03, 0.06, 0, 0.06, -0.2, accent);
    } else if (def.id === 'smg') {
      add(0.08, 0.09, 0.34, 0, 0, -0.02, body);
      add(0.04, 0.04, 0.26, 0, 0.02, -0.3, dark);
      add(0.05, 0.16, 0.05, 0, -0.08, -0.16, grip);
      add(0.06, 0.07, 0.16, 0, -0.02, 0.2, grip);
    } else if (def.id === 'shotgun') {
      add(0.09, 0.11, 0.5, 0, 0, -0.08, dark);
      add(0.07, 0.07, 0.52, 0, 0.03, -0.1, body);
      add(0.06, 0.12, 0.12, 0, -0.06, 0.12, grip);
      add(0.05, 0.05, 0.2, 0, -0.045, -0.3, accent);
    } else {
      add(0.09, 0.1, 0.55, 0, 0, -0.1, body);
      add(0.05, 0.05, 0.45, 0, 0.03, -0.5, dark);
      add(0.07, 0.07, 0.14, 0, 0.09, -0.05, dark); // scope tube
      add(0.08, 0.03, 0.1, 0, 0.055, -0.05, accent); // scope glass glint
      add(0.07, 0.07, 0.2, 0, -0.02, 0.3, grip);
      add(0.05, 0.12, 0.08, 0, -0.07, 0.02, grip);
    }
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    return model;
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const models = {};
  for (const def of WEAPONS) models[def.id] = buildModel(def);

  const owned = new Set(['pistol']);
  const ammo = {};
  for (const def of WEAPONS) ammo[def.id] = { mag: def.mag, reserve: def.reserve };

  const state = {
    current: 'pistol',
    cooldown: 0,
    reloadLeft: 0,
    reloadTotal: 1,
    flash: 0,
    kick: 0,
    bloom: 0,
    scoped: false,
    switchLeft: 0,
  };

  function def() {
    return WEAPONS.find((w) => w.id === state.current);
  }

  function showModel() {
    for (const id of Object.keys(models)) models[id].visible = id === state.current;
  }
  showModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switchLeft = Math.max(0, state.switchLeft - dt);
    state.bloom = Math.max(0, state.bloom - BLOOM_DECAY * dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const progress = 1 - state.reloadLeft / state.reloadTotal;
      model.rotation.x = -0.55 * Math.sin(progress * Math.PI);
      if (state.reloadLeft === 0) {
        const d = def();
        const need = d.mag - ammo[d.id].mag;
        const take = Math.min(need, ammo[d.id].reserve);
        ammo[d.id].mag += take;
        if (ammo[d.id].reserve !== Infinity) ammo[d.id].reserve -= take;
        audio.reloadDone();
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  return {
    state,
    def,
    owned,
    step,
    currentAmmo() {
      return ammo[state.current];
    },
    ammoFor(id) {
      return ammo[id];
    },
    scoped() {
      return state.scoped && def().zoom > 1;
    },
    setScoped(on) {
      if (def().zoom <= 1) on = false;
      if (on === state.scoped) return;
      state.scoped = on;
      if (on) audio.scope();
    },
    ready() {
      const a = ammo[state.current];
      return a.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switchLeft === 0;
    },
    pullTrigger() {
      const d = def();
      state.cooldown = d.fireGap;
      state.flash = 0.06;
      state.kick = d.kick;
      state.bloom = Math.min(0.05, state.bloom + BLOOM_PER_SHOT);
      audio.shot(d.id);
    },
    takeRound() {
      const a = ammo[state.current];
      if (a.mag <= 0) return false;
      a.mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      const a = ammo[d.id];
      if (state.reloadLeft > 0 || a.mag === d.mag || a.reserve === 0) return;
      state.reloadLeft = d.reloadTime;
      state.reloadTotal = d.reloadTime;
      state.scoped = false;
      audio.reloadStart();
    },
    spread(speed, crouching) {
      const d = def();
      const move = Math.min(1, speed / 5.2);
      let value = d.spreadStill + move * d.spreadMove + state.bloom;
      if (crouching) value *= 0.75;
      if (state.scoped) value *= 0.18;
      return value;
    },
    select(id) {
      if (!owned.has(id) || id === state.current) return false;
      state.current = id;
      state.scoped = false;
      state.reloadLeft = 0;
      state.switchLeft = 0.3;
      showModel();
      audio.switchWeapon();
      return true;
    },
    buy(id) {
      if (owned.has(id)) return false;
      owned.add(id);
      this.select(id);
      return true;
    },
    refillAll() {
      for (const d of WEAPONS) {
        if (!owned.has(d.id)) continue;
        ammo[d.id].mag = d.mag;
        ammo[d.id].reserve = d.reserve;
      }
      state.reloadLeft = 0;
      state.cooldown = 0;
      state.scoped = false;
    },
  };
}
