// Every sound is synthesized with WebAudio: filtered noise bursts, sine drops and
// short blips. No audio files are shipped, so the game stays fully offline and the
// sounds are the game's own.
export function createAudio() {
  let ctx = null;
  let noiseBuffer = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    ctx = new AudioContextClass();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noise(duration, filterFreq, type, gainValue, decay = 0.001) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(decay, t + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + duration);
  }

  function tone(freq, duration, type, gainValue, slideTo = null, delay = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  const SHOT_PROFILES = {
    pistol: () => { noise(0.09, 2400, 'lowpass', 0.5); tone(190, 0.07, 'square', 0.16, 70); },
    rifle: () => { noise(0.11, 1800, 'lowpass', 0.6); tone(150, 0.09, 'sawtooth', 0.18, 55); },
    smg: () => { noise(0.07, 3000, 'bandpass', 0.42); tone(210, 0.05, 'square', 0.12, 90); },
    shotgun: () => { noise(0.22, 900, 'lowpass', 0.85); tone(110, 0.16, 'sawtooth', 0.28, 40); },
    dmr: () => { noise(0.2, 1400, 'lowpass', 0.8); tone(120, 0.18, 'sawtooth', 0.26, 38); },
  };

  return {
    unlock() { ensure(); },
    shot(id) { (SHOT_PROFILES[id] || SHOT_PROFILES.rifle)(); },
    dry() { tone(900, 0.04, 'square', 0.08); },
    reloadStart() { tone(500, 0.05, 'square', 0.1); tone(320, 0.05, 'square', 0.1, null, 0.12); },
    reloadDone() { tone(700, 0.06, 'square', 0.14); tone(980, 0.06, 'square', 0.12, null, 0.07); },
    switchWeapon() { noise(0.05, 1200, 'bandpass', 0.15); },
    scope() { tone(1200, 0.05, 'sine', 0.1, 1800); },
    hit() { tone(1400, 0.05, 'sine', 0.18); },
    kill() { tone(880, 0.08, 'sine', 0.2); tone(1320, 0.1, 'sine', 0.18, null, 0.08); },
    hurt() { noise(0.12, 500, 'lowpass', 0.4); tone(90, 0.14, 'sine', 0.22, 55); },
    footstep() { noise(0.05, 400, 'lowpass', 0.07); },
    click() { tone(1000, 0.03, 'square', 0.08); },
    buy() { tone(660, 0.07, 'sine', 0.16); tone(990, 0.09, 'sine', 0.16, null, 0.07); },
    denied() { tone(220, 0.12, 'square', 0.14, 160); },
    plantBeep() { tone(1100, 0.09, 'sine', 0.2); },
    bombBeep() { tone(1250, 0.06, 'sine', 0.16); },
    bombPlanted() { tone(440, 0.12, 'sawtooth', 0.2); tone(440, 0.12, 'sawtooth', 0.2, null, 0.16); tone(880, 0.2, 'sawtooth', 0.2, null, 0.32); },
    defuseBeep() { tone(1500, 0.05, 'sine', 0.14); },
    explosion() {
      noise(1.1, 300, 'lowpass', 1.0);
      tone(70, 0.9, 'sine', 0.5, 28);
      noise(0.4, 2500, 'highpass', 0.3);
    },
    roundWin() {
      tone(523, 0.14, 'sine', 0.2);
      tone(659, 0.14, 'sine', 0.2, null, 0.14);
      tone(784, 0.22, 'sine', 0.22, null, 0.28);
    },
    roundLose() {
      tone(392, 0.16, 'sine', 0.2);
      tone(330, 0.16, 'sine', 0.2, null, 0.16);
      tone(262, 0.3, 'sine', 0.2, null, 0.32);
    },
  };
}
