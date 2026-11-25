# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Players of a public browser game (itch.io or similar). They arrive from a link, often on a phone, and want to be playing within seconds. Sessions are short and replayable; they come for mayhem, not a long campaign. Desktop (keyboard) and mobile (touch) players count equally.

## Product Purpose
An original top-down 2.5D crime and driving sandbox that runs in the browser. Success: a new player understands the controls almost at once, causes escalating chaos, and wants another run.

## Positioning
A chaotic sandbox: emergent mayhem, escalating police chases, combos and score multipliers are the core of the game. Missions exist but play a supporting role.

## Capabilities and Constraints
- Already in place (in `src/`): walking and driving, hijacking and exiting vehicles, several vehicle types including police and a tank, weapon cycling, a wanted level that decays over time, police pursuit, missions started at payphones and tracked by pager, a score multiplier, repair/respray garages, hidden bonuses, a procedural Web Audio synth (`RetroAudio`), a horn and siren, and on-screen touch controls.
- **Binding:** mobile touch controls must stay fully playable for every feature.
- Current stack: Vite + vanilla ES modules (`src/`), plain CSS (`src/styles/`), canvas rendering, self-hosted fonts in `src/assets/fonts/` (Archivo, Barlow Condensed), no external requests; deployed to GitHub Pages via GitHub Actions. The user did not make the build setup binding.
- **Parody, not a copy:** a non-profit, nostalgic wink at 1997 top-down crime games. Genre mechanics and generic words (Cabbie, Police, Van, Battle Tank, Central Park, Dockyard) are fine. Distinctive names from Grand Theft Auto (its title, cities, model names, characters, catchphrases) are never used, and no name maps one-to-one onto one of theirs.

## Brand Commitments
- Title: **GRAND LARCENY '97**. Tagline: "Steal cars. Cause havoc. Blame the '90s."
- City: **Neon Bay** (Downtown, Westside, Central Park Plaza, Southeast Dockyard; Neon Bay General Hospital).
- Vehicles: Hellcrab GTS, Bumbler, Blitz V8, Cabbie Taxi, Box Van, Cop Cruiser, Battle Tank.
- Radio: Crash FM 98.7, Beige 101, The Meter 88.3, Rush 104, Talk Back 640 AM, NBPD Dispatch, Army Surplus Radio (CB).
- Respray garage: **Spray-B-Gone**. Crowd bonus: **HALLELUJAH!** Mission givers: **Mama Volta**, **The Dentist**, **Cousin Ricky**.
- Voice: on-the-nose '90s arcade bravado, loud and tongue-in-cheek.

## Evidence on Hand
No press, player reviews, testimonials or player numbers exist. Don't invent them.

## Product Principles
1. Chaos is the product: every system (wanted level, multiplier, vehicles, weapons) should feed emergent, escalating mayhem.
2. Seconds to play: no install, no long intro; the controls must be clear from the first screen.
3. Touch and keyboard are equals: a feature that doesn't work on touch isn't finished.
4. Wink, don't copy: genre, mechanics and generic words are shared ground. Distinctive names, places, characters and catchphrases belong to this game.
