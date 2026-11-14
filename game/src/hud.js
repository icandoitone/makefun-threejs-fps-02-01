// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill feed,
// squad list, buy menu, channel bars and the overlays. It never touches the simulation;
// main.js pushes numbers in and reads callbacks out.
const COPY = {
  start: {
    title: 'Emberline Protocol',
    copy: 'A round-based tactical FPS in the Foundry Yard. Plant the charge at Site A or Site B — or eliminate the Ember crew. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'Emberline Protocol',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  dead: {
    title: 'You are down',
    copy: 'Your squad fights on. The round continues without you.',
    action: 'Keep watching',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const overlayScore = $('overlay-score');
  const ammoEl = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadesEl = $('grenades');
  const healthNum = $('health-num');
  const healthBar = $('health-bar').querySelector('i');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const scope = $('scope');
  const damage = $('damage');
  const timerEl = $('timer');
  const scoreA = $('score-a');
  const scoreB = $('score-b');
  const phaseLabel = $('phase-label');
  const bombStatus = $('bomb-status');
  const moneyEl = $('money');
  const aliveA = $('alive-a');
  const aliveB = $('alive-b');
  const killfeed = $('killfeed');
  const squadEl = $('squad');
  const bannerEl = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const channelEl = $('channel');
  const channelLabel = $('channel-label');
  const channelBar = $('channel-bar').querySelector('i');
  const hintEl = $('hint');
  const buyEl = $('buy');
  const buyMoney = $('buy-money');
  const buyTimer = $('buy-timer');
  const shopEl = $('shop');

  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastGrenades = -1;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScoreA = -1;
  let lastScoreB = -1;

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setAmmo(mag, reserve, name, grenadeCount) {
      if (mag !== lastMag || reserve !== lastReserve || name !== lastWeapon) {
        lastMag = mag;
        lastReserve = reserve;
        lastWeapon = name;
        ammoMag.textContent = String(mag);
        ammoReserve.textContent = reserve === Infinity ? ' / ∞' : ` / ${reserve}`;
        weaponName.textContent = name;
        ammoEl.classList.toggle('empty', mag === 0);
      }
      if (grenadeCount !== lastGrenades) {
        lastGrenades = grenadeCount;
        grenadesEl.textContent = `HE Charge × ${grenadeCount} — press G`;
      }
    },
    setHealth(hp) {
      const value = Math.max(0, Math.ceil(hp));
      if (value === lastHealth) return;
      lastHealth = value;
      healthNum.textContent = String(value);
      healthNum.classList.toggle('low', value <= 30);
      healthBar.style.width = `${value}%`;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyEl.textContent = `$${value}`;
    },
    setScore(a, b) {
      if (a === lastScoreA && b === lastScoreB) return;
      lastScoreA = a;
      lastScoreB = b;
      scoreA.textContent = String(a);
      scoreB.textContent = String(b);
    },
    setTimer(seconds) {
      const text = fmtTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerEl.textContent = text;
      timerEl.classList.toggle('low', seconds <= 10);
    },
    setPhase(text) {
      phaseLabel.textContent = text;
    },
    setBomb(text, planted) {
      bombStatus.textContent = text;
      bombStatus.classList.toggle('planted', planted);
    },
    setAlive(a, b) {
      aliveA.textContent = `${a} alive`;
      aliveB.textContent = `${b} alive`;
    },
    setSquad(mates) {
      squadEl.innerHTML = mates.map((m) => (
        `<div class="mate${m.alive ? '' : ' dead'}${m.you ? ' you' : ''}"><span>${m.name}</span><span class="bar"><i style="width:${Math.max(0, m.hp)}%"></i></span><span>${m.alive ? Math.max(0, Math.ceil(m.hp)) : '✕'}</span></div>`
      )).join('');
    },
    killFeed(killer, killerTeam, victim, victimTeam, headshot, weapon) {
      const li = document.createElement('li');
      const kc = killerTeam === 'A' ? 'a' : 'b';
      const vc = victimTeam === 'A' ? 'a' : 'b';
      li.innerHTML = `<span class="${kc}">${killer}</span> ${headshot ? '<span class="hs">◉</span> ' : ''}[${weapon}] <span class="${vc}">${victim}</span>`;
      killfeed.prepend(li);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      setTimeout(() => li.remove(), 9000);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on'), holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damage.classList.remove('on'), 140);
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    setScoped(on) {
      scope.classList.toggle('on', on);
      crosshair.classList.toggle('scoped', on);
    },
    banner(titleText, subText, kind = '') {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      bannerEl.className = `on ${kind}`;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerEl.classList.remove('on'), 3200);
    },
    clearBanner() {
      clearTimeout(bannerTimer);
      bannerEl.classList.remove('on');
    },
    channel(label, progress) {
      if (progress === null) {
        channelEl.classList.remove('on');
        return;
      }
      channelEl.classList.add('on');
      channelLabel.textContent = label;
      channelBar.style.width = `${Math.round(progress * 100)}%`;
    },
    hint(text) {
      if (text) {
        hintEl.textContent = text;
        hintEl.classList.add('on');
      } else {
        hintEl.classList.remove('on');
      }
    },
    showOverlay(mode, scoreText = '', copyText = '') {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = copyText || text.copy;
      play.textContent = text.action;
      overlayScore.innerHTML = scoreText;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    showBuy(items, money, secondsLeft, onBuy) {
      buyMoney.textContent = `$${money}`;
      buyTimer.textContent = `${Math.ceil(secondsLeft)}s`;
      shopEl.innerHTML = '';
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `shop-item${item.owned ? ' owned' : ''}`;
        button.disabled = item.owned || money < item.price;
        button.innerHTML = `<span class="name">${item.name}</span><span class="desc">${item.desc}</span><span class="price">${item.owned ? 'Owned' : '$' + item.price}</span><span class="key">Press ${item.key}</span>`;
        button.addEventListener('click', () => onBuy(item.id));
        shopEl.appendChild(button);
      }
      buyEl.classList.add('on');
    },
    updateBuy(money, secondsLeft) {
      buyMoney.textContent = `$${money}`;
      buyTimer.textContent = `${Math.ceil(secondsLeft)}s`;
    },
    hideBuy() {
      buyEl.classList.remove('on');
    },
    buyOpen() {
      return buyEl.classList.contains('on');
    },
  };
}
