import { INK } from './palette.js';

// --- GRIMY PRINT: procedural wear + hand-drawn character frames (generated once at load) ---
// PNG sheets in src/assets/sprites/ override the procedural ones when present (see loadOverrides).
const SPRITE_URLS = import.meta.glob('./assets/sprites/*.png', { eager: true, query: '?url', import: 'default' });

export const GRIME = (() => {
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
    function cv(w, h) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
    }
    const S = 112; // overlay resolution (drawn up to TILE size)
    function speckle(g, r, n, rgb, aMax, sMax) {
        for (let i = 0; i < n; i++) {
            g.fillStyle = `rgba(${rgb},${(r() * aMax).toFixed(3)})`;
            const s = 0.6 + r() * sMax;
            g.fillRect(r() * S, r() * S, s, s);
        }
    }
    function stain(g, r, rgb, a, rad) {
        const x = r() * S,
            y = r() * S,
            k = rad * (0.6 + r() * 0.8);
        const gr = g.createRadialGradient(x, y, 0, x, y, k);
        gr.addColorStop(0, `rgba(${rgb},${a})`);
        gr.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = gr;
        g.fillRect(x - k, y - k, k * 2, k * 2);
    }
    function crack(g, r, alpha) {
        g.strokeStyle = `rgba(20,19,15,${alpha})`;
        g.lineWidth = 0.9;
        g.lineCap = 'round';
        let x = r() * S,
            y = r() * S,
            a = r() * 6.28;
        g.beginPath();
        g.moveTo(x, y);
        for (let i = 0; i < 9; i++) {
            a += (r() - 0.5) * 1.3;
            x += Math.cos(a) * 6;
            y += Math.sin(a) * 6;
            g.lineTo(x, y);
        }
        g.stroke();
    }
    function make(n, seed, paint) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const c = cv(S, S),
                g = c.getContext('2d');
            paint(g, rng(seed + i * 977));
            out.push(c);
        }
        return out;
    }
    const road = make(4, 11, (g, r) => {
        speckle(g, r, 420, '20,19,15', 0.22, 1.6);
        speckle(g, r, 120, '255,252,240', 0.25, 1.2);
        for (let i = 0; i < 3; i++) stain(g, r, '20,19,15', 0.1, 26);
        stain(g, r, '40,30,20', 0.16, 10); // oil spot
        if (r() < 0.7) crack(g, r, 0.35);
        if (r() < 0.4) crack(g, r, 0.28);
    });
    // Harbor roads: pale, cracked, stained concrete slabs
    const concrete = make(4, 311, (g, r) => {
        speckle(g, r, 380, '20,19,15', 0.2, 1.8);
        speckle(g, r, 160, '255,252,240', 0.22, 1.4);
        for (let i = 0; i < 3; i++) stain(g, r, '60,48,34', 0.14, 30);
        g.strokeStyle = 'rgba(20,19,15,0.22)';
        g.lineWidth = 1.5; // slab joints
        g.beginPath();
        g.moveTo(S * 0.5, 0);
        g.lineTo(S * 0.5, S);
        g.moveTo(0, S * 0.5);
        g.lineTo(S, S * 0.5);
        g.stroke();
        for (let i = 0; i < 3; i++) crack(g, r, 0.42);
    });
    const walk = make(4, 51, (g, r) => {
        speckle(g, r, 300, '20,19,15', 0.2, 1.4);
        for (let i = 0; i < 2; i++) stain(g, r, '74,69,58', 0.12, 30);
        g.strokeStyle = 'rgba(20,19,15,0.2)';
        g.lineWidth = 1;
        const o = 20 + r() * 20;
        g.beginPath();
        g.moveTo(o, 0);
        g.lineTo(o + (r() - 0.5) * 6, S);
        g.moveTo(0, o + 30);
        g.lineTo(S, o + 30 + (r() - 0.5) * 6);
        g.stroke();
        if (r() < 0.6) crack(g, r, 0.4);
    });
    const grass = make(3, 91, (g, r) => {
        speckle(g, r, 320, '20,19,15', 0.16, 1.4);
        speckle(g, r, 160, '150,190,100', 0.3, 1.4);
        for (let i = 0; i < 3; i++) stain(g, r, '96,70,40', 0.12, 16); // bare earth patches
    });
    const roof = make(4, 131, (g, r) => {
        speckle(g, r, 380, '20,19,15', 0.18, 1.6);
        for (let i = 0; i < 4; i++) stain(g, r, '40,34,24', 0.14, 24);
        g.strokeStyle = 'rgba(20,19,15,0.13)';
        g.lineWidth = 2; // rain streaks from the edge
        for (let i = 0; i < 5; i++) {
            const x = r() * S;
            g.beginPath();
            g.moveTo(x, S);
            g.lineTo(x + (r() - 0.5) * 4, S - 18 - r() * 40);
            g.stroke();
        }
    });
    const water = make(2, 171, (g, r) => {
        speckle(g, r, 200, '255,255,255', 0.12, 1.4);
        speckle(g, r, 120, '10,30,60', 0.14, 1.6);
    });
    // paper fold + grain over the whole viewport, built once as a pattern
    const paper = (() => {
        const c = cv(256, 256),
            g = c.getContext('2d'),
            r = rng(7);
        for (let i = 0; i < 900; i++) {
            g.fillStyle = `rgba(74,69,58,${(r() * 0.1).toFixed(3)})`;
            g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
        }
        for (let i = 0; i < 160; i++) {
            g.strokeStyle = `rgba(255,250,235,${(r() * 0.12).toFixed(3)})`;
            g.beginPath();
            const x = r() * 256,
                y = r() * 256;
            g.moveTo(x, y);
            g.lineTo(x + (r() - 0.5) * 14, y + (r() - 0.5) * 14);
            g.stroke();
        }
        return c;
    })();

    // --- hand-drawn characters: 8 walk frames x 3 line-boil variants, facing +X, cell is 36 world px (2x res) ---
    const CELL = 36,
        K = 2,
        FR = 8,
        BOIL = 3;
    const charCache = new Map();
    const npcCache = new Map();
    function wobblyPath(g, r, pts, jit) {
        g.beginPath();
        pts.forEach(([x, y], i) => {
            const px = x + (r() - 0.5) * jit,
                py = y + (r() - 0.5) * jit;
            i ? g.lineTo(px, py) : g.moveTo(px, py);
        });
        g.closePath();
    }
    function circlePts(cx, cy, rad, n) {
        const a = [];
        for (let i = 0; i < n; i++)
            a.push([cx + Math.cos((i / n) * 6.283) * rad, cy + Math.sin((i / n) * 6.283) * rad]);
        return a;
    }
    function drawChar(g, r, phase, shirt, head, dead) {
        g.save();
        g.scale(K, K);
        g.translate(CELL / 2, CELL / 2);
        g.lineJoin = 'round';
        g.lineCap = 'round';
        const sw = Math.sin(phase) * 4.5,
            sw2 = Math.sin(phase + 3.14159) * 4.5;
        g.fillStyle = 'rgba(20,19,15,0.3)';
        g.beginPath();
        g.ellipse(2, 3, 9.5, 8, 0, 0, 6.283);
        g.fill();
        if (dead) {
            // sprawled body: splayed limbs, smeared shirt
            g.strokeStyle = INK;
            g.lineWidth = 2.4;
            for (const [x, y] of [
                [-9, -8],
                [-8, 9],
                [9, -7],
                [8, 8]
            ]) {
                g.beginPath();
                g.moveTo(0, 0);
                g.lineTo(x + (r() - 0.5) * 3, y + (r() - 0.5) * 3);
                g.stroke();
            }
            g.fillStyle = shirt;
            g.strokeStyle = INK;
            g.lineWidth = 1.5;
            wobblyPath(g, r, circlePts(0, 0, 7.5, 9), 2);
            g.fill();
            g.stroke();
            g.fillStyle = head;
            g.beginPath();
            g.arc(5, 1, 4.6, 0, 6.283);
            g.fill();
            g.stroke();
            g.restore();
            return;
        }
        // legs/shoes (alternate fore-aft), arms swinging opposite
        g.strokeStyle = INK;
        g.lineWidth = 3.4;
        g.beginPath();
        g.moveTo(0, -3);
        g.lineTo(sw * 1.5, -9.5);
        g.moveTo(0, 3);
        g.lineTo(sw2 * 1.5, 9.5);
        g.stroke();
        g.strokeStyle = '#1e293b';
        g.lineWidth = 1.8;
        g.beginPath();
        g.moveTo(0, -3);
        g.lineTo(sw * 1.5, -9.5);
        g.moveTo(0, 3);
        g.lineTo(sw2 * 1.5, 9.5);
        g.stroke();
        g.strokeStyle = INK;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(0, -6);
        g.lineTo(sw2 * 1.2, -11);
        g.moveTo(0, 6);
        g.lineTo(sw * 1.2, 11);
        g.stroke();
        g.strokeStyle = shirt;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(0, -6);
        g.lineTo(sw2 * 1.2, -11);
        g.moveTo(0, 6);
        g.lineTo(sw * 1.2, 11);
        g.stroke();
        // torso
        g.fillStyle = shirt;
        g.strokeStyle = INK;
        g.lineWidth = 1.5;
        wobblyPath(
            g,
            r,
            [
                [-5, -8],
                [-1, -8.6],
                [4, -7.5],
                [6, -4],
                [6.4, 0],
                [6, 4],
                [4, 7.6],
                [-1, 8.5],
                [-5, 7.8],
                [-6.5, 0]
            ],
            1.3
        );
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(20,19,15,0.35)';
        g.lineWidth = 0.9; // pen hatching
        for (let i = 0; i < 3; i++) {
            g.beginPath();
            g.moveTo(-4.5 + i * 1.6, 3.5 + (r() - 0.5));
            g.lineTo(-2.8 + i * 1.6, 7 + (r() - 0.5));
            g.stroke();
        }
        // head
        g.fillStyle = head;
        g.strokeStyle = INK;
        g.lineWidth = 1.5;
        wobblyPath(g, r, circlePts(0.5, 0, 5, 9), 0.9);
        g.fill();
        g.stroke();
        g.fillStyle = 'rgba(20,19,15,0.75)'; // hair cap
        g.beginPath();
        g.arc(-0.6, 0, 4.4, Math.PI * 0.55, Math.PI * 1.45);
        g.closePath();
        g.fill();
        g.restore();
    }
    // Optional PNG overrides in src/assets/sprites/ (bundled at build time; absent files are simply not loaded).
    // ped_walk.png: 8 frames per row, 1+ rows (extra rows = line-boil variants), facing +X, grayscale/light
    //   figure is multiplied by the shirt colour. ped_dead.png: 3 frames per row, same rules.
    // player_walk.png: pre-coloured (not tinted) on-foot player, N square frames in one row, facing +X.
    // npc_walk.png: colour-key NPC sheet (same layout): pure blue #0000ff = clothes, green #00ff00 = hair,
    //   white #ffffff = skin; every other pixel (ink outline) is kept. Recoloured per NPC at runtime.
    // tile_road|walk|grass|roof|water.png: one seamless texture each, alpha overlay.
    const ov = {};
    function loadOverrides() {
        const load = (name, cb) => {
            const url = SPRITE_URLS['./assets/sprites/' + name + '.png'];
            if (!url) return;
            const im = new Image();
            im.onload = () => cb(im);
            im.src = url;
        };
        load('ped_walk', (im) => {
            ov.walk = im;
            charCache.clear();
        });
        load('player_walk', (im) => {
            ov.player = im;
        });
        load('npc_walk', (im) => {
            const c = cv(im.width, im.height),
                g = c.getContext('2d');
            g.drawImage(im, 0, 0);
            ov.npc = im;
            ov.npcData = g.getImageData(0, 0, c.width, c.height);
            npcCache.clear();
        });
        load('ped_dead', (im) => {
            ov.dead = im;
            charCache.clear();
        });
        for (const k of ['road', 'walk', 'grass', 'roof', 'water'])
            load('tile_' + k, (im) => {
                const t = GRIME[k];
                for (let i = 0; i < t.length; i++) t[i] = im;
            });
    }
    function tinted(im, frames, shirt) {
        const c = cv(im.width, im.height),
            g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = shirt;
        g.fillRect(0, 0, c.width, c.height);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(im, 0, 0);
        c._frames = frames;
        return c;
    }
    function sheetFor(shirt, head, dead) {
        const key = shirt + '|' + head + (dead ? '|d' : '');
        let s = charCache.get(key);
        if (s) return s;
        const o = dead ? ov.dead : ov.walk;
        if (o) {
            charCache.set(key, (s = tinted(o, dead ? 3 : FR, shirt)));
            return s;
        }
        const frames = dead ? 3 : FR,
            c = cv(CELL * K * frames, CELL * K * BOIL),
            g = c.getContext('2d'),
            r = rng(shirt.length * 31 + (dead ? 5 : 3));
        for (let b = 0; b < BOIL; b++)
            for (let f = 0; f < frames; f++) {
                g.save();
                g.translate(f * CELL * K, b * CELL * K);
                g.beginPath();
                g.rect(0, 0, CELL * K, CELL * K);
                g.clip();
                drawChar(g, r, (f / FR) * 6.283, shirt, head, dead);
                g.restore();
            }
        c._frames = frames;
        charCache.set(key, (s = c));
        return s;
    }
    // phase in radians, t in seconds (drives line boil), salt de-syncs boil between characters
    function drawPed(g, phase, t, salt, shirt, head, moving) {
        const sh = sheetFor(shirt, head, false);
        const f = moving ? Math.floor(((((phase / 6.28318) % 1) + 1) % 1) * FR) : 0;
        const cw = sh.width / sh._frames,
            rows = Math.max(1, Math.round(sh.height / cw));
        const b = (Math.floor(t * 8) + salt) % rows;
        g.drawImage(sh, f * cw, b * cw, cw, cw, -CELL / 2, -CELL / 2, CELL, CELL);
    }
    // Pre-coloured player sprite; returns false (caller falls back to drawPed) until the PNG has loaded.
    const PLAYER_SIZE = 30;
    // Right-hand tip per frame in sprite px (frame is 32x32, +X forward), so the gun is gripped, not floating.
    const PLAYER_HAND = [
        [16.5, 27.5],
        [17, 25.5],
        [14.5, 24.5],
        [16.5, 25.5]
    ];
    // Frame pick + shadow + pixel-perfect draw shared by the player and NPC sheets; returns the frame index.
    function drawSheet(g, im, phase, moving, hand) {
        const fh = im.height,
            frames = Math.max(1, Math.round(im.width / fh));
        const f = moving ? Math.floor(((((phase / 6.28318) % 1) + 1) % 1) * frames) : 0;
        g.fillStyle = 'rgba(20,19,15,0.3)';
        g.beginPath();
        g.ellipse(2, 3, 9.5, 8, 0, 0, 6.283);
        g.fill();
        if (hand) hand(f, fh);
        g.save();
        g.imageSmoothingEnabled = false;
        g.drawImage(im, f * fh, 0, fh, fh, -PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
        g.restore();
    }
    function drawPlayer(g, phase, moving, armed) {
        const im = ov.player;
        if (!im) return false;
        drawSheet(
            g,
            im,
            phase,
            moving,
            armed &&
                ((f, fh) => {
                    // drawn first so the sprite's hand overlaps the grip
                    const k = PLAYER_SIZE / fh,
                        [hx, hy] = PLAYER_HAND[f % PLAYER_HAND.length];
                    g.fillStyle = '#27272a';
                    g.fillRect((hx - 0.5 - fh / 2) * k, (hy - 1.8 - fh / 2) * k, 10, 3.5);
                })
        );
        return true;
    }
    function hexRgb(h) {
        const n = parseInt(h.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    // Key-colour sheet recoloured for one look; cached per shirt|hair|skin.
    function npcSheet(shirt, hair, skin) {
        const key = shirt + '|' + hair + '|' + skin;
        let c = npcCache.get(key);
        if (c) return c;
        const src = ov.npcData,
            d = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height),
            px = d.data,
            map = { 255: hexRgb(shirt), 65280: hexRgb(hair), 16777215: hexRgb(skin) };
        for (let i = 0; i < px.length; i += 4) {
            if (!px[i + 3]) continue;
            const m = map[(px[i] << 16) | (px[i + 1] << 8) | px[i + 2]];
            if (m) [px[i], px[i + 1], px[i + 2]] = m;
        }
        c = cv(src.width, src.height);
        c.getContext('2d').putImageData(d, 0, 0);
        npcCache.set(key, c);
        return c;
    }
    // Recoloured NPC sprite; returns false (caller falls back to drawPed) until the PNG has loaded.
    function drawNpc(g, phase, moving, shirt, hair, skin) {
        if (!ov.npcData) return false;
        drawSheet(g, npcSheet(shirt, hair, skin), phase, moving);
        return true;
    }
    function drawCorpse(g, variant, shirt, head) {
        const sh = sheetFor(shirt, head, true);
        const cw = sh.width / 3,
            rows = Math.max(1, Math.round(sh.height / cw));
        g.drawImage(sh, (variant % 3) * cw, (variant % rows) * cw, cw, cw, -CELL / 2, -CELL / 2, CELL, CELL);
    }
    loadOverrides();
    return { road, concrete, walk, grass, roof, water, paper, drawPed, drawPlayer, drawNpc, drawCorpse };
})();
