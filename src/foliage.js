import treeUrl from './assets/sprites/tree.png?url';
import { audio } from './audio.js';
import { isRoadCell } from './city.js';
import { MAP_SIZE, TILE, T_GRASS, T_PAVEMENT } from './config.js';
import { buzz } from './haptics.js';
import {
    camera,
    cars,
    foliage,
    foliageGrid,
    mapGrid,
    particles,
    payphones,
    pickups,
    player,
    sprayShops,
    view
} from './state.js';

// --- FOLIAGE: one palette-indexed canopy mask, baked once at startup into recoloured,
// rotated canvases (trees, compound groves, bushes). No pixel reads/writes after bakeFoliage(). ---

const N = 64; // canopy canvas size
const GN = 96; // grove canvas size
const PX = 1.5; // world px per canopy pixel
export const PALETTES = {
    oak: ['#6ABE30', '#37946E', '#193C3E'],
    sycamore: ['#99E550', '#6ABE30', '#323C39'],
    maple: ['#FBF236', '#DF7126', '#8F3F28'],
    blossom: ['#FFCCEE', '#E86A92', '#7A284B'],
    // extra greens for variety
    pine: ['#4E9A5A', '#2A6B4A', '#12332B'],
    olive: ['#B5C23F', '#76912F', '#34421F'],
    moss: ['#86A63A', '#5A8021', '#2B4416'],
    sage: ['#A5C694', '#6F9E73', '#35533F'],
    meadow: ['#8FE05A', '#4FAE3E', '#215A2C'],
    emerald: ['#3FCB7C', '#1F9A5E', '#0F4A38']
};
const COMPLEMENT = {
    oak: 'sycamore',
    sycamore: 'oak',
    maple: 'oak',
    blossom: 'sycamore',
    pine: 'moss',
    olive: 'meadow',
    moss: 'pine',
    sage: 'oak',
    meadow: 'olive',
    emerald: 'pine'
};
const OUTLINE = [20, 24, 20]; // #141814
const CANOPY = {}; // palette -> 8 orientations of { img, shadow }
const GROVES = []; // { img, shadow, pal }

function cv(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hexRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function loadImage(url, ms) {
    return new Promise((resolve) => {
        const im = new Image();
        const t = setTimeout(() => resolve(null), ms);
        im.onload = () => {
            clearTimeout(t);
            resolve(im);
        };
        im.onerror = () => {
            clearTimeout(t);
            resolve(null);
        };
        im.src = url;
    });
}

// Fallback RGB mask (R = highlight, G = midtone, B = shadow) when tree.png can't be read
function proceduralMask() {
    const c = cv(N, N),
        g = c.getContext('2d'),
        r = rng(97);
    const blob = (color, x, y, rad) => {
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
    };
    blob('#141814', 32, 32, 29);
    blob('#0000ff', 32, 32, 27.5);
    for (let i = 0; i < 9; i++) {
        const a = r() * 6.283,
            d = r() * 13;
        blob('#00ff00', 30 + Math.cos(a) * d, 30 + Math.sin(a) * d, 7 + r() * 5);
    }
    for (let i = 0; i < 6; i++) {
        const a = r() * 6.283,
            d = r() * 9;
        blob('#ff0000', 25 + Math.cos(a) * d, 25 + Math.sin(a) * d, 3 + r() * 4);
    }
    return c;
}

// Source image -> index mask (0 empty, 1 outline, 2 highlight, 3 midtone, 4 shadow)
function buildMask(src) {
    const c = cv(N, N),
        g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, N, N);
    const px = g.getImageData(0, 0, N, N).data;
    const open = (i) => px[i * 4 + 3] < 50 || (px[i * 4] > 220 && px[i * 4 + 1] > 220 && px[i * 4 + 2] > 220);

    // Flood-fill the light/transparent background in from the edges; enclosed light pixels survive
    const bg = new Uint8Array(N * N),
        q = [];
    const seed = (i) => {
        if (!bg[i] && open(i)) {
            bg[i] = 1;
            q.push(i);
        }
    };
    for (let k = 0; k < N; k++) {
        seed(k);
        seed((N - 1) * N + k);
        seed(k * N);
        seed(k * N + N - 1);
    }
    while (q.length) {
        const i = q.pop(),
            x = i % N,
            y = (i / N) | 0;
        if (x > 0) seed(i - 1);
        if (x < N - 1) seed(i + 1);
        if (y > 0) seed(i - N);
        if (y < N - 1) seed(i + N);
    }

    const m = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) {
        if (bg[i] || px[i * 4 + 3] < 50) continue;
        const R = px[i * 4],
            G = px[i * 4 + 1],
            B = px[i * 4 + 2];
        if (R < 35 && G < 35 && B < 35) m[i] = 1;
        else if (Math.max(R, G, B) - Math.min(R, G, B) > 40) m[i] = R >= G && R >= B ? 2 : G >= B ? 3 : 4;
        else {
            const L = 0.299 * R + 0.587 * G + 0.114 * B;
            m[i] = L > 170 ? 2 : L >= 95 ? 3 : 4;
        }
    }
    return m;
}

// Rotate (quarter turns) and optionally mirror the raw mask, before any lighting
function orient(m, rot, flip) {
    const o = new Uint8Array(N * N);
    for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
            let sx = flip ? N - 1 - x : x,
                sy = y;
            for (let k = 0; k < rot; k++) {
                const t = sx;
                sx = sy;
                sy = N - 1 - t;
            }
            o[y * N + x] = m[sy * N + sx];
        }
    return o;
}

// North-west sun bias + guaranteed 1px outline on every edge
function finish(o) {
    let cx = 0,
        cy = 0,
        n = 0;
    for (let i = 0; i < N * N; i++)
        if (o[i]) {
            cx += i % N;
            cy += (i / N) | 0;
            n++;
        }
    if (!n) return o;
    cx /= n;
    cy /= n;
    const r = Math.sqrt(n / Math.PI);
    const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : o[y * N + x]);
    const out = o.slice();
    for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
            const i = y * N + x,
                v = o[i];
            if (!v) continue;
            const nb = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)];
            if (nb.includes(0)) {
                out[i] = 1;
                continue;
            }
            if (v === 3) {
                const s = x - cx + (y - cy);
                if (s < -r * 0.25 && nb.includes(2)) out[i] = 2;
                else if (s > r * 0.25 && nb.includes(4)) out[i] = 4;
            }
        }
    return out;
}

function paint(mask, pal) {
    const c = cv(N, N),
        g = c.getContext('2d'),
        d = g.createImageData(N, N),
        cols = [null, OUTLINE, ...pal.map(hexRgb)];
    for (let i = 0; i < N * N; i++) {
        const v = mask[i];
        if (!v) continue;
        d.data.set(cols[v], i * 4);
        d.data[i * 4 + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    return c;
}

function silhouette(src) {
    const c = cv(src.width, src.height),
        g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.fillRect(0, 0, c.width, c.height);
    return c;
}

export async function bakeFoliage() {
    const im = await loadImage(treeUrl, 2000);
    let mask = null;
    try {
        if (im) mask = buildMask(im);
    } catch {
        mask = null; // tainted canvas (file://) -> procedural fallback
    }
    if (!mask || mask.filter((v) => v > 1).length < 200) mask = buildMask(proceduralMask());

    for (const key of Object.keys(PALETTES)) {
        CANOPY[key] = [];
        for (let rot = 0; rot < 4; rot++)
            for (let flip = 0; flip < 2; flip++) {
                const img = paint(finish(orient(mask, rot, flip)), PALETTES[key]);
                CANOPY[key].push({ img, shadow: silhouette(img) });
            }
    }

    // Old-growth groves: 2-3 overlapping canopies stamped into one wide crown
    const keys = ['oak', 'pine', 'sycamore', 'olive', 'moss', 'maple', 'emerald', 'sage', 'meadow'];
    for (let k = 0; k < keys.length; k++) {
        const r = rng(500 + k * 37),
            pal = keys[k % keys.length],
            c = cv(GN, GN),
            g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        const n = 2 + (r() < 0.5 ? 1 : 0),
            a0 = r() * 6.283;
        for (let j = 0; j < n; j++) {
            const key = j > 0 && r() < 0.4 ? COMPLEMENT[pal] : pal,
                v = CANOPY[key][Math.floor(r() * 8)].img,
                s = Math.round((0.75 + r() * 0.35) * N),
                a = a0 + (j * 6.283) / n,
                d = 11 + r() * 7;
            const x = Math.max(0, Math.min(GN - s, Math.round(GN / 2 + Math.cos(a) * d - s / 2))),
                y = Math.max(0, Math.min(GN - s, Math.round(GN / 2 + Math.sin(a) * d - s / 2)));
            g.drawImage(v, x, y, s, s);
        }
        GROVES.push({ img: c, shadow: silhouette(c), pal: PALETTES[pal] });
    }
}

// --- PLACEMENT (deterministic) ---
const key = (x, y) => Math.floor(y / TILE) * MAP_SIZE + Math.floor(x / TILE);

function forEachNear(x, y, fn) {
    const tx = Math.floor(x / TILE),
        ty = Math.floor(y / TILE);
    for (let j = ty - 1; j <= ty + 1; j++)
        for (let i = tx - 1; i <= tx + 1; i++) {
            const list = foliageGrid.get(j * MAP_SIZE + i);
            if (list) for (const f of list) fn(f);
        }
}

function makeProp(type, x, y, r, palKey) {
    const seed = r() * 100;
    if (type === 'grove') {
        const gv = GROVES[Math.floor(r() * GROVES.length)],
            size = GN * PX * (0.95 + r() * 0.1);
        return mk(type, x, y, gv.img, gv.shadow, size, 8, 0.26, seed, gv.pal);
    }
    const v = CANOPY[palKey][Math.floor(r() * 8)];
    if (type === 'bush')
        return mk(type, x, y, v.img, v.shadow, N * PX * (0.4 + r() * 0.15), 0, 0.015, seed, PALETTES[palKey]);
    return mk(type, x, y, v.img, v.shadow, N * PX * (0.85 + r() * 0.35), 5, 0.19 + r() * 0.04, seed, PALETTES[palKey]);
}
function mk(type, x, y, img, shadow, size, trunkR, h, seed, pal) {
    return {
        type,
        x,
        y,
        img,
        shadow,
        size,
        canopyR: size * 0.45,
        trunkR,
        h,
        seed,
        pal,
        shakeTimer: 0,
        hitCd: 0,
        alpha: 1
    };
}

function pickPal(r, weights) {
    let t = r() * weights.reduce((s, w) => s + w[1], 0);
    for (const [k, w] of weights) if ((t -= w) <= 0) return k;
    return weights[0][0];
}

export function plantFoliage() {
    foliage.length = 0;
    foliageGrid.clear();

    // Keep trunks off gameplay spots
    const keepClear = [
        ...cars.filter((c) => c.aiMode === 'parked'),
        ...payphones,
        ...pickups,
        ...sprayShops,
        { x: player.x, y: player.y },
        { x: 13.5 * TILE, y: 11.7 * TILE },
        { x: 7.5 * TILE, y: 17.5 * TILE },
        { x: 21.5 * TILE, y: 7.5 * TILE },
        { x: 25.5 * TILE, y: 25.5 * TILE }
    ];
    // Jogger conga loop around Central Park
    const L0 = 12.4 * TILE,
        L1 = 16.5 * TILE;
    const loopDist = (x, y) => {
        const ox = Math.max(L0 - x, 0, x - L1),
            oy = Math.max(L0 - y, 0, y - L1);
        if (ox || oy) return Math.hypot(ox, oy);
        return Math.min(x - L0, L1 - x, y - L0, L1 - y);
    };

    // Distance from a point to the nearest road tile edge
    const roadGap = (x, y) => {
        const tx = Math.floor(x / TILE),
            ty = Math.floor(y / TILE);
        let best = Infinity;
        for (let j = ty - 1; j <= ty + 1; j++)
            for (let i = tx - 1; i <= tx + 1; i++) {
                if (!isRoadCell(i, j)) continue;
                const ox = Math.max(i * TILE - x, 0, x - (i + 1) * TILE),
                    oy = Math.max(j * TILE - y, 0, y - (j + 1) * TILE);
                best = Math.min(best, Math.hypot(ox, oy));
            }
        return best;
    };

    const tryAdd = (f) => {
        if (roadGap(f.x, f.y) < (f.trunkR ? 46 : 28)) return false;
        const pad = f.trunkR ? 70 : 40;
        for (const p of keepClear) if (Math.hypot(p.x - f.x, p.y - f.y) < pad) return false;
        if (f.trunkR && loopDist(f.x, f.y) < 30) return false;
        let ok = true;
        forEachNear(f.x, f.y, (o) => {
            if (Math.hypot(o.x - f.x, o.y - f.y) < (o.canopyR + f.canopyR) * 0.62) ok = false;
        });
        if (!ok) return false;
        foliage.push(f);
        const k = key(f.x, f.y);
        if (!foliageGrid.has(k)) foliageGrid.set(k, []);
        foliageGrid.get(k).push(f);
        return true;
    };

    const parkPal = [
        ['oak', 0.17],
        ['sycamore', 0.12],
        ['pine', 0.14],
        ['olive', 0.1],
        ['moss', 0.1],
        ['sage', 0.07],
        ['meadow', 0.1],
        ['emerald', 0.07],
        ['maple', 0.1],
        ['blossom', 0.03]
    ];
    const streetPal = [
        ['sycamore', 0.24],
        ['oak', 0.18],
        ['meadow', 0.14],
        ['olive', 0.12],
        ['pine', 0.1],
        ['moss', 0.1],
        ['sage', 0.07],
        ['emerald', 0.04],
        ['maple', 0.03],
        ['blossom', 0.01]
    ];

    // Central Park: one old-growth grove per quadrant, then mixed trees & bushes
    const groveTiles = [
        [13, 13],
        [15, 13],
        [13, 15],
        [15, 15]
    ];
    for (const [tx, ty] of groveTiles) {
        const r = rng(tx * 7919 + ty * 104729);
        for (let a = 0; a < 6; a++)
            if (tryAdd(makeProp('grove', (tx + 0.3 + r() * 0.4) * TILE, (ty + 0.3 + r() * 0.4) * TILE, r))) break;
    }
    for (let ty = 11; ty <= 17; ty++)
        for (let tx = 11; tx <= 17; tx++) {
            if (mapGrid[ty][tx] !== T_GRASS) continue;
            const r = rng(tx * 131 + ty * 977 + 5);
            const count = 2 + Math.floor(r() * 3);
            for (let n = 0; n < count; n++) {
                const type = r() < 0.32 ? 'bush' : 'tree';
                for (let a = 0; a < 6; a++) {
                    const x = (tx + 0.12 + r() * 0.76) * TILE,
                        y = (ty + 0.12 + r() * 0.76) * TILE;
                    if (tryAdd(makeProp(type, x, y, r, pickPal(r, parkPal)))) break;
                }
            }
        }

    // Avenue sidewalks, park ring & dockyard
    const inset = 48; // trunk distance from the curb; canopy barely overhangs the lane
    for (let ty = 2; ty < MAP_SIZE - 1; ty++)
        for (let tx = 2; tx < MAP_SIZE - 1; tx++) {
            if (mapGrid[ty][tx] !== T_PAVEMENT) continue;
            const r = rng(tx * 3301 + ty * 7741 + 11);
            const parkRing = tx >= 11 && tx <= 17 && ty >= 11 && ty <= 17;
            const dock = tx >= 23 && tx <= 29 && ty >= 23 && ty <= 29;
            if (dock) {
                if (r() < 0.18)
                    tryAdd(
                        makeProp(
                            'bush',
                            (tx + 0.2 + r() * 0.6) * TILE,
                            (ty + 0.2 + r() * 0.6) * TILE,
                            r,
                            pickPal(r, streetPal)
                        )
                    );
                continue;
            }
            const sides = [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1]
            ];
            for (const [dx, dy] of sides) {
                if (!isRoadCell(tx + dx, ty + dy) || r() > (parkRing ? 0.3 : 0.38)) continue;
                const along = 0.22 + r() * 0.56;
                const x = dx ? (dx > 0 ? (tx + 1) * TILE - inset : tx * TILE + inset) : (tx + along) * TILE;
                const y = dy ? (dy > 0 ? (ty + 1) * TILE - inset : ty * TILE + inset) : (ty + along) * TILE;
                let type = 'tree',
                    pal;
                if (parkRing) {
                    type = r() < 0.5 ? 'bush' : 'tree';
                    pal = pickPal(r, parkPal);
                } else {
                    if (r() < 0.25) type = 'bush';
                    pal = pickPal(r, streetPal);
                }
                tryAdd(makeProp(type, x, y, r, pal));
            }
        }
}

// --- RUNTIME ---
export function updateFoliage(dt) {
    const k = 1 - Math.exp(-8 * dt);
    for (const f of foliage) {
        if (f.shakeTimer > 0) f.shakeTimer = Math.max(0, f.shakeTimer - dt * 1.6);
        if (f.hitCd > 0) f.hitCd -= dt;
        if (f.type === 'bush') continue;
        const under = Math.hypot(player.x - f.x, player.y - f.y) < f.canopyR * 0.75;
        f.alpha += ((under ? 0.45 : 1) - f.alpha) * k;
    }
}

export function spawnLeafBurst(f, n) {
    const spread = f.canopyR * 0.6;
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2,
            sp = 60 + Math.random() * 100,
            d = Math.random() * spread,
            life = 0.8 + Math.random() * 0.6;
        particles.push({
            x: f.x + Math.cos(a) * d,
            y: f.y + Math.sin(a) * d,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            size: (Math.random() < 0.5 ? 2 : 3) * PX,
            color: f.pal[Math.random() < 0.5 ? 0 : 1],
            life,
            maxLife: life,
            square: true,
            drag: 3,
            phase: Math.random() * Math.PI * 2,
            amp: 18
        });
    }
}

function rustle(x, y) {
    if (Math.hypot(x - player.x, y - player.y) < 650) audio.playNoise(0.14, 2600, 0.05);
}

// Cars only ever touch the trunk; bushes just drag and burst
export function collideCarFoliage(c, dt) {
    const cr = c.spec.w * 0.52,
        mine = c === player.inCar;
    forEachNear(c.x, c.y, (f) => {
        const dx = c.x - f.x,
            dy = c.y - f.y,
            d = Math.hypot(dx, dy);
        if (f.trunkR) {
            const min = cr + f.trunkR;
            if (d >= min || d === 0) return;
            const nx = dx / d,
                ny = dy / d;
            c.x = f.x + nx * min;
            c.y = f.y + ny * min;
            const vn = c.vx * nx + c.vy * ny;
            if (vn >= 0) return;
            c.vx -= 1.35 * vn * nx;
            c.vy -= 1.35 * vn * ny;
            const impact = -vn;
            if (impact > 190) {
                c.hp -= impact * 0.06;
                if (mine) {
                    camera.shake = Math.max(camera.shake, 5);
                    buzz(20);
                }
            }
            if (f.hitCd <= 0 && impact > 40) {
                f.shakeTimer = Math.min(1, 0.4 + impact / 400);
                f.hitCd = 0.4;
                spawnLeafBurst(f, 8 + Math.min(6, Math.floor(impact / 60)));
                rustle(f.x, f.y);
            }
        } else {
            const sp = Math.hypot(c.vx, c.vy);
            if (sp < 40 || d > f.canopyR * 0.7 + cr * 0.3) return;
            const k = Math.pow(0.96, dt * 60);
            c.vx *= k;
            c.vy *= k;
            if (f.hitCd <= 0) {
                f.shakeTimer = 1;
                f.hitCd = 0.6;
                spawnLeafBurst(f, 8 + Math.floor(Math.random() * 7));
                rustle(f.x, f.y);
            }
        }
    });
}

// True if stepping (x0,y0)->(x1,y1) moves a walker of radius r further into a trunk (escaping is always allowed)
export function trunkBlocks(x0, y0, x1, y1, r) {
    let hit = false;
    forEachNear(x1, y1, (f) => {
        if (!f.trunkR || hit) return;
        const d1 = Math.hypot(x1 - f.x, y1 - f.y);
        if (d1 < f.trunkR + r && d1 < Math.hypot(x0 - f.x, y0 - f.y)) hit = true;
    });
    return hit;
}

// Deflects a walking heading tangentially around the nearest trunk ahead
export function steerAroundTrunks(x, y, ang, look = 34) {
    const dx = Math.cos(ang),
        dy = Math.sin(ang);
    let lat = null,
        bestT = Infinity;
    forEachNear(x, y, (f) => {
        if (!f.trunkR) return;
        const rx = f.x - x,
            ry = f.y - y,
            t = rx * dx + ry * dy,
            l = -rx * dy + ry * dx;
        if (t > 0 && t < look + f.trunkR && Math.abs(l) < f.trunkR + 10 && t < bestT) {
            bestT = t;
            lat = l;
        }
    });
    return lat === null ? ang : ang - (lat >= 0 ? 1 : -1) * 0.9;
}

// --- DRAWING (pre-baked canvases only) ---
// Pass A + B: ground shadow silhouettes, then trunks (world space, below peds & cars)
export function drawFoliageGround(ctx, list) {
    ctx.imageSmoothingEnabled = false;
    for (const f of list) {
        const s = f.size * (f.type === 'bush' ? 1 + f.shakeTimer * 0.15 : 1);
        ctx.drawImage(f.shadow, f.x + 8 - s / 2, f.y + 8 - s / 2, s, s);
    }
    for (const f of list) {
        if (!f.trunkR) continue;
        ctx.fillStyle = '#1B110E';
        for (let k = 0; k < 4; k++) {
            const a = f.seed + k * 1.7;
            ctx.fillRect(
                Math.round(f.x + Math.cos(a) * (f.trunkR + 1) - 1.5),
                Math.round(f.y + Math.sin(a) * (f.trunkR + 1) - 1.5),
                3,
                3
            );
        }
        ctx.fillStyle = '#3E2723';
        ctx.strokeStyle = '#1B110E';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.trunkR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    ctx.imageSmoothingEnabled = true;
}

// Pass C: elevated canopy, leaned away from the vanishing point like the buildings (screen space)
export function drawCanopy(ctx, f, vpSx, vpSy, hMul, shakeX, shakeY, t) {
    const z = camera.zoom;
    const sx = (f.x - camera.x) * z + view.w * 0.5 + shakeX,
        sy = (f.y - camera.y) * z + view.h * 0.5 + shakeY;
    const h = f.h * hMul;
    const wob = f.shakeTimer > 0 ? Math.sin(f.shakeTimer * 28) * f.shakeTimer * 6 : 0;
    const cx = sx + (sx - vpSx) * h + (Math.sin(t * 1.6 + f.seed) * 1.5 + wob) * z,
        cy = sy + (sy - vpSy) * h + wob * 0.5 * z;
    const s = f.size * z * (1 + h) * (f.type === 'bush' ? 1 + f.shakeTimer * 0.15 : 1);
    ctx.globalAlpha = f.alpha;
    if (f.trunkR) {
        // Trunk rising from the ground base to the leaning canopy (like building walls)
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#1B110E';
        ctx.lineWidth = (f.trunkR * 2 + 2) * z;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.strokeStyle = '#3E2723';
        ctx.lineWidth = f.trunkR * 2 * z;
        ctx.stroke();
        ctx.lineCap = 'butt';
    }
    ctx.drawImage(f.img, Math.round(cx - s / 2), Math.round(cy - s / 2), s, s);
    ctx.globalAlpha = 1;
}
