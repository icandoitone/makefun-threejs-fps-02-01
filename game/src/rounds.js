// The match: rounds, money, the buy economy and the bomb. One place owns the phase,
// the timer and the wallet, so the HUD and the bots always read the same truth.
// Economy (per round): win +$3250, loss +$1900, kill +$300, plant +$300, defuse +$300.
// First to 5 rounds takes the match; at most 9 rounds are played.
import * as THREE from 'three';

export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const BOMB_TIME = 35;
export const ROUND_END_TIME = 5;
export const ROUNDS_TO_WIN = 5;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const OBJECTIVE_REWARD = 300;

export function createMatch(hooks) {
  const match = {
    phase: 'menu',
    round: 1,
    scoreA: 0,
    scoreB: 0,
    timer: 0,
    money: 800,
    bomb: {
      state: 'none', // carried | dropped | planted | none
      site: null,
      carrier: null, // 'player' or a bot object
      position: new THREE.Vector3(),
      left: 0,
    },
    stats: { kills: 0, deaths: 0, plants: 0, defuses: 0, earned: 0 },
    lastReason: '',
    winner: null,
  };

  function setPhase(phase, timer) {
    match.phase = phase;
    match.timer = timer;
    hooks.onPhase(phase);
  }

  function earn(amount) {
    match.money += amount;
    match.stats.earned += amount;
    hooks.onMoney(match.money);
  }

  return {
    state: match,
    resetMatch() {
      match.round = 1;
      match.scoreA = 0;
      match.scoreB = 0;
      match.money = 800;
      match.stats = { kills: 0, deaths: 0, plants: 0, defuses: 0, earned: 0 };
      match.winner = null;
      match.lastReason = '';
      this.startBuy();
    },
    startBuy() {
      match.bomb = { state: 'carried', site: null, carrier: 'player', position: new THREE.Vector3(), left: 0 };
      setPhase('buy', BUY_TIME);
      hooks.onRound(match.round);
    },
    startLive() {
      setPhase('live', ROUND_TIME);
    },
    endRound(winner, reason) {
      if (match.phase !== 'live') return;
      match.lastReason = reason;
      if (winner === 'A') {
        match.scoreA += 1;
        earn(WIN_REWARD);
      } else {
        match.scoreB += 1;
        earn(LOSS_REWARD);
      }
      hooks.onRoundEnd(winner, reason, match.scoreA, match.scoreB);
      match.bomb.state = 'none';
      if (match.scoreA >= ROUNDS_TO_WIN || match.scoreB >= ROUNDS_TO_WIN || match.round >= 9) {
        match.winner = match.scoreA > match.scoreB ? 'A' : 'B';
        setPhase('matchEnd', 0);
        hooks.onMatchEnd(match.winner);
      } else {
        setPhase('roundEnd', ROUND_END_TIME);
      }
    },
    nextRound() {
      match.round += 1;
      this.startBuy();
    },
    awardKill(killerTeam, killerIsPlayer) {
      if (killerIsPlayer) {
        match.stats.kills += 1;
        earn(KILL_REWARD);
      }
    },
    awardPlant() {
      match.stats.plants += 1;
      earn(OBJECTIVE_REWARD);
    },
    awardDefuse() {
      match.stats.defuses += 1;
      earn(OBJECTIVE_REWARD);
    },
    playerDied() {
      match.stats.deaths += 1;
    },
    buy(price) {
      if (match.money < price) return false;
      match.money -= price;
      hooks.onMoney(match.money);
      return true;
    },
    // --- Bomb ---
    dropBomb(position) {
      if (match.bomb.state !== 'carried') return;
      match.bomb.state = 'dropped';
      match.bomb.carrier = null;
      match.bomb.position.copy(position);
      hooks.onBombDrop(position);
    },
    pickupBomb(bot) {
      if (match.bomb.state !== 'dropped') return false;
      match.bomb.state = 'carried';
      match.bomb.carrier = bot;
      bot.hasBomb = true;
      hooks.onBombPickup(bot);
      return true;
    },
    plantBomb(site, planterIsPlayer, position) {
      if (match.bomb.state !== 'carried') return false;
      match.bomb.state = 'planted';
      match.bomb.site = site;
      match.bomb.left = BOMB_TIME;
      if (position) match.bomb.position.set(position.x, 0, position.z);
      if (planterIsPlayer) this.awardPlant();
      hooks.onBombPlanted(site);
      return true;
    },
    defuseBomb(defuserIsPlayer) {
      if (match.bomb.state !== 'planted') return false;
      match.bomb.state = 'none';
      match.bomb.site = null;
      if (defuserIsPlayer) this.awardDefuse();
      hooks.onBombDefused();
      return true;
    },
    tick(dt) {
      if (match.phase === 'buy') {
        match.timer -= dt;
        if (match.timer <= 0) this.startLive();
      } else if (match.phase === 'live') {
        match.timer -= dt;
        if (match.bomb.state === 'planted') {
          match.bomb.left -= dt;
          hooks.onBombTick(match.bomb.left);
          if (match.bomb.left <= 0) {
            hooks.onBombExplode(match.bomb.site);
            this.endRound('A', 'The charge detonated');
            return;
          }
        }
        if (match.timer <= 0 && match.phase === 'live') {
          this.endRound('B', 'Time expired — the charge was never planted');
        }
      } else if (match.phase === 'roundEnd') {
        match.timer -= dt;
        if (match.timer <= 0) this.nextRound();
      }
    },
  };
}
