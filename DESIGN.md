---
name: "GRAND LARCENY '97"
description: "Steal cars. Cause havoc. Blame the '90s. A late-90s big-box PC game you open into a live foldout street map."
colors:
  route-red: "#d23a2a"
  hazard-yellow: "#ffd400"
  hazard-yellow-hi: "#ffe14d"
  water-blue: "#2f6db5"
  park-green: "#79a957"
  radio-amber: "#ffb000"
  box-black: "#0d0d0c"
  ink: "#14130f"
  silver: "#c9ccd1"
  silver-hi: "#eef0f2"
  silver-lo: "#7d8188"
  map-paper: "#ece6d2"
  paper-fold: "#ddd5bd"
  paper-ink: "#4a453a"
  paper-shade: "#cbc1a3"
  sidewalk: "#e1d8bf"
  road: "#f7f2e2"
  roof-downtown: "#dcb85a"
  roof-uptown: "#9fb6cc"
  roof-westside: "#cf9474"
  roof-dockyard: "#aaa69c"
typography:
  display:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "clamp(44px, 5.3vw, 86px)"
    fontWeight: 900
    lineHeight: 0.86
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 125"
  headline:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "clamp(46px, 8.5vw, 96px)"
    fontWeight: 900
    lineHeight: 0.95
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 125"
  title:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "30px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 112"
  sign:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "15px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.14em"
    fontVariation: "'wdth' 115"
  lead:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "clamp(20px, 1.7vw, 27px)"
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: "'tnum' 1"
  numeral:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.01em"
    fontFeature: "'tnum' 1"
  button:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.05em"
  label:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.12em"
rounded:
  print: "4px"
  key: "6px"
  tag: "8px"
  sticker: "10px"
  sticker-lg: "12px"
  device: "14px"
  window: "22px"
  full: "9999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "28px"
  page: "34px 40px 22px"
components:
  button-primary:
    backgroundColor: "{colors.hazard-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sticker}"
    padding: "0 22px"
    height: "50px"
  button-primary-hover:
    backgroundColor: "{colors.hazard-yellow-hi}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.silver-hi}"
    typography: "{typography.button}"
    rounded: "{rounded.sticker}"
    padding: "0 22px"
    height: "50px"
  sticker-play:
    backgroundColor: "{colors.hazard-yellow}"
    textColor: "{colors.ink}"
    size: "168px"
  sticker-status:
    backgroundColor: "{colors.map-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sticker-lg}"
    padding: "9px 12px 7px"
  sticker-score:
    backgroundColor: "{colors.hazard-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.numeral}"
    rounded: "{rounded.sticker}"
    padding: "3px 7px 3px 13px"
  hud-button:
    backgroundColor: "{colors.map-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sticker}"
    size: "42px"
  hud-button-hover:
    backgroundColor: "{colors.hazard-yellow}"
  pager:
    backgroundColor: "{colors.box-black}"
    rounded: "{rounded.device}"
    padding: "8px 10px 8px 12px"
  radio:
    backgroundColor: "{colors.box-black}"
    textColor: "{colors.map-paper}"
    rounded: "{rounded.sticker}"
    padding: "8px 14px"
  district-sign:
    backgroundColor: "{colors.map-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.sign}"
    rounded: "{rounded.print}"
    padding: "5px 12px"
  keycap:
    backgroundColor: "#fbf8ef"
    textColor: "{colors.ink}"
    rounded: "{rounded.key}"
    height: "28px"
    padding: "0 7px"
  pad-button:
    backgroundColor: "rgba(13,13,12,.84)"
    textColor: "{colors.hazard-yellow}"
    rounded: "{rounded.device}"
    size: "58px"
  pad-button-pressed:
    backgroundColor: "{colors.hazard-yellow}"
    textColor: "{colors.ink}"
  manual-page:
    backgroundColor: "{colors.map-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "{spacing.page}"
  box-strip:
    backgroundColor: "{colors.hazard-yellow}"
    textColor: "{colors.ink}"
    height: "64px"
    padding: "0 4%"
---

# Design System: GRAND LARCENY '97

## Overview

**Creative North Star: "The Big Box on the Shelf"**

The game is the box it came in. The title screen is a 1997 big-box PC game front: box black, a silver extruded italic logo, a die-cut window showing the live city, and a hazard-yellow starburst price sticker that is the PLAY button. Pressing it grows the window to full screen, so the box opens into the game. The city is the foldout street map come alive: uncoated cream paper, ink casings on every road and roof, district roof tints, a grid of letters and numbers printed in the sea. HUD pieces are stickers slapped onto the box; pause is the printed manual, a two-page spread with keycaps and a map key.

Everything is printed flat with ink outlines, on a well-worn sheet: paper grain, asphalt speckle and cracks, oil spots, pavement stains, rain-streaked roofs, and a colour plate printed a hair off the ink plate. Characters are hand-inked frames with boiling line work (generated in code, `GRIME` in index.html; PNG sheets can replace them). Depth comes from print objects sitting on one another (a sticker on a box, a manual over the map), never from light. The system refuses dark glass panels over a neon arcade, scanlines, glow, CRT effects and emoji.

Motion has three verbs. Stickers slap on (fast scale-down from 1.12 with a slight rotation, exponential ease-out). Banners slam in once and leave. The box window opens. Nothing loops for decoration.

**Key Characteristics:**
- Box black, silver-embossed italic display type, hazard-yellow sticker accents.
- Uncoated map-paper cream carrying map inks: route red, water blue, park green, district tints.
- Ink outlines (1.5 to 2px) on every printed object, in DOM and canvas alike.
- Condensed manual text with tabular numerals for every number on screen.
- Stickers sit slightly off-square (rotated -0.6deg to 8deg); print never sits perfectly true.

## Colors

The palette is two print stocks (box black and map paper) and the inks printed on them. Hazard yellow is the one accent and means "press this" or "this is money".

### Primary
- **Route Red** (route-red): the map's route ink. Health bar, the objective arrow and ring for kill/destroy jobs only, the damage vignette, lit heat badges at high heat, the "Job" label on a kill job, explosive barrels, the target route line on the map.
- **Hazard Yellow** (hazard-yellow): price-sticker yellow. The PLAY starburst, the '97 roundel, the box strip, the score sticker, primary buttons, focus rings, text selection, the objective arrow, chevron and ground ring for go-to jobs, the player, pickup glints, Spray-B-Gone garages. Hover lifts to **Hazard Yellow Hi** (hazard-yellow-hi).

### Secondary
- **Water Blue** (water-blue): the sea and the canvas backdrop, the Spray-B-Gone arrow, rooftop pools, armor pickups.
- **Phone Cyan** (`#35c8e0`): payphone booth headers, their sound waves and the arrow to the nearest ringing phone. Greyed while a job runs. Pickup rings are color-coded: green health, blue armor, amber/orange weapons, gold bribes.
- **Park Green** (park-green): park tiles, with darker tree canopies (#5d8e43) outlined in ink.
- **Radio Amber** (radio-amber): the car radio's frequency readout only.

### Neutral
- **Box Black** (box-black): the box itself; title backdrop, pager and radio bodies, the manual scrim at 78%, the touch pad at 84%.
- **Ink** (ink): the one outline and text ink on every light surface and in canvas.
- **Silver / Silver Hi / Silver Lo** (silver, silver-hi, silver-lo): embossing on the box. Logo face and extrusion steps, window rims, ghost-button strokes, box blurbs.
- **Map Paper** (map-paper): sticker faces, manual pages, the district sign, body text on black. **Paper Fold** (paper-fold) is the pressed/hover tone on paper; **Paper Shade** (paper-shade) is meter tracks, unlit heat badges and road lane dashes; **Paper Ink** (paper-ink) is secondary text on paper.
- **Sidewalk / Road** (sidewalk, road): the map's two ground stocks. Roads are the lightest paper, cased by ink rules with sidewalk margins.
- **District roofs** (roof-downtown, roof-uptown, roof-westside, roof-dockyard): one mid-value tint per district, each with two sibling shades in the script (Downtown and Central Park Plaza share ochre). Roofs carry an ink outline and a faint inner ink inset.

**The One Sticker Rule.** Hazard yellow is the only accent on any surface. If two things on screen are yellow, both are pressable, money, or the player.

**The Two Stocks Rule.** Every surface is box black or map paper. There is no third gray panel; a surface that is neither is a device (pager, radio) and is drawn as a black object.

## Typography

**Display Font:** Archivo (variable, self-hosted, italic face), always italic, heavy (800 to 900), expanded (width 112 to 125).
**Body Font:** Barlow Condensed (self-hosted, 400 and 700), with tabular numerals set on the body.

**Character:** Box-front bravado over manual-page practicality. The display face is slanted, wide and loud, like an embossed logo; the condensed face is the manual, the box copy and every number.

### Hierarchy
- **Display** (display): the logo only, upper-left of the box, silver face with a six-step stepped extrusion. Line one runs slightly smaller (clamp(40px, 4.6vw, 74px)).
- **Headline** (headline): shout banners ("WASTED", "HALLELUJAH!"), uppercase, ink-stroked with a stepped ink extrusion, slammed in once.
- **Title** (title): manual page headings, balanced wrap. The PLAY sticker word uses the same face at 40px, width 120.
- **Sign** (sign): the district label and map signage; also the box strip's "BROWSER EDITION" and the multiplier roundel, in caps.
- **Lead** (lead): the tagline, bold condensed.
- **Body** (body): manual prose (max 60ch, in paper ink), box blurbs (17 to 21px, in silver on black), controls and the map key.
- **Numeral** (numeral): cash score and radio frequency; tabular, bold.
- **Button** (button): uppercase bold condensed for actions.
- **Label** (label): uppercase tracked condensed for meter and field labels ("HEAT", "JOB"), the system-requirements heading and touch-button captions.

**The Embossed Logo Rule.** Display type is italic, expanded and heavy, or it is not display type. Its depth is a stepped hard extrusion in silver (logo) or ink (banners), the printed emboss of a box front.

**The Tabular Rule.** Every number on screen is Barlow Condensed with tabular numerals, so cash, ammo and timers never jitter.

## Layout

The title screen is a full-bleed box front. Desktop: logo and box copy in the left 35%, the die-cut window from 41% to 97% wide, the PLAY starburst overlapping the window's lower-right corner, a 64px hazard box strip along the bottom edge. Below 860px or at portrait aspect, it stacks: logo on top, window centre, sticker bottom-right, strip 52px; blurbs and system requirements drop out. System requirements also hide below 760px height.

In play, the HUD keeps to the corners and edges so the city stays clear: status sticker top-left, score column and two square buttons top-right, pager top-centre, district sign bottom-centre, radio above it. Every HUD piece sits 12px from the viewport edge (spacing md). On touch or below 768px the d-pad (58px cells, 6px gaps) and a 2x2 action grid (68px, 10px gaps) occupy the bottom corners, and the district sign and radio move up out of their way. Below 520px the mission line, pager, district sign and radio all share one slot at 112px from the top and give way to each other.

The manual is a two-page spread at most 1080px wide, centred on a black scrim; it collapses to one column under 860px. Safe-area insets are honoured on the strip and the touch pad.

**The Clear Windscreen Rule.** HUD never covers the play area's centre. New HUD pieces take a corner or an edge slot, and on phones they queue for a shared slot rather than stack.

## Elevation & Depth

Flat print with physical stacking. Surfaces are flat colour with ink outlines; separation comes from a soft, low, dark drop shadow under a print object lying on another (0 6px 16px rgba(20,19,15,.3) for stickers, up to 0 24px 60px rgba(0,0,0,.55) for the manual). Depth in the manual is the page gutter: an inset shadow curving into the spine. The die-cut window has a stacked silver rim and a single cellophane highlight band across its top-left corner, nothing more. Buildings rise in canvas as 2.5D wall quads with flat roofs; no lighting model beyond per-face shade.

**The Printed, Not Lit Rule.** No glow, no blur, no glass, no gradients standing in for light. A shadow says "this object lies on top"; it never says "this emits".

## Shapes

Print objects with die-cut corners. Small radii on flat print (4px signs, 6px keycaps and pages), medium on stickers (8 to 12px), rounder on hand-held devices (14px pager and pad), and a big 22px die-cut on the box window that opens to 0 when the box opens. Round shapes are reserved for roundels: the '97 badge, the multiplier, LEDs. The PLAY button is a 36-point starburst with an ink stroke. Bullets in box copy are small yellow diamonds.

**The Off-Square Rule.** Stickers and roundels sit a little rotated (-9deg to 8deg); manual pages and map print sit true. Rotation marks something stuck on, not printed in.

## Components

### Price sticker (PLAY)
A 168px hazard-yellow starburst with a 1.5px ink stroke, rotated 8deg, PLAY in display italic over "PRESS ENTER" (or a touch hint). Hover straightens to 2deg and scales to 1.05; active presses to 0.96. Focus thickens the ink stroke to 4px instead of drawing a ring. On press, the box window grows to full screen over 0.75s on the exponential ease-out while copy, strip and sticker fall away.

### HUD stickers
Map-paper stickers with a 2px ink border and a soft drop shadow: the status sticker (health and armor meters with ink-cased tracks and paper tick marks, four heat badges, weapon button) and the hazard score sticker carrying an ink multiplier roundel. They slap on with a staggered 80ms delay. Square HUD buttons (42px, 38px on phones) are paper stickers that turn hazard yellow on hover.

### Pager and radio
Black devices, not panels. The pager has a vertical PAGE brand in silver lo, a red LED that blinks six times on arrival and stops, and a sage LCD screen (#a9b59a, inset shadow) in uppercase condensed bold. The radio shows an amber frequency numeral beside station name and tag; it shrinks to a mini readout after the intro.

### District sign
A small paper plate in sign type, centred at the bottom edge, rising 8px into place on entering a district.

### Shout banner
Headline type, ink-stroked and ink-extruded, slammed in from 1.6x at -8deg to rest at -4deg over 2.6s, with a box-black subtitle plate. It plays once per event.

### Manual
A paper spread with page gutters, Archivo titles, a controls list of keycaps (paper caps, 1.5px ink border, 3.5px ink bottom edge), a map key of arrow and badge icons in their map inks, a "Secrets" section under an ink rule, and folio numbers. Actions sit below: ghost buttons (silver-lo inset stroke, silver hi on hover) and one hazard primary.

### Touch pad
Box-black keys at 84% opacity with hazard-yellow icons; pressed flips to solid hazard with ink. Action keys carry a paper caption. Every feature has a key.

### Map print (canvas)
Roads in road paper with sidewalk margins and 2.5px ink casings, pale lane dashes and street names in condensed bold at 42% ink. Pavement tiles in sidewalk with a 12% ink inset. Water with cream ripple strokes and grid letters and numbers in display italic. Spray-B-Gone tiles are hazard yellow with a heavy ink frame and its name in display italic. Floating cash pop-ups are condensed bold with a 5px ink stroke. Off-screen guide arrows are hazard (payphone), route red (target) and water blue (garage).

**The Map Key Rule.** A map ink means the same thing in the manual, the HUD and the city: yellow is the payphone and money, red is the target and damage, blue is the garage.

## Do's and Don'ts

### Do:
- **Do** print every surface on box black or map paper, outlined in ink (#14130f).
- **Do** set display type in Archivo italic, heavy and expanded, and give it a stepped hard extrusion when it is a logo or banner.
- **Do** use hazard yellow only for what is pressable, money, or the player.
- **Do** slap stickers on with a fast scale-down and slight rotation on the exponential ease-out (cubic-bezier(.16, 1, .3, 1)).
- **Do** give every new feature a touch key, and keep HUD pieces in corner or edge slots.
- **Do** keep map inks consistent between the manual's key, the HUD and the canvas.

### Don't:
- **Don't** use dark glass panels, backdrop blur, glow, scanlines, CRT curvature or emoji.
- **Don't** loop animation for decoration; banners slam once, LEDs blink a set count and stop.
- **Don't** introduce a second accent colour or a gray card surface.
- **Don't** use pixel or terminal fonts (Press Start 2P, VT323) or a system display face.
- **Don't** use distinctive names from the series this parodies; parody names only.
