# Grand Larceny '97

> Steal cars. Cause havoc. Blame the '90s.

An original top-down 2.5D crime and driving sandbox that runs in the browser. Keyboard or touch, no install.
A parody homage to '90s top-down crime games, not affiliated with any publisher.

## Controls

| Input         | Action                            |
| ------------- | --------------------------------- |
| WASD / arrows | Walk and steer                    |
| Enter / F / E | Jack the nearest car, or bail out |
| Space         | Handbrake drift, or shoot on foot |
| Click / Ctrl  | Fire                              |
| Q / 1–4       | Switch weapon                     |
| H             | Horn (siren in a cop car)         |
| Esc / P       | Pause and open the manual         |

On touch devices, use the on-screen pad and buttons.

## Development

Requires Node 20+.

```sh
npm install
npm run dev            # dev server
npm run build          # production build into dist/
npm run preview        # serve the production build
npm run lint           # ESLint
npm run format         # Prettier
```

### Layout

- `index.html` — markup (HUD, title screen, manual) and SVG icon sprite
- `src/styles/` — CSS split by area
- `src/*.js` — ES modules: `config`, `palette`, `grime` (procedural art), `audio`, `state`, `city`, `entities`, `ai`, `combat`, `missions`, `update`, `render`, `hud`, `ui`, `main`
- `src/assets/sprites/` — optional PNG overrides (see `src/grime.js`)
- `public/` — icons, social image, `robots.txt`

## Deploying to GitHub Pages

1. In the repository settings, open **Pages** and set **Source** to **GitHub Actions**.
2. Push to `main`. `.github/workflows/deploy.yml` lints, builds and deploys `dist/`.

The build uses a relative base, so it works under `user.github.io/<repo>/` and on custom domains. A service
worker makes the game installable and playable offline.

## Licenses

Code: MIT, see `LICENSE`. Fonts (Archivo, Barlow Condensed) are licensed under the SIL Open Font License 1.1.
