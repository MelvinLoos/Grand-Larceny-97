import {
    DISTRICT_SPLIT,
    MAP_SIZE,
    TILE,
    T_ALLEY,
    T_BAY,
    T_BLDG,
    T_GRASS,
    T_PAVEMENT,
    T_WATER,
    isSolidTile
} from './config.js';
import { LANDMARKS } from './city.js';
import { DISTRICTS, districtAtTile } from './districts.js';
import { INK, PAPER, WATER } from './palette.js';
import { bays, bldgMeta, game, mapGrid, mission, payphones, player } from './state.js';
import { BAY_INFO } from './shops.js';

// --- RADAR + FOLD-OUT CITY MAP ---
const PX = 4; // baked pixels per tile
let bake = null;

function bakeCity() {
    const c = document.createElement('canvas');
    c.width = c.height = MAP_SIZE * PX;
    const g = c.getContext('2d');
    for (let ty = 0; ty < MAP_SIZE; ty++) {
        for (let tx = 0; tx < MAP_SIZE; tx++) {
            const t = mapGrid[ty][tx];
            const d = DISTRICTS[districtAtTile(tx, ty)];
            let col;
            if (t === T_WATER) col = WATER;
            else if (t === T_GRASS) col = '#79a957';
            else if (t === T_BLDG) col = bldgMeta[ty][tx]?.roof || '#888';
            else if (t === T_ALLEY) col = '#8b5a45';
            else if (t === T_BAY) col = '#2d2c2e';
            else if (t === T_PAVEMENT) col = d.ground.walk;
            else col = d.ground.road;
            g.fillStyle = col;
            g.fillRect(tx * PX, ty * PX, PX, PX);
            if (isSolidTile(t) && t === T_BLDG) {
                g.fillStyle = 'rgba(20,19,15,0.25)';
                g.fillRect(tx * PX, ty * PX + PX - 1, PX, 1);
            }
        }
    }
    return c;
}

const ICONS = () => [
    ...bays.map((b) => ({ x: b.x, y: b.y, kind: b.type })),
    ...payphones.map((p) => ({ x: p.x, y: p.y, kind: 'phone' })),
    ...(mission.active ? [{ x: mission.targetX, y: mission.targetY, kind: 'target' }] : [])
];

// Draws one icon at (x, y) in canvas px; size is the icon radius
function drawIcon(g, kind, x, y, r, t) {
    const pulse = 1 + Math.sin(t * 5 + x) * 0.18;
    if (kind === 'phone') {
        g.fillStyle = '#ffd400';
        g.fillRect(x - r * 0.4, y - r * 0.4, r * 0.8, r * 0.8);
        return;
    }
    if (kind === 'target') {
        g.fillStyle = '#d23a2a';
        g.beginPath();
        g.arc(x, y, r * pulse, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = PAPER;
        g.lineWidth = 1.5;
        g.stroke();
        return;
    }
    const col = BAY_INFO[kind].color;
    const rr = r * pulse;
    g.fillStyle = INK;
    g.fillRect(x - rr - 1.5, y - rr - 1.5, rr * 2 + 3, rr * 2 + 3);
    g.fillStyle = col;
    g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    g.fillStyle = INK;
    g.font = `900 ${Math.round(rr * 1.7)}px "Archivo", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // cyan wrench/spray, red bomb dot, gold $
    g.fillText(kind === 'export' ? '$' : kind === 'bomb' ? '●' : '✱', x, y + 0.5);
}

function drawPlayer(g, x, y, r) {
    g.save();
    g.translate(x, y);
    g.rotate(player.angle);
    g.fillStyle = PAPER;
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(r * 1.3, 0);
    g.lineTo(-r, -r * 0.9);
    g.lineTo(-r * 0.4, 0);
    g.lineTo(-r, r * 0.9);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
}

// --- RADAR (corner of the HUD) ---
let radarCtx = null;
export function drawRadar(nowSec) {
    const cv = document.getElementById('radar');
    if (!cv || game.state === 'title') return;
    bake ||= bakeCity();
    const W = cv.width;
    radarCtx ||= cv.getContext('2d');
    const g = radarCtx;
    g.imageSmoothingEnabled = false;
    const span = 26; // tiles visible across the radar
    const k = W / (span * PX);
    const cx = (player.x / TILE) * PX;
    const cy = (player.y / TILE) * PX;
    g.fillStyle = WATER;
    g.fillRect(0, 0, W, W);
    g.save();
    g.scale(k, k);
    g.translate(-(cx - (span * PX) / 2), -(cy - (span * PX) / 2));
    g.drawImage(bake, 0, 0);
    g.restore();
    const half = W / 2 - 9;
    for (const ic of ICONS()) {
        let x = ((ic.x / TILE) * PX - cx) * k + W / 2;
        let y = ((ic.y / TILE) * PX - cy) * k + W / 2;
        const out = Math.abs(x - W / 2) > half || Math.abs(y - W / 2) > half;
        if (out) {
            x = Math.max(9, Math.min(W - 9, x));
            y = Math.max(9, Math.min(W - 9, y));
            if (ic.kind === 'phone') continue;
        }
        drawIcon(g, ic.kind, x, y, out ? 4 : 5.5, nowSec);
    }
    drawPlayer(g, W / 2, W / 2, 6);
}

// --- FULL CITY MAP (M) ---
let mapRaf = 0;
function drawFullMap() {
    const cv = document.getElementById('citymap');
    bake ||= bakeCity();
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const W = cv.width;
    const k = W / (MAP_SIZE * PX);
    const t = performance.now() * 0.001;
    g.fillStyle = WATER;
    g.fillRect(0, 0, W, W);
    g.drawImage(bake, 0, 0, W, W);
    // district names across the quadrants
    g.font = `italic 900 ${Math.round(W * 0.034)}px "Archivo", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    DISTRICTS.forEach((d, i) => {
        const x = ((i % 2 ? 0.75 : 0.25) * W) | 0;
        const y = ((i > 1 ? 0.75 : 0.25) * W) | 0;
        g.lineWidth = 5;
        g.strokeStyle = INK;
        g.strokeText(d.name, x, y);
        g.fillStyle = PAPER;
        g.fillText(d.name, x, y);
    });
    const split = (DISTRICT_SPLIT + 0.5) * PX * k;
    g.strokeStyle = 'rgba(236,230,210,0.5)';
    g.setLineDash([8, 8]);
    g.beginPath();
    g.moveTo(split, 0);
    g.lineTo(split, W);
    g.moveTo(0, split);
    g.lineTo(W, split);
    g.stroke();
    g.setLineDash([]);
    for (const ic of ICONS()) drawIcon(g, ic.kind, (ic.x / TILE) * PX * k, (ic.y / TILE) * PX * k, W * 0.014, t);
    drawPlayer(g, (player.x / TILE) * PX * k, (player.y / TILE) * PX * k, W * 0.014);
    // park label anchor
    g.fillStyle = INK;
    g.font = `700 ${Math.round(W * 0.016)}px "Barlow Condensed", sans-serif`;
    g.fillText('CENTRAL PARK', (LANDMARKS.parkCenter.x / TILE) * PX * k, (LANDMARKS.parkCenter.y / TILE) * PX * k);
    mapRaf = requestAnimationFrame(drawFullMap);
}

export function openCityMap() {
    if (game.mapOpen || game.state === 'title') return;
    game.mapOpen = true;
    game.mapFrom = game.state;
    if (game.state === 'play') game.state = 'paused';
    document.getElementById('map-overlay').hidden = false;
    const cv = document.getElementById('citymap');
    const size = Math.floor(Math.min(window.innerWidth * 0.94, window.innerHeight * 0.78, 880));
    cv.width = cv.height = size;
    drawFullMap();
}

export function closeCityMap() {
    if (!game.mapOpen) return;
    game.mapOpen = false;
    cancelAnimationFrame(mapRaf);
    document.getElementById('map-overlay').hidden = true;
    if (game.mapFrom === 'play') {
        game.state = 'play';
        game.lastFrameTime = performance.now();
    }
}
