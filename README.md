# Mined Worlds (Mondi Minati)

Minesweeper in 3D, one planet at a time. Three.js and plain JavaScript, no framework: the build is a static site.

**[▶ Play it in your browser](https://mondi-minati.davide-venezia.workers.dev/)**: phone or computer, nothing to install.

The game is in English and Italian. It follows the device language (Italian devices get Italian, everything else English), and the player can switch from the title screen or in Settings.

![Title screen](docs/title.webp)

| Gas Giant | Titan Cube |
| --- | --- |
| ![The ringed gas giant, halfway cleared](docs/planet.webp) | ![The Titan Cube, numbers running across its edges](docs/cube.webp) |
| **Classic '95** | **Donut, on a phone** |
| ![The classic flat field](docs/classic.webp) | <img src="docs/mobile-donut.webp" width="260" alt="The donut world on a phone"> |

## What's inside

- **A 10-world campaign**, where each shape changes the rules:
  - hex spheres: 6 neighbours, 5 on the 12 pentagons;
  - cubes: neighbours continue onto the next face, 7 on the corners;
  - a donut (torus): no edges at all, always 8 neighbours;
  - a lumpy asteroid and a ringed gas giant.
- **Classic '95**: the flat grey field on a teal background, with LED counters and the smiley (9×9, 16×16, 30×16).
- **Daily challenge**: the same planet for everyone, with an **online leaderboard** (today and yesterday, a name and nothing else: no sign-up).
- **Free play**: pick shape, size and difficulty.
- **No blind guessing**: the first move is always safe and every field is checked by a logic solver before you play it (on by default, can be turned off in Settings).
- Hints (3 per world), undo after an explosion, stars and records saved in the browser.
- Sound effects and music synthesized with WebAudio, no audio files.
- Installable from the browser (PWA) and playable offline after the first visit.

## Controls

| Action | Phone | Computer |
| --- | --- | --- |
| Dig | tap | click |
| Flag | press and hold, or the centre button | right-click, F key |
| Open the neighbours of a satisfied number | tap the number | click the number, middle-click |
| Rotate / move | drag | drag, arrow keys |
| Zoom | pinch | wheel, + and − |
| Hint / restart / pause | bottom buttons, smiley | H, R, Esc |

## Development

Needs Node 20 or later.

```bash
npm install
npm run dev      # http://localhost:5173, rebuilds on every change
npm test         # geometry, rules, solver and the leaderboard checks
npm run build    # static site in dist/
```

`npm run dev` has no server, so the daily challenge plays offline there. To try the leaderboard locally, with Cloudflare's runtime and a local database:

```bash
npx wrangler d1 execute mondi-minati --local --file=worker/schema.sql   # once
npm run dev:worker                                                        # http://localhost:8787
```

Add `?debug` to the URL to get `window.__mm` in the console (game state and game functions). Outside localhost, runs played with `?debug` are not ranked.

## Deploy

The live version runs on Cloudflare Workers, connected to this repository: every push to `main` runs `npm run build`, then `npx wrangler deploy`. [`wrangler.jsonc`](wrangler.jsonc) serves the static game from `dist/` and sends `/api/*` to the leaderboard code in `worker/`, with a D1 database.

To run your own copy:

1. `npx wrangler d1 create mondi-minati` and put the id it prints in `wrangler.jsonc`.
2. `npx wrangler d1 execute mondi-minati --remote --file=worker/schema.sql`
3. `npm run build && npx wrangler deploy`, or connect the repository in the Cloudflare dashboard (**Workers & Pages** → **Create** → **Import a repository**; build command `npm run build`, deploy command `npx wrangler deploy`).

Without the database the game still works anywhere as a static site (`dist/`): the daily challenge just isn't ranked.

`public/_headers` sets long-term caching on the hashed files (`/assets`, `/fonts`) and a few security headers.

Link previews (WhatsApp, Telegram, LinkedIn, X) use `public/og.jpg` and need absolute URLs: if you deploy somewhere else, build with `SITE_URL=https://your.domain npm run build`.

## Online leaderboard

The daily challenge has a leaderboard per day (UTC). How a result gets there:

1. **The server picks the planet.** `GET /api/daily` gives the day and a seed made with a secret key, so nobody can work out a day's planet from this public code in advance. Offline, the game builds a local planet that isn't ranked.
2. **The clock starts on the server.** At the first dig the game asks `POST /api/daily/start` for a signed token with the server's time.
3. **The run is replayed.** The game records every dig, flag and chord. The moment the field is cleared it sends them to `POST /api/daily/finish`: the server rebuilds the planet with the same code as the game (`worker/daily.js` imports `src/`), replays the moves and checks that the first dig is the glowing tile, that no mine goes off and that the field ends up cleared.
4. **The official time** is the player's own clock, but never less than what the server measured minus 2.5 s of network slack: a made-up time doesn't pass, and pauses count. Anything under 0.1 s per move is refused.
5. **The name comes last.** `/finish` returns a signed proof; `POST /api/daily/submit` puts it on the board under the player's name. The same proof can't go up under two names. The player is a random id kept in the browser: no email, no account.

Using undo after a mine makes the run unranked. There is also a limit of 60 checked runs per network per day (counted with a daily hashed key, no IP addresses are stored).

What it can't stop: the game has to know where the mines are, so someone who writes a bot can still post a fast time. Each day's board starts from zero, and a result can be removed from the D1 console in the Cloudflare dashboard:

```sql
DELETE FROM scores WHERE day = '2026-11-08' AND nick = 'Name';
```

Each day's planet is built once and kept in the database (`boards`), so checking a run is a short replay well inside the free plan's CPU limit.

## Phone app (Capacitor)

`dist/` already contains three.js and the fonts, so it also works offline inside an app.

```bash
npm i @capacitor/core @capacitor/android @capacitor/ios
npm i -D @capacitor/cli
npx cap init "Mined Worlds" com.yourdomain.minedworlds --web-dir dist
npm run build && npx cap add android && npx cap add ios && npx cap sync
```

## Project layout

| File | What it does |
| --- | --- |
| `src/main.js` | game flow, screens, input wiring, saves |
| `src/shapes.js` | board geometry (Goldberg sphere, cube, torus, asteroid, flat) with neighbours computed from shared corners |
| `src/minesweeper.js` | rules, logic solver, no-guess field generator |
| `src/render/planet.js` | every tile in one mesh animated in the shader, flags, mines, glowing core |
| `src/render/atlas.js` | numbers and icons drawn into a texture |
| `src/render/fx.js` | stars, nebula, particles |
| `src/render/map.js` | campaign map |
| `src/rig.js` | camera, trackball rotation with inertia, zoom, panning the flat board |
| `src/input.js` | tap, press and hold, right-click, pinch, wheel |
| `src/audio.js` | synthesized sound effects and music |
| `src/levels.js` | worlds, themes, game modes |
| `src/i18n.js` | English and Italian text |
| `src/ui.js` | HUD, 7-segment counters, smiley, dialogs |
| `src/sw.js` | service worker for offline play (the API is never cached) |
| `src/online.js` | leaderboard client: daily seed, run token, finish, submit |
| `src/nick.js` | rules for leaderboard names, shared with the server |
| `worker/index.js` | the API on Cloudflare Workers + D1 |
| `worker/daily.js` | rebuilds the daily planet and replays a run |
| `worker/schema.sql` | database tables |
| `wrangler.jsonc` | Cloudflare config: static files, API routes, database |
| `build.mjs` | builds `site` (Cloudflare), `artifact` (one page with three.js from a CDN) and `test` |
| `public/` | icons, PWA manifest, `_headers` |
| `test/` | logic tests (`core.test.mjs`, `leaderboard.test.mjs`) and Playwright scripts for the browser |

## Browser tests

```bash
npm run build:test
python3 -m http.server 8765        # from the project folder
python3 test/smoke.py desktop level0,click,autoplay
```

Screenshots are written to `shots/`. `python3 test/readme_shots.py` regenerates the pictures in this README and the link preview.

## Credits

- [three.js](https://threejs.org) (MIT license).
- Fonts: [Unbounded](https://fontsource.org/fonts/unbounded) and [Chakra Petch](https://fontsource.org/fonts/chakra-petch), served from [Fontsource](https://fontsource.org) packages (SIL Open Font License 1.1).
- Sound effects and music are synthesized in the browser: no audio files.

## License

The code is MIT licensed, see [LICENSE](LICENSE). three.js and the fonts keep their own licenses (see Credits).
