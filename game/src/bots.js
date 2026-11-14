// Bot squads: four Vanguard attackers (with the player) against five Ember defenders.
// A bot thinks in roles — push a site, hold a site, rotate to a planted bomb, pick the
// dropped charge up — and fights in bursts with a reaction delay, so a still, aiming
// player wins the duel and a sprinting one loses it. Movement follows the waypoint graph
// in world.js; combat is the same hitscan every gun uses.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOT_NAMES_A = ['Rook', 'Havoc', 'Sable', 'Wren'];
const BOT_NAMES_B = ['Cinder', 'Ash', 'Flint', 'Smolder', 'Ember'];
const HEALTH = 100;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const EYE_HEIGHT = 1.5;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;

const TEAM_COLORS = {
  A: new THREE.Color('#3fa7d6'),
  B: new THREE.Color('#e05d44'),
};

export function createBotManager(scene, world, hooks) {
  const bots = [];
  const probe = new THREE.Box3();
  const tmpVec = new THREE.Vector3();

  function overlaps(x, y, z, height) {
    probe.min.set(x - BOT_RADIUS, y + 0.04, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, y + height - 0.04, z + BOT_RADIUS);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function buildBot(name, team, weaponId) {
    const group = new THREE.Group();
    const teamMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], roughness: 0.6, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
    const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 0.18), darkMat);
    legL.position.set(-0.11, 0.375, 0);
    const legR = legL.clone();
    legR.position.x = 0.11;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.3), teamMat);
    torso.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10), skinMat);
    head.position.y = 1.62;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.34), teamMat);
    band.position.y = 1.68;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.6), darkMat);
    gun.position.set(0.22, 1.25, -0.25);
    group.add(legL, legR, torso, head, band, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
    });
    scene.add(group);
    const bot = {
      id: `${team}-${name}`,
      name,
      team,
      weaponId,
      group,
      torso,
      head,
      position: new THREE.Vector3(),
      yaw: 0,
      health: HEALTH,
      alive: true,
      speed: 3.5 + hooks.rng() * 0.9,
      role: team === 'A' ? 'push' : 'hold',
      site: team === 'A' ? (hooks.rng() < 0.5 ? 'A' : 'B') : (hooks.rng() < 0.5 ? 'A' : 'B'),
      path: [],
      pathIndex: 0,
      target: null,
      targetIsPlayer: false,
      reactionLeft: 0,
      burstLeft: 0,
      burstPause: 0,
      thinkLeft: 0,
      channel: null, // { kind: 'plant'|'defuse', left: number, total: number }
      holdNode: -1,
      holdUntil: 0,
      strafeDir: 1,
      strafeUntil: 0,
      alertPos: null,
      fall: 0,
      walkPhase: hooks.rng() * Math.PI * 2,
      hasBomb: false,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    return bot;
  }

  function resetBot(bot, spawn, index) {
    bot.position.set(spawn[0], 0, spawn[1]);
    bot.yaw = bot.team === 'A' ? Math.PI : 0;
    bot.health = HEALTH;
    bot.alive = true;
    bot.path = [];
    bot.pathIndex = 0;
    bot.target = null;
    bot.reactionLeft = 0;
    bot.burstLeft = 0;
    bot.burstPause = 0;
    bot.channel = null;
    bot.fall = 0;
    bot.hasBomb = false;
    bot.group.rotation.set(0, bot.yaw, 0);
    bot.group.position.copy(bot.position);
    bot.group.visible = true;
    // Attackers split across the two sites; defenders hold one site each.
    bot.site = bot.team === 'A'
      ? (index % 2 === 0 ? 'A' : 'B')
      : (index % 2 === 0 ? 'A' : 'B');
    bot.role = bot.team === 'A' ? 'push' : 'hold';
    const siteNode = world.nearestNode(world.sites[bot.site].center.x, world.sites[bot.site].center.z);
    bot.holdNode = siteNode;
  }

  function spawnRound() {
    for (const bot of bots) scene.remove(bot.group);
    bots.length = 0;
    BOT_NAMES_A.forEach((name, i) => {
      const bot = buildBot(name, 'A', i === 3 ? 'smg' : 'rifle');
      resetBot(bot, world.attackerSpawns[(i + 1) % world.attackerSpawns.length], i);
      bots.push(bot);
    });
    BOT_NAMES_B.forEach((name, i) => {
      const bot = buildBot(name, 'B', i === 0 ? 'dmr' : 'rifle');
      resetBot(bot, world.defenderSpawns[i % world.defenderSpawns.length], i);
      bots.push(bot);
    });
  }

  function setPath(bot, destNode) {
    const from = world.nearestNode(bot.position.x, bot.position.z);
    const indices = world.findPath(from, destNode);
    bot.path = indices.map((i) => world.nodes[i]);
    bot.pathIndex = 0;
  }

  function moveAlongPath(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const goal = bot.path[bot.pathIndex];
    const dx = goal.x - bot.position.x;
    const dz = goal.z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const step = bot.speed * dt;
    const nx = bot.position.x + (dx / dist) * step;
    const nz = bot.position.z + (dz / dist) * step;
    if (!overlaps(nx, 0, bot.position.z, BOT_HEIGHT)) bot.position.x = nx;
    if (!overlaps(bot.position.x, 0, nz, BOT_HEIGHT)) bot.position.z = nz;
    const targetYaw = Math.atan2(-dx, -dz);
    let diff = targetYaw - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += diff * Math.min(1, dt * 8);
    bot.walkPhase += dt * bot.speed * 2.2;
    return false;
  }

  function scanForEnemy(bot) {
    const bomb = hooks.bombState();
    const enemies = [];
    const player = hooks.playerInfo();
    if (player.alive && bot.team === 'B') {
      enemies.push({ isPlayer: true, pos: new THREE.Vector3(player.pos.x, player.pos.y + player.eye * 0.8, player.pos.z), dist: 0, speed: player.speed, crouching: player.crouching });
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      enemies.push({ isPlayer: false, bot: other, pos: new THREE.Vector3(other.position.x, other.position.y + 1.25, other.position.z), dist: 0, speed: other.speed, crouching: false });
    }
    let best = null;
    let bestScore = Infinity;
    const eye = new THREE.Vector3(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);
    for (const enemy of enemies) {
      const d = eye.distanceTo(enemy.pos);
      if (d > 48) continue;
      if (!hooks.losClear(eye, enemy.pos)) continue;
      const score = d + (enemy.crouching ? 6 : 0);
      if (score < bestScore) { bestScore = score; best = enemy; }
    }
    if (best) {
      best.dist = bestScore;
      return best;
    }
    return null;
  }

  function aimPoint(bot, enemy) {
    // Aim at the chest, sometimes the head; error grows with distance and target speed.
    const p = enemy.pos.clone();
    if (hooks.rng() < 0.16) p.y += 0.32;
    const spread = 0.016 + enemy.dist * 0.0011 + (enemy.speed || 0) * 0.004;
    p.x += (hooks.rng() * 2 - 1) * spread * enemy.dist;
    p.y += (hooks.rng() * 2 - 1) * spread * enemy.dist * 0.7;
    p.z += (hooks.rng() * 2 - 1) * spread * enemy.dist;
    return p;
  }

  function engage(bot, enemy, dt) {
    const eye = new THREE.Vector3(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);
    const aim = aimPoint(bot, enemy);
    const dx = aim.x - eye.x;
    const dy = aim.y - eye.y;
    const dz = aim.z - eye.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    bot.yaw = Math.atan2(-dir.x, -dir.z);
    // Strafe sideways while fighting so the bot is not a static target.
    if (performance.now() > bot.strafeUntil) {
      bot.strafeDir = hooks.rng() < 0.5 ? -1 : 1;
      bot.strafeUntil = performance.now() + 700 + hooks.rng() * 900;
    }
    const strafeX = Math.cos(bot.yaw) * bot.strafeDir * bot.speed * 0.45 * dt;
    const strafeZ = -Math.sin(bot.yaw) * bot.strafeDir * bot.speed * 0.45 * dt;
    if (!overlaps(bot.position.x + strafeX, 0, bot.position.z, BOT_HEIGHT)) bot.position.x += strafeX;
    if (!overlaps(bot.position.x, 0, bot.position.z + strafeZ, BOT_HEIGHT)) bot.position.z += strafeZ;

    if (bot.reactionLeft > 0) {
      bot.reactionLeft -= dt;
      return;
    }
    if (bot.burstPause > 0) {
      bot.burstPause -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(hooks.rng() * 3);
      bot.burstPause = 0;
    }
    if (bot.burstLeft > 0) {
      hooks.fireHitscan(bot, eye, dir, bot.weaponId);
      bot.burstLeft -= 1;
      if (bot.burstLeft === 0) bot.burstPause = 0.55 + hooks.rng() * 0.7;
    }
  }

  function decide(bot, now) {
    const bomb = hooks.bombState();
    bot.channel = null;
    if (bot.team === 'A') {
      if (bomb.state === 'planted') {
        // Defend the planted site from a nearby hold.
        const site = world.sites[bomb.site];
        const node = world.nearestNode(site.center.x + 2, site.center.z + 2);
        if (world.nearestNode(bot.position.x, bot.position.z) !== node && bot.pathIndex >= bot.path.length) setPath(bot, node);
        return;
      }
      if (bomb.state === 'dropped') {
        // Nearest living attacker fetches the charge.
        const carriers = bots.filter((b) => b.alive && b.team === 'A');
        const nearest = carriers.sort((a, b) => a.position.distanceTo(bomb.position) - b.position.distanceTo(bomb.position))[0];
        if (nearest === bot) {
          const node = world.nearestNode(bomb.position.x, bomb.position.z);
          if (bot.pathIndex >= bot.path.length) setPath(bot, node);
          if (bot.position.distanceTo(bomb.position) < 1.2) hooks.pickupBomb(bot);
          return;
        }
      }
      if (bot.hasBomb) {
        const site = world.sites[bot.site];
        const dist = Math.hypot(bot.position.x - site.center.x, bot.position.z - site.center.z);
        if (dist < site.radius) {
          const enemyNear = scanForEnemy(bot);
          if (!enemyNear) {
            bot.channel = { kind: 'plant', left: PLANT_TIME, total: PLANT_TIME };
            return;
          }
        }
        const node = world.nearestNode(site.center.x, site.center.z);
        if (bot.pathIndex >= bot.path.length) setPath(bot, node);
        return;
      }
      const site = world.sites[bot.site];
      const node = world.nearestNode(site.center.x, site.center.z);
      if (bot.pathIndex >= bot.path.length) setPath(bot, node);
    } else {
      if (bomb.state === 'planted') {
        const site = world.sites[bomb.site];
        const dist = Math.hypot(bot.position.x - site.center.x, bot.position.z - site.center.z);
        if (dist < site.radius && !scanForEnemy(bot)) {
          bot.channel = { kind: 'defuse', left: DEFUSE_TIME, total: DEFUSE_TIME };
          return;
        }
        const node = world.nearestNode(site.center.x, site.center.z);
        if (bot.pathIndex >= bot.path.length) setPath(bot, node);
        return;
      }
      // Hold the assigned site; drift between two hold nodes so the defence is not static.
      if (now > bot.holdUntil) {
        bot.holdUntil = now + 6000 + hooks.rng() * 6000;
        const site = world.sites[bot.site];
        const jitter = world.nearestNode(
          site.center.x + (hooks.rng() * 6 - 3),
          site.center.z + (hooks.rng() * 6 - 3),
        );
        if (bot.pathIndex >= bot.path.length) setPath(bot, jitter);
      }
    }
  }

  function step(dt, now) {
    if (!hooks.isLive()) return;
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.4);
          bot.group.rotation.x = -bot.fall * 1.45;
        }
        continue;
      }
      bot.thinkLeft -= dt;
      if (bot.thinkLeft <= 0) {
        bot.thinkLeft = 0.15;
        decide(bot, now);
      }
      // Combat overrides movement: an enemy in sight stops the push.
      const enemy = scanForEnemy(bot);
      if (enemy) {
        if (bot.target !== enemy.bot && !enemy.isPlayer) bot.reactionLeft = 0.35 + hooks.rng() * 0.35;
        if (bot.target !== enemy.bot && enemy.isPlayer) bot.reactionLeft = 0.35 + hooks.rng() * 0.35;
        bot.target = enemy.isPlayer ? 'player' : enemy.bot;
        bot.channel = null;
        engage(bot, enemy, dt);
      } else {
        bot.target = null;
        if (bot.channel) {
          bot.channel.left -= dt;
          if (bot.channel.kind === 'plant' && bot.channel.left <= 0) hooks.onPlantComplete(bot.site, bot);
          if (bot.channel.kind === 'defuse' && bot.channel.left <= 0) hooks.onDefuseComplete(bot);
          hooks.onChannel(bot, bot.channel);
        } else {
          moveAlongPath(bot, dt);
        }
      }
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      // Simple walk cycle: legs swing while moving.
      const moving = bot.pathIndex < bot.path.length || bot.target;
      if (moving) {
        bot.walkPhase += dt * 9;
        bot.group.children[0].rotation.x = Math.sin(bot.walkPhase) * 0.5;
        bot.group.children[1].rotation.x = -Math.sin(bot.walkPhase) * 0.5;
      } else {
        bot.group.children[0].rotation.x = 0;
        bot.group.children[1].rotation.x = 0;
      }
    }
  }

  return {
    bots,
    spawnRound,
    step,
    hitMeshes() {
      const meshes = [];
      for (const bot of bots) if (bot.alive) meshes.push(bot.torso, bot.head);
      return meshes;
    },
    aliveCounts() {
      let a = 0;
      let b = 0;
      for (const bot of bots) {
        if (!bot.alive) continue;
        if (bot.team === 'A') a += 1; else b += 1;
      }
      return { a, b };
    },
    aliveBots() {
      return bots.filter((b) => b.alive);
    },
    damage(bot, amount) {
      if (!bot.alive) return false;
      bot.health -= amount;
      if (bot.health > 0) return false;
      bot.alive = false;
      bot.fall = 0;
      bot.channel = null;
      return true;
    },
    hearShot(position) {
      for (const bot of bots) {
        if (!bot.alive || bot.team !== 'B') continue;
        if (bot.position.distanceTo(position) < 18) {
          bot.alertPos = position.clone();
          if (bot.pathIndex >= bot.path.length) {
            const node = world.nearestNode(position.x, position.z);
            setPath(bot, node);
          }
        }
      }
    },
    reset() {
      for (const bot of bots) scene.remove(bot.group);
      bots.length = 0;
    },
  };
}
