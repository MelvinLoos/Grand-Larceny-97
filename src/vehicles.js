import { CAR_TYPES } from './config.js';
import { cv, hexRgb, loadImage } from './foliage.js';
import { INK, VEHICLE_PALETTE } from './palette.js';

// --- VEHICLE SPRITES ---
// Top-down art, nose pointing up. Grey "mask" cars (sedan / sports / muscle) are recoloured once at
// startup; liveried cars (police / taxi / truck / tank) are used as drawn. Every skin is box-filtered to
// RES x its world size ONCE here, so the per-frame draw is a plain nearest-neighbour drawImage.
const URLS = import.meta.glob('./assets/sprites/vehicles/*.png', { eager: true, query: '?url', import: 'default' });
const RES = 2; // baked pixels per world pixel
const BODY_GREY = 214; // dominant body grey of the mask sprites
const GREY_DELTA = 12; // |R-G|, |G-B| tolerance of a mask pixel
const DARK_CUT = 30; // luminance at or below this is outline, never tinted

// protect: keep pure-white pixels (racing stripes); door: livery colour of the opening door flap
const DEFS = {
    sedan: {},
    sports: {},
    muscle: { protect: true },
    police: { door: '#1d2a44' },
    taxi: { door: '#f2c21b' },
    truck: { door: '#3b5f9a' },
    tank_hull: {}
};
// Tank turret art: the ring centre of the hull and the pivot of the turret, in sprite pixels
const HULL_RING = { x: 48, y: 78 };
const TURRET_PIVOT = { x: 47, y: 118 };

const SKINS = {}; // car type key -> skin
const DOORS = new Map(); // colour -> 12x5 door flap canvas

function toCanvas(img) {
    const c = cv(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
}

// Area-average downscale (premultiplied) so no canvas smoothing is needed anywhere
function boxScale(src, tw, th) {
    const sd = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
    const out = cv(tw, th);
    const og = out.getContext('2d');
    const od = og.createImageData(tw, th);
    const sx = src.width / tw;
    const sy = src.height / th;
    for (let y = 0; y < th; y++) {
        const y0 = Math.floor(y * sy);
        const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sy));
        for (let x = 0; x < tw; x++) {
            const x0 = Math.floor(x * sx);
            const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sx));
            let r = 0,
                g = 0,
                b = 0,
                a = 0,
                n = 0;
            for (let yy = y0; yy < y1; yy++)
                for (let xx = x0; xx < x1; xx++) {
                    const i = (yy * src.width + xx) * 4;
                    const al = sd[i + 3];
                    r += sd[i] * al;
                    g += sd[i + 1] * al;
                    b += sd[i + 2] * al;
                    a += al;
                    n++;
                }
            const o = (y * tw + x) * 4;
            if (a > 0) {
                od.data[o] = r / a;
                od.data[o + 1] = g / a;
                od.data[o + 2] = b / a;
            }
            od.data[o + 3] = a / n;
        }
    }
    og.putImageData(od, 0, 0);
    return out;
}

// Grey mask pixels (not outline, not coloured glass/lights, optionally not pure white) take the paint
function recolor(src, hex, protect) {
    const c = cv(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    const im = g.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    const [tr, tg, tb] = hexRgb(hex);
    for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        const r = d[i],
            gg = d[i + 1],
            b = d[i + 2];
        const mn = Math.min(r, gg, b);
        if (Math.max(r, gg, b) - mn > GREY_DELTA) continue;
        const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
        if (lum <= DARK_CUT || (protect && mn >= 250)) continue;
        const k = lum / BODY_GREY;
        d[i] = Math.min(255, tr * k);
        d[i + 1] = Math.min(255, tg * k);
        d[i + 2] = Math.min(255, tb * k);
    }
    g.putImageData(im, 0, 0);
    return c;
}

// Same silhouette, flat colour
function flat(src, fill) {
    const c = cv(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = fill;
    g.fillRect(0, 0, c.width, c.height);
    return c;
}

function scorch(src) {
    const c = cv(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(24, 24, 26, 0.72)';
    g.fillRect(0, 0, c.width, c.height);
    return c;
}

function buildPiece(raw, tw, th) {
    const plain = boxScale(raw, tw, th);
    return {
        plain,
        wreck: scorch(plain),
        shadow: flat(plain, 'rgba(0, 0, 0, 0.35)'), // ground pass, matches ped / tree shadows
        mask: flat(plain, '#000') // opaque silhouette, clips the grime layer
    };
}

function buildSkin(spec, imgs) {
    const hull = imgs[spec.sprite];
    const k = spec.l / hull.height;
    const dw = hull.width * k;
    const tw = Math.round(dw * RES);
    const th = Math.round(spec.l * RES);
    const raw = toCanvas(hull);
    const skin = {
        ...buildPiece(raw, tw, th),
        raw,
        dw,
        dh: spec.l,
        k,
        tw,
        th,
        def: DEFS[spec.sprite],
        tints: new Map()
    };
    skin.tintable = !!spec.tint;
    if (spec.isTank && imgs.tank_turret) {
        const t = imgs.tank_turret;
        const tp = buildPiece(toCanvas(t), tw, th);
        skin.turret = {
            ...tp,
            ox: TURRET_PIVOT.x * k, // pivot inside the drawn turret, world px
            oy: TURRET_PIVOT.y * k,
            ring: (hull.height / 2 - HULL_RING.y) * k, // hull ring, forward of the car centre
            barrel: TURRET_PIVOT.y * k // pivot -> barrel tip
        };
    }
    return skin;
}

export async function bakeVehicles() {
    const names = [...Object.keys(DEFS), 'tank_turret'];
    const loaded = await Promise.all(names.map((n) => loadImage(URLS[`./assets/sprites/vehicles/${n}.png`], 6000)));
    const imgs = {};
    names.forEach((n, i) => {
        if (loaded[i]) imgs[n] = loaded[i];
    });
    for (const [key, spec] of Object.entries(CAR_TYPES)) {
        if (!spec.sprite || !imgs[spec.sprite]) continue; // missing art -> vector fallback
        const skin = buildSkin(spec, imgs);
        if (skin.tintable) for (const hex of VEHICLE_PALETTE) bodyOf({ color: hex, hp: 1 }, skin); // pre-bake every paint
        SKINS[key] = skin;
    }
}

export const skinOf = (c) => SKINS[c.typeKey] || null;

// Body canvas for the car's colour (palette colours are pre-baked; odd ones bake once on first use)
export function bodyOf(c, skin) {
    if (c.hp <= 0) return skin.wreck;
    if (!skin.tintable) return skin.plain;
    let m = skin.tints.get(c.color);
    if (!m) {
        m = boxScale(recolor(skin.raw, c.color, skin.def.protect), skin.tw, skin.th);
        skin.tints.set(c.color, m);
    }
    return m;
}

// 5 wide x 12 long flap with a 1px outline
export function doorFor(color) {
    let d = DOORS.get(color);
    if (!d) {
        d = cv(12, 5);
        const g = d.getContext('2d');
        g.fillStyle = INK;
        g.fillRect(0, 0, 12, 5);
        g.fillStyle = color;
        g.fillRect(1, 1, 10, 3);
        DOORS.set(color, d);
    }
    return d;
}

// World-space tank geometry: where the ring sits ahead of the hull centre, and barrel length
export function tankGeom(c) {
    const t = skinOf(c)?.turret;
    return t ? { ring: t.ring, barrel: t.barrel } : { ring: -4, barrel: 38 };
}
