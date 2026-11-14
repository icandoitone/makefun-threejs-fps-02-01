// Emberline Protocol: boot and the one loop. A fixed 60 Hz simulation feeds a render at
// the display's rate. The match (rounds.js) owns phase and money; the bots (bots.js) own
// the squads; this file owns the player, the shooting, the bomb channels and the HUD.
// ?shot=start|play|bomb|end with &seed=N stages a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady. ?selftest=1 runs a
// scripted play-through and reports it in window.__selftest.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { WEAPONS, GRENADE_PRICE, createWeaponSystem } from './weapons.js';
import { createBotManager } from './bots.js';
import { createMatch, BUY_TIME, ROUND_TIME } from './rounds.js';
import { createGrenades } from './grenades.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const selftest = params.get('selftest') === '1';
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = shot ? mulberry32(seed) : Math.random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 80);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const weapons = createWeaponSystem(camera, audio);
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
const losRaycaster = new THREE.Raycaster();
const body = player.state;

let health = 100;
let playerAlive = true;
let frozen = false;
let started = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let plantProgress = 0;
let lastBeepSecond = -1;
let stepCount = 0;
let lastFootstep = 0;
let fovTarget = 74;

// Invisible hitboxes for the player so bot shots use the same raycast as the player's.
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.1, 0.4), hitMat);
const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), hitMat);
playerTorso.userData.part = 'torso';
playerHead.userData.part = 'head';
playerTorso.userData.isPlayer = true;
playerHead.userData.isPlayer = true;
scene.add(playerTorso, playerHead);

function syncPlayerHitboxes() {
  playerTorso.position.set(body.position.x, body.position.y + 1.1, body.position.z);
  playerHead.position.set(body.position.x, body.position.y + (body.crouching ? 1.0 : 1.62), body.position.z);
}

// Tracer pool: lines from a muzzle to a hit point, fading in 60 ms.
const tracers = [];
{
  const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85 });
  for (let i = 0; i < 24; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
}
let tracerIndex = 0;
function addTracer(from, to) {
  const tracer = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  tracer.line.geometry.setFromPoints([from, to]);
  tracer.line.visible = true;
  tracer.line.material.opacity = 0.85;
  tracer.life = 0.06;
}

// Impact flash: a small sphere that pops at a wall hit.
const impacts = [];
{
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false });
  for (let i = 0; i < 12; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat.clone());
    mesh.visible = false;
    scene.add(mesh);
    impacts.push({ mesh, life: 0 });
  }
}
let impactIndex = 0;
function addImpact(point) {
  const impact = impacts[impactIndex];
  impactIndex = (impactIndex + 1) % impacts.length;
  impact.mesh.position.copy(point);
  impact.mesh.visible = true;
  impact.mesh.material.opacity = 0.9;
  impact.life = 0.12;
}

// The bomb: a blinking device when planted, a dropped charge when lost.
const bombMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.5, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.6 });
const bombDevice = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), bombMat);
bombDevice.visible = false;
scene.add(bombDevice);
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6, 1.5);
scene.add(bombLight);

const match = createMatch({
  onPhase,
  onMoney: (value) => hud.setMoney(value),
  onRound: (n) => hud.setPhase(`Round ${n} — Foundry Yard`),
  onRoundEnd: (winner, reason) => {
    hud.banner(winner === 'A' ? 'Round won' : 'Round lost', reason, winner === 'A' ? 'win' : 'lose');
    if (winner === 'A') audio.roundWin(); else audio.roundLose();
    bombDevice.visible = false;
    bombLight.intensity = 0;
    hud.channel(null, null);
    hud.hint(null);
  },
  onMatchEnd: (winner) => {
    const m = match.state;
    const scoreText = `<b>Vanguard ${m.scoreA} — ${m.scoreB} Ember</b> · Kills ${m.stats.kills} · Deaths ${m.stats.deaths} · Plants ${m.stats.plants}`;
    hud.showOverlay('matchEnd', scoreText, winner === 'A'
      ? 'The Foundry Yard is yours. Vanguard takes the match.'
      : 'The Ember crew takes the match. The yard stays theirs — for now.');
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onBombPlanted: (site) => {
    hud.banner('Charge planted', `Site ${site} — defend it until it blows`, 'win');
    audio.bombPlanted();
    bombDevice.position.set(match.state.bomb.position.x, 0.12, match.state.bomb.position.z);
    bombDevice.visible = true;
  },
  onBombDefused: () => {
    bombDevice.visible = false;
    bombLight.intensity = 0;
    hud.banner('Charge defused', 'The Ember crew saved the site', 'lose');
  },
  onBombDrop: (position) => {
    bombDevice.position.set(position.x, 0.12, position.z);
    bombDevice.visible = true;
    hud.hint('The charge is down — a teammate will fetch it');
  },
  onBombPickup: () => {
    bombDevice.visible = false;
    hud.hint(null);
  },
  onBombTick: (left) => {
    hud.setBomb(`Charge planted — detonates in ${Math.ceil(left)}s`, true);
    const whole = Math.ceil(left);
    if (whole !== lastBeepSecond) {
      lastBeepSecond = whole;
      audio.bombBeep();
    }
  },
  onBombExplode: () => {
    audio.explosion();
    bombDevice.visible = false;
    bombLight.intensity = 0;
    hud.setBomb('', false);
    blastDamage(match.state.bomb.position, 12, 200);
  },
});

const grenades = createGrenades(scene, world, {
  onExplosion: (position, radius, damage, owner) => {
    audio.explosion();
    blastDamage(position, radius, damage);
  },
});

function blastDamage(position, radius, damage) {
  // Everyone in the radius with a clear line from the blast takes falloff damage.
  const targets = [];
  if (playerAlive) targets.push({ pos: new THREE.Vector3(body.position.x, body.position.y + 1.1, body.position.z), isPlayer: true });
  for (const bot of bots.aliveBots()) targets.push({ pos: bot.position.clone().setY(bot.position.y + 1.1), bot });
  for (const target of targets) {
    const dist = position.distanceTo(target.pos);
    if (dist > radius) continue;
    if (!losClear(position, target.pos)) continue;
    const amount = Math.round(damage * (1 - (dist / radius) * 0.7));
    if (target.isPlayer) damagePlayer(amount, null, false);
    else if (target.bot) killBotIfDead(target.bot, amount, null, false);
  }
}

const bots = createBotManager(scene, world, {
  rng,
  isLive: () => match.state.phase === 'live',
  playerInfo: () => ({
    pos: body.position,
    eye: body.eye,
    alive: playerAlive,
    speed: player.groundSpeed(),
    crouching: body.crouching,
  }),
  losClear,
  bombState: () => match.state.bomb,
  pickupBomb: (bot) => match.pickupBomb(bot),
  onPlantComplete: (site, bot) => {
    if (match.plantBomb(site, false, bot.position)) {
      hud.killFeed(bot.name, 'A', `Site ${site}`, 'B', false, 'Charge');
    }
  },
  onDefuseComplete: (bot) => {
    if (match.defuseBomb(false)) {
      hud.killFeed(bot.name, 'B', 'Charge', 'A', false, 'Defuse');
      match.endRound('B', `${bot.name} defused the charge`);
    }
  },
  onChannel: (bot, channel) => {
    if (channel.kind === 'plant' && stepCount % 30 === 0) audio.plantBeep();
    if (channel.kind === 'defuse' && stepCount % 36 === 0) audio.defuseBeep();
  },
  fireHitscan: (shooter, origin, dir, weaponId) => botShoot(shooter, origin, dir, weaponId),
});

function losClear(a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const dist = dir.length();
  if (dist < 0.01) return true;
  dir.normalize();
  losRaycaster.set(a, dir);
  losRaycaster.far = dist;
  const hit = losRaycaster.intersectObjects(world.shootables, false)[0];
  return !hit;
}

function allShootables() {
  return world.shootables.concat(bots.hitMeshes(), playerAlive ? [playerTorso, playerHead] : []);
}

function resolveHit(origin, dir, range, shooterBot) {
  raycaster.set(origin, dir);
  raycaster.far = range;
  const hits = raycaster.intersectObjects(allShootables(), false);
  for (const candidate of hits) {
    // Never hit your own body: the ray starts inside it.
    if (shooterBot && candidate.object.userData.bot === shooterBot) continue;
    if (!shooterBot && candidate.object.userData.isPlayer) continue;
    return { point: candidate.point.clone(), hit: candidate };
  }
  return { point: origin.clone().addScaledVector(dir, range), hit: null };
}

function damageFor(def, part, dist) {
  let amount = def.damage * (part === 'head' ? def.headMult : 1);
  if (def.id === 'shotgun' && dist > 12) amount *= Math.max(0.25, 1 - (dist - 12) / 25);
  return amount;
}

function killBotIfDead(bot, amount, killerName, headshot) {
  const died = bots.damage(bot, amount);
  if (!died) return false;
  const killerTeam = 'A'; // killBotIfDead is only called for the player's kills
  hud.killFeed(killerName || 'Unknown', killerTeam, bot.name, 'B', headshot, killerName === 'You' ? weapons.def().name : 'VK-7 Carbine');
  if (killerName === 'You') {
    match.awardKill('A', true);
    audio.kill();
  }
  if (bot.hasBomb) {
    bot.hasBomb = false;
    match.dropBomb(bot.position);
  }
  checkElimination();
  return true;
}

function damagePlayer(amount, sourceBot, headshot) {
  if (!playerAlive || match.state.phase !== 'live') return;
  health -= amount;
  hud.setHealth(health);
  hud.damageFlash();
  audio.hurt();
  if (health > 0) return;
  playerAlive = false;
  health = 0;
  match.playerDied();
  const killer = sourceBot ? sourceBot.name : 'The blast';
  hud.killFeed(killer, 'B', 'You', 'A', headshot, sourceBot ? 'VK-7 Carbine' : 'Blast');
  if (match.state.bomb.carrier === 'player') {
    match.state.bomb.carrier = null;
    match.dropBomb(body.position);
  }
  hud.showOverlay('dead');
  if (document.pointerLockElement) document.exitPointerLock();
  checkElimination();
}

function checkElimination() {
  if (match.state.phase !== 'live') return;
  const counts = bots.aliveCounts();
  const aliveA = counts.a + (playerAlive ? 1 : 0);
  const aliveB = counts.b;
  if (aliveB === 0) {
    match.endRound('A', 'Ember crew eliminated');
    return;
  }
  if (aliveA === 0 && match.state.bomb.state !== 'planted') {
    match.endRound('B', 'Vanguard eliminated');
  }
}

function muzzleWorld() {
  return camera.localToWorld(new THREE.Vector3(0.24, -0.18, -0.95));
}

function playerShoot() {
  const def = weapons.def();
  if (!weapons.takeRound()) {
    audio.dry();
    return;
  }
  const spread = weapons.spread(player.groundSpeed(), body.crouching);
  let hitAny = false;
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    camera.getWorldDirection(tmpDir);
    tmpDir.x += (rng() * 2 - 1) * spread;
    tmpDir.y += (rng() * 2 - 1) * spread;
    tmpDir.z += (rng() * 2 - 1) * spread;
    tmpDir.normalize();
    scene.updateMatrixWorld(true);
    const { point, hit } = resolveHit(camera.position, tmpDir, def.range, null);
    addTracer(muzzleWorld(), point);
    if (hit) {
      if (hit.object.userData.bot) {
        const bot = hit.object.userData.bot;
        const dist = camera.position.distanceTo(point);
        const died = killBotIfDead(bot, damageFor(def, hit.object.userData.part, dist), 'You', hit.object.userData.part === 'head');
        hud.hitMarker(died, 4000);
        if (!died) audio.hit();
        hitAny = true;
      } else {
        addImpact(point);
      }
    }
  }
  weapons.pullTrigger();
  player.recoil(def.kick * (weapons.scoped() ? 0.5 : 1) + rng() * 0.004, (rng() * 2 - 1) * 0.004);
  bots.hearShot(body.position);
  hud.setAmmo(weapons.currentAmmo().mag, weapons.currentAmmo().reserve, def.name, grenades.count);
  return hitAny;
}

const tmpDir = new THREE.Vector3();
function botShoot(shooter, origin, dir, weaponId) {
  const def = WEAPONS.find((w) => w.id === weaponId) || WEAPONS[1];
  const spread = 0.02 + rng() * 0.008;
  const jittered = dir.clone();
  jittered.x += (rng() * 2 - 1) * spread;
  jittered.y += (rng() * 2 - 1) * spread;
  jittered.z += (rng() * 2 - 1) * spread;
  jittered.normalize();
  scene.updateMatrixWorld(true);
  const { point, hit } = resolveHit(origin, jittered, def.range, shooter);
  addTracer(origin, point);
  if (!hit) return;
  if (hit.object.userData.bot) {
    const victim = hit.object.userData.bot;
    if (victim.team === shooter.team) return;
    const dist = origin.distanceTo(point);
    const died = bots.damage(victim, damageFor(def, hit.object.userData.part, dist));
    if (died) {
      hud.killFeed(shooter.name, shooter.team, victim.name, victim.team, hit.object.userData.part === 'head', def.name);
      if (victim.hasBomb) {
        victim.hasBomb = false;
        match.dropBomb(victim.position);
      }
      checkElimination();
    }
  } else if (hit.object.userData.isPlayer) {
    const dist = origin.distanceTo(point);
    damagePlayer(damageFor(def, hit.object.userData.part, dist), shooter, hit.object.userData.part === 'head');
  } else {
    addImpact(point);
  }
}

function respawnRound() {
  bots.spawnRound();
  body.position.set(0, 0, 13.5);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  body.crouching = false;
  health = 100;
  playerAlive = true;
  plantProgress = 0;
  weapons.refillAll();
  grenades.reset();
  bombDevice.visible = false;
  bombLight.intensity = 0;
  hud.setHealth(health);
  hud.setAmmo(weapons.currentAmmo().mag, weapons.currentAmmo().reserve, weapons.def().name, grenades.count);
  hud.setBomb('', false);
  hud.channel(null, null);
  hud.hint(null);
  syncCamera();
}

function onPhase(phase) {
  if (phase === 'buy') {
    respawnRound();
    hud.setPhase(`Round ${match.state.round} — Buy phase`);
    hud.setTimer(BUY_TIME);
    hud.setScore(match.state.scoreA, match.state.scoreB);
    hud.banner(`Round ${match.state.round}`, 'Buy what you need — the round starts soon');
    openBuy();
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (phase === 'live') {
    hud.hideBuy();
    hud.setPhase(`Round ${match.state.round} — Live`);
    hud.setTimer(ROUND_TIME);
    hud.banner(`Round ${match.state.round}`, match.state.bomb.carrier === 'player' ? 'You carry the charge — plant it at Site A or Site B' : 'Eliminate the Ember crew or plant the charge', 'win');
  } else if (phase === 'roundEnd') {
    hud.hideBuy();
    hud.setPhase(`Round ${match.state.round} — Round over`);
  } else if (phase === 'matchEnd') {
    hud.hideBuy();
  }
}

function shopItems() {
  const items = WEAPONS.map((w) => ({
    id: w.id,
    name: w.name,
    desc: w.desc,
    price: w.price,
    key: w.key,
    owned: weapons.owned.has(w.id),
  }));
  items.push({
    id: 'he',
    name: 'HE Charge',
    desc: 'A thrown explosive. Arc it over cover; 2.6 s fuse.',
    price: GRENADE_PRICE,
    key: 'G',
    owned: false,
  });
  return items;
}

function openBuy() {
  hud.showBuy(shopItems(), match.state.money, match.state.timer, buyHandler);
}
const buyHandler = (id) => {
  const item = shopItems().find((i) => i.id === id);
  if (!item) return;
  if (!match.buy(item.price)) {
    audio.denied();
    return;
  }
  if (id === 'he') grenades.count += 1;
  else weapons.buy(id);
  audio.buy();
  hud.setAmmo(weapons.currentAmmo().mag, weapons.currentAmmo().reserve, weapons.def().name, grenades.count);
  hud.showBuy(shopItems(), match.state.money, match.state.timer, buyHandler);
};

function onLockChange(locked) {
  if (shot || selftest) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.hideBuy();
  } else if (match.state.phase === 'live' && playerAlive) {
    hud.showOverlay('paused');
  } else if (match.state.phase === 'buy') {
    openBuy();
  }
}

hud.onPlay(() => {
  if (shot || selftest) return;
  audio.unlock();
  if (match.state.phase === 'menu') {
    match.resetMatch();
  } else if (match.state.phase === 'matchEnd') {
    match.resetMatch();
  } else if (match.state.phase === 'live' && !playerAlive) {
    hud.hideOverlay();
    return;
  }
  input.requestLock();
});

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function step(dt) {
  elapsed += dt;
  stepCount += 1;
  match.tick(dt);

  // Player movement, only while alive and the round is live (or buying).
  if (playerAlive && (match.state.phase === 'live' || match.state.phase === 'buy')) {
    player.step(dt, input.state.keys);
    if (input.state.keys.has('ShiftLeft') || input.state.keys.has('ShiftRight')) {
      body.velocity.x *= 0.55;
      body.velocity.z *= 0.55;
    }
    const speed = player.groundSpeed();
    if (speed > 1 && body.onGround) {
      lastFootstep += dt * speed;
      if (lastFootstep > 2.2) {
        lastFootstep = 0;
        audio.footstep();
      }
    }
  }
  weapons.step(dt);
  grenades.step(dt);
  bots.step(dt, performance.now());

  // Scope: right mouse button while the DMR is out.
  const wantScope = scopedHeld && weapons.def().zoom > 1 && match.state.phase === 'live';
  weapons.setScoped(wantScope);
  fovTarget = weapons.scoped() ? 74 / weapons.def().zoom : 74;
  if (Math.abs(camera.fov - fovTarget) > 0.1) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  hud.setScoped(weapons.scoped());

  // Plant channel: hold E while carrying the charge inside a site.
  if (playerAlive && match.state.phase === 'live' && match.state.bomb.carrier === 'player') {
    const site = inSite(body.position);
    if (site && input.state.keys.has('KeyE')) {
      plantProgress += dt / 3;
      hud.channel('Planting the charge…', Math.min(1, plantProgress));
      if (stepCount % 30 === 0) audio.plantBeep();
      if (plantProgress >= 1) {
        plantProgress = 0;
        hud.channel(null, null);
        match.plantBomb(site, true, body.position);
      }
    } else {
      if (plantProgress > 0) hud.channel(null, null);
      plantProgress = 0;
      if (site) hud.hint('Hold E to plant the charge');
      else if (match.state.bomb.state === 'planted') hud.hint('Defend the planted charge');
      else hud.hint(null);
    }
  } else if (plantProgress > 0) {
    plantProgress = 0;
    hud.channel(null, null);
  }

  // Tracers and impacts fade.
  for (const tracer of tracers) {
    if (tracer.life > 0) {
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.06) * 0.85;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
  }
  for (const impact of impacts) {
    if (impact.life > 0) {
      impact.life -= dt;
      impact.mesh.material.opacity = Math.max(0, impact.life / 0.12) * 0.9;
      if (impact.life <= 0) impact.mesh.visible = false;
    }
  }
  // Bomb blink.
  if (bombDevice.visible && match.state.bomb.state === 'planted') {
    const blink = Math.sin(elapsed * 6) > 0;
    bombMat.emissiveIntensity = blink ? 1.6 : 0.2;
    bombLight.intensity = blink ? 8 : 0;
    bombLight.position.copy(bombDevice.position).setY(0.5);
  }

  syncPlayerHitboxes();
  updateHud(dt);
}

let hudThrottle = 0;
let prevFiring = false;
let prevGrenade = false;
let scopedHeld = false;

// Right mouse button holds the scope; the starter input module only tracks the left.
window.addEventListener('mousedown', (event) => {
  if (event.button === 2) scopedHeld = true;
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 2) scopedHeld = false;
});
window.addEventListener('contextmenu', (event) => event.preventDefault());
function updateHud(dt) {
  hudThrottle += dt;
  if (hudThrottle < 0.25) {
    hud.setTimer(match.state.timer);
    hud.setCrosshairGap(2 + weapons.spread(player.groundSpeed(), body.crouching) * 900);
    return;
  }
  hudThrottle = 0;
  hud.setTimer(match.state.timer);
  hud.setScore(match.state.scoreA, match.state.scoreB);
  hud.setMoney(match.state.money);
  hud.setHealth(health);
  hud.setAmmo(weapons.currentAmmo().mag, weapons.currentAmmo().reserve, weapons.def().name, grenades.count);
  hud.setCrosshairGap(2 + weapons.spread(player.groundSpeed(), body.crouching) * 900);
  const counts = bots.aliveCounts();
  hud.setAlive(counts.a + (playerAlive ? 1 : 0), counts.b);
  const mates = [{ name: 'You', hp: health, alive: playerAlive, you: true }];
  for (const bot of bots.bots) {
    if (bot.team === 'A') mates.push({ name: bot.name, hp: bot.health, alive: bot.alive, you: false });
  }
  hud.setSquad(mates);
  if (match.state.phase === 'buy' && hud.buyOpen()) hud.updateBuy(match.state.money, match.state.timer);
  if (match.state.bomb.state === 'planted') hud.setBomb(`Charge planted — detonates in ${Math.ceil(match.state.bomb.left)}s`, true);
  else if (match.state.bomb.state === 'dropped') hud.setBomb('Charge dropped — a teammate will fetch it', false);
  else if (match.state.bomb.carrier === 'player') hud.setBomb('You carry the charge', false);
  else hud.setBomb('', false);
}

function inSite(position) {
  for (const key of ['A', 'B']) {
    const site = world.sites[key];
    if (Math.hypot(position.x - site.center.x, position.z - site.center.z) < site.radius) return key;
  }
  return null;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    if (match.state.phase === 'live' && playerAlive) {
      const firingEdge = input.state.firing && !prevFiring;
      prevFiring = input.state.firing;
      const firing = input.state.firing && (weapons.def().auto || firingEdge);
      if (firing && weapons.ready()) playerShoot();
      if (input.state.keys.has('KeyR')) weapons.reload();
      const grenadePressed = input.state.keys.has('KeyG') && !prevGrenade;
      prevGrenade = input.state.keys.has('KeyG');
      if (grenadePressed && grenades.count > 0) {
        camera.getWorldDirection(tmpDir);
        if (grenades.throwGrenade(camera.position.clone(), tmpDir.clone(), 'player')) {
          audio.switchWeapon();
          hud.setAmmo(weapons.currentAmmo().mag, weapons.currentAmmo().reserve, weapons.def().name, grenades.count);
        }
      }
      for (const def of WEAPONS) {
        if (input.state.keys.has(`Digit${def.key}`)) weapons.select(def.id);
      }
    }
    if (match.state.phase === 'buy' && input.state.keys.has('KeyB') && !hud.buyOpen()) openBuy();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  if (name === 'start') {
    body.position.set(0.6, 0, 13);
    body.yaw = 0.15;
    body.pitch = -0.02;
    match.state.phase = 'menu';
    bots.spawnRound();
    settle(30);
    hud.showOverlay('start');
    hud.setScore(0, 0);
    hud.setMoney(800);
    hud.setHealth(100);
    hud.setAmmo(12, Infinity, 'P9 Sidearm', 0);
  } else if (name === 'play') {
    match.resetMatch();
    match.startLive();
    body.position.set(0, 0, 6);
    body.yaw = 0;
    body.pitch = 0;
    settle(30);
    // Stage a duel at the mid door: an enemy bot holds the doorway.
    const enemy = bots.bots.find((b) => b.team === 'B');
    enemy.position.set(0, 0, -5.5);
    enemy.yaw = Math.PI;
    enemy.group.position.copy(enemy.position);
    enemy.group.rotation.y = enemy.yaw;
    aimAt(new THREE.Vector3(0, 1.3, -5.5));
    weapons.buy('rifle');
    weapons.refillAll();
    for (let i = 0; i < 4; i += 1) {
      playerShoot();
      settle(6);
    }
    settle(20);
  } else if (name === 'bomb') {
    match.resetMatch();
    match.startLive();
    body.position.set(-13, 0, -6);
    body.yaw = 0.5;
    body.pitch = 0;
    settle(20);
    match.state.bomb.state = 'planted';
    match.state.bomb.site = 'A';
    match.state.bomb.left = 32;
    match.state.bomb.position.set(-15.5, 0, -9);
    bombDevice.position.set(-15.5, 0.12, -9);
    bombDevice.visible = true;
    hud.setBomb('Charge planted — detonates in 32s', true);
    const enemy = bots.bots.find((b) => b.team === 'B');
    enemy.position.set(-12, 0, -10);
    enemy.yaw = Math.PI * 0.75;
    enemy.group.position.copy(enemy.position);
    enemy.group.rotation.y = enemy.yaw;
    aimAt(new THREE.Vector3(-12, 1.3, -10));
    settle(30);
  } else {
    // end: the match is over, Vanguard takes it 5–3.
    match.state.scoreA = 5;
    match.state.scoreB = 3;
    match.state.winner = 'A';
    match.state.phase = 'matchEnd';
    match.state.stats.kills = 11;
    match.state.stats.deaths = 2;
    match.state.stats.plants = 2;
    bots.spawnRound();
    body.position.set(0, 0, 8);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    hud.showOverlay('matchEnd', '<b>Vanguard 5 — 3 Ember</b> · Kills 11 · Deaths 2 · Plants 2',
      'The Foundry Yard is yours. Vanguard takes the match.');
    hud.setScore(5, 3);
    match.state.money = 4100;
  }
  hud.setScore(match.state.scoreA, match.state.scoreB);
  hud.setMoney(match.state.money);
  hud.setHealth(health);
  hud.setAmmo(weapons.currentAmmo().mag, weapons.currentAmmo().reserve, weapons.def().name, grenades.count);
  hud.clearBanner();
  paintTwiceThenReady();
}

// Debug handle for the headless play-test: drive the game from CDP without a mouse.
window.__game = {
  match,
  bots,
  weapons,
  grenades,
  player,
  world,
  state() {
    return {
      phase: match.state.phase,
      round: match.state.round,
      scoreA: match.state.scoreA,
      scoreB: match.state.scoreB,
      money: match.state.money,
      health,
      playerAlive,
      bomb: match.state.bomb.state,
      bombSite: match.state.bomb.site,
      aliveA: bots.aliveCounts().a + (playerAlive ? 1 : 0),
      aliveB: bots.aliveCounts().b,
      weapon: weapons.def().id,
      mag: weapons.currentAmmo().mag,
    };
  },
  startMatch() { match.resetMatch(); },
  startLive() { match.startLive(); },
  teleport(x, z, yaw = 0) {
    body.position.set(x, 0, z);
    body.yaw = yaw;
    body.pitch = 0;
    syncCamera();
  },
  setHealth(value) {
    health = value;
    hud.setHealth(health);
  },
  // Advance the fixed-step simulation without rendering: used by the headless
  // soak test to play whole rounds in seconds instead of minutes.
  fastForward(seconds) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
    syncCamera();
    return this.state();
  },
  aimAtBot(index = 0) {
    const enemy = bots.aliveBots().find((b) => b.team === 'B');
    if (!enemy) return false;
    aimAt(new THREE.Vector3(enemy.position.x, enemy.position.y + 1.3, enemy.position.z));
    return true;
  },
  shootOnce() { return playerShoot(); },
  plantNow() {
    const site = inSite(body.position);
    if (!site) return false;
    return match.plantBomb(site, true, body.position);
  },
  endRoundNow(winner, reason) { match.endRound(winner, reason); },
  buyWeapon(id) {
    const def = WEAPONS.find((w) => w.id === id);
    if (!def || !match.buy(def.price)) return false;
    weapons.buy(id);
    return true;
  },
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyB' && match.state.phase === 'buy') {
    if (hud.buyOpen()) hud.hideBuy();
    else openBuy();
    event.preventDefault();
  }
  if (event.code === 'Escape' && hud.buyOpen() && match.state.phase === 'buy') hud.hideBuy();
});

syncCamera();
hud.setScore(0, 0);
hud.setMoney(800);
hud.setHealth(100);
hud.setAmmo(12, Infinity, 'P9 Sidearm', 0);
if (shot) runShot(shot);
else if (selftest) runSelftest();
else requestAnimationFrame(frame);

function runSelftest() {
  const results = [];
  function check(name, ok) {
    results.push({ name, ok: !!ok });
  }
  try {
    match.resetMatch();
    check('match starts in buy phase', match.state.phase === 'buy');
    check('bots spawned', bots.bots.length === 9);
    check('money starts at 800', match.state.money === 800);
    weapons.buy('rifle');
    check('rifle bought and selected', weapons.def().id === 'rifle');
    match.startLive();
    check('round goes live', match.state.phase === 'live');
    const spawnZ = bots.bots.map((b) => b.position.z);
    settle(60);
    check('bots moved from spawn', bots.bots.some((b, i) => Math.abs(b.position.z - spawnZ[i]) > 0.5 || Math.abs(b.position.x) > 0.5));
    // Teleport in front of a defender and shoot it. God-mode health so the
    // return fire does not end the test early by dropping the charge.
    const enemy = bots.bots.find((b) => b.team === 'B');
    window.__game.setHealth(1000);
    body.position.set(enemy.position.x, 0, enemy.position.z + 6);
    body.yaw = 0;
    body.pitch = 0;
    settle(5);
    aimAt(new THREE.Vector3(enemy.position.x, enemy.position.y + 1.1, enemy.position.z));
    const hpBefore = enemy.health;
    for (let i = 0; i < 6 && enemy.alive; i += 1) {
      playerShoot();
      settle(6);
    }
    check('player shot damaged a bot', enemy.health < hpBefore);
    // Plant the charge at Site A.
    body.position.set(-15.5, 0, -9);
    settle(5);
    check('bomb planted', window.__game.plantNow() === true);
    check('bomb state planted', match.state.bomb.state === 'planted');
    settle(60);
    check('bomb timer ticks down', match.state.bomb.left < 35);
    // Force the round to end and the next buy phase to start.
    match.endRound('A', 'selftest');
    check('round ended with score', match.state.scoreA === 1);
    settle(5 * 60 + 5);
    check('next round buy phase', match.state.phase === 'buy' && match.state.round === 2);
    check('player respawned alive', playerAlive && health === 100);
  } catch (error) {
    results.push({ name: `error: ${error.message}`, ok: false });
  }
  const passed = results.every((r) => r.ok);
  window.__selftest = { passed, results };
  document.title = passed ? 'SELFTEST PASS' : 'SELFTEST FAIL';
  const pre = document.createElement('pre');
  pre.id = 'selftest-results';
  pre.textContent = JSON.stringify(results, null, 1);
  document.body.appendChild(pre);
  paintTwiceThenReady();
}
