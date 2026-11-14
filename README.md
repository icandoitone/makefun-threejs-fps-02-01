# Emberline Protocol

A round-based tactical FPS that runs offline from static files, built on three.js 0.187.0.
One player plus four Vanguard bots against five Ember bots in the Foundry Yard — a
three-lane map with two bomb sites. First to 5 rounds takes the match.

## How a round works

- **Buy phase (15 s):** spend the money you earned on rifles, an SMG, a shotgun, a
  scoped DMR, or HE Charges. Press **B** to open the shop.
- **Live round (100 s):** plant the charge at Site A or Site B (hold **E** inside a
  site) or eliminate the Ember crew. If the charge is planted, it detonates after 35 s
  unless a defender defuses it (hold the site for 5 s). If time runs out unplanted,
  the defenders take the round.
- **Money:** win +$3250, loss +$1900, kill +$300, plant +$300, defuse +$300.
- **Gunplay:** spread and recoil punish firing on the move — stop, crouch and aim.
  Headshots deal 4× damage (2× for the shotgun). The Longshot DMR scopes with
  right-click and is only steady when you are still.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Click | Fire (hold for automatics) |
| Right-click | Scope (Longshot DMR) |
| R | Reload |
| B | Buy menu (buy phase) |
| 1–5 | Select weapon |
| G | Throw HE Charge |
| E | Plant the charge (hold, inside a site) |
| Ctrl / C | Crouch |
| Space | Jump |
| Shift | Walk (quieter, steadier aim) |

## Bots

Both squads follow the map's waypoint graph: attackers push a site in a split, the
bomb carrier plants when the site is clear, defenders hold their site and rotate to a
planted bomb to defuse. Bots fight in bursts with a reaction delay, strafe while
engaging, and turn toward gunfire they hear nearby.

## Running it

No build step, no network. Serve `game/` with any static server and open `index.html`:

```sh
node serve.ts        # serves game/ at http://localhost:8080
```

Or: `python3 -m http.server --directory game 8080`.

## Files

- `game/index.html` — the page and HUD
- `game/src/main.js` — boot, the fixed-step loop, shooting, bomb channels
- `game/src/world.js` — the Foundry Yard map and waypoint graph
- `game/src/bots.js` — bot squads and AI
- `game/src/rounds.js` — match state, economy, bomb
- `game/src/weapons.js` — the five guns, view models, spread and scope
- `game/src/grenades.js` — the HE Charge
- `game/src/audio.js` — synthesized WebAudio sounds (no audio files)
- `game/src/hud.js` — the DOM HUD and buy menu
- `game/src/player.js`, `game/src/input.js`, `game/src/palette.js` — movement, input, palette
- `game/vendor/three/` — three.js 0.187.0, vendored as the kit ships it

Screenshots: `?shot=start|play|bomb|end&seed=1` stages a deterministic frame for capture.
`?selftest=1` runs a scripted play-through and reports it in `window.__selftest`.

## License

MIT — see `LICENSE`.
