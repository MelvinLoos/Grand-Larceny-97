import { MAP_SIZE, TILE, T_RAMP } from './config.js';
import { cv } from './foliage.js';
import { GRIME } from './grime.js';
import { HAZARD, INK, WATER } from './palette.js';
import { RIVER, lowBarriers } from './river.js';
import { bldgMeta, mapGrid } from './state.js';

// --- RIVER, BRIDGES, SEAWALLS & THE BROKEN DRAWBRIDGE (ground + overlay passes) ---
// Everything is flat rect art with ink casings, snapped to whole pixels: no per-frame allocation.
const T = TILE;
const LIP = T / 2;
const STEEL = '#8f9aa6';
const STEEL_HI = '#c3ccd5';
const CONCRETE = '#b9b2a0';
const AMBER = '#ffb000';
const isBridge = (tx, ty) => bldgMeta[ty]?.[tx]?.kind === 'bridge';

// Bridge and ramp tiles whose guardrails are drawn after the cars (rails stand taller than a deck car)
export const overlayTiles = [];

// Water tiles: river tint, glints, wave scanlines, seawall shadow, piers under the bridges, slipways
export function drawWaterDecor(g, tx, ty, x, y, nowMs) {
    const t = nowMs * 0.001;
    const river = tx >= RIVER.x0 && tx <= RIVER.x1 && ty > 0 && ty < MAP_SIZE - 1;
    if (river) {
        g.fillStyle = 'rgba(16, 96, 112, 0.22)';
        g.fillRect(x, y, T + 1, T + 1);
    }
    // wave scanlines drifting down the channel
    g.fillStyle = 'rgba(236, 244, 240, 0.10)';
    for (let k = 0; k < 2; k++) {
        const yy = (((t * 14 + k * 72 + tx * 31 + ty * 17) % T) + T) % T;
        g.fillRect(x, Math.round(y + yy), T + 1, 2);
    }
    // specular glints
    for (let k = 0; k < 5; k++) {
        const h = ((tx * 73856093) ^ (ty * 19349663) ^ (k * 83492791)) >>> 0;
        const s = Math.sin(t * 2.3 + (h & 255) * 0.05);
        if (s < 0.62) continue;
        g.fillStyle = s > 0.9 ? '#f2f8f6' : '#9fd8e6';
        g.fillRect(Math.round(x + (h % 118)), Math.round(y + ((h >> 8) % 136)), s > 0.9 ? 12 : 8, 2);
    }

    // The bridge above casts its shadow south onto the water; piers poke out on both sides
    if (isBridge(tx, ty - 1)) {
        g.fillStyle = 'rgba(8, 28, 48, 0.30)';
        g.fillRect(x, y, T + 1, 34);
        g.fillStyle = 'rgba(8, 28, 48, 0.16)';
        g.fillRect(x, y + 34, T + 1, 14);
        drawPier(g, x + 56, y, false);
    }
    if (isBridge(tx, ty + 1)) drawPier(g, x + 56, y + T - 30, true);

    if (ty === MAP_SIZE - 1 && RIVER.slips.includes(tx)) drawSlipway(g, x, y);
}

function drawPier(g, x, y, nearBridgeAbove) {
    g.fillStyle = INK;
    g.fillRect(x - 2, y - 2, 36, 34);
    g.fillStyle = '#9a9588';
    g.fillRect(x, y, 32, 30);
    g.fillStyle = '#b9b2a0';
    g.fillRect(x, y, 32, 5);
    g.fillStyle = 'rgba(20, 19, 15, 0.25)';
    g.fillRect(x + 22, y, 10, 30);
    g.fillStyle = 'rgba(242, 248, 246, 0.8)'; // foam where the water meets the pillar
    g.fillRect(x - 3, nearBridgeAbove ? y - 4 : y + 27, 38, 3);
}

function drawSlipway(g, x, y) {
    g.fillStyle = INK;
    g.fillRect(x + 6, y - 2, T - 12, 92);
    g.fillStyle = '#a8a291';
    g.fillRect(x + 9, y, T - 18, 88);
    g.fillStyle = 'rgba(20, 19, 15, 0.28)';
    for (let k = 10; k < 88; k += 11) g.fillRect(x + 9, y + k, T - 18, 2);
    g.fillStyle = 'rgba(16, 96, 112, 0.45)'; // the wet end disappears under the surface
    g.fillRect(x + 9, y + 62, T - 18, 26);
}

// Ground-level street furniture lying in a water tile: seawall parapets, ladders, bollards, sawhorses
export function drawTileBarriers(g, tx, ty) {
    const list = lowBarriers.get(ty * MAP_SIZE + tx);
    if (!list) return;
    for (const b of list) {
        if (b.broken || b.kind === 'rail') continue;
        const w = b.x1 - b.x0;
        const h = b.y1 - b.y0;
        if (b.kind === 'wall' || b.kind === 'ladder') {
            // shadow on the water side (the parapet is the dark edge of the quay)
            if (b.d !== undefined) {
                g.fillStyle = 'rgba(8, 28, 48, 0.30)';
                if (b.d === 0) g.fillRect(b.x0 - 18, b.y0, 18, h);
                else if (b.d === 2) g.fillRect(b.x1, b.y0, 18, h);
                else if (b.d === 1) g.fillRect(b.x0, b.y0 - 18, w, 18);
                else g.fillRect(b.x0, b.y1, w, 18);
            }
            g.fillStyle = CONCRETE;
            g.fillRect(b.x0, b.y0, w, h);
            g.strokeStyle = INK;
            g.lineWidth = 2;
            g.strokeRect(b.x0 + 1, b.y0 + 1, w - 2, h - 2);
            g.fillStyle = 'rgba(236, 230, 210, 0.55)'; // lit top edge, land side
            if (b.d === 0) g.fillRect(b.x1 - 5, b.y0 + 2, 3, h - 4);
            else if (b.d === 2) g.fillRect(b.x0 + 2, b.y0 + 2, 3, h - 4);
            else if (b.d === 1) g.fillRect(b.x0 + 2, b.y1 - 5, w - 4, 3);
            else g.fillRect(b.x0 + 2, b.y0 + 2, w - 4, 3);
            if (b.kind === 'ladder') drawLadder(g, b);
            else {
                g.fillStyle = 'rgba(20, 19, 15, 0.22)';
                if (w > h) for (let k = 36; k < w; k += 36) g.fillRect(b.x0 + k, b.y0 + 2, 2, h - 4);
                else for (let k = 36; k < h; k += 36) g.fillRect(b.x0 + 2, b.y0 + k, w - 4, 2);
            }
        } else if (b.kind === 'bollard') {
            g.fillStyle = 'rgba(8, 28, 48, 0.25)';
            g.fillRect(b.d === 0 ? b.x0 - 14 : b.x1, b.y0, 14, h);
            for (let yy = b.y0 + 8; yy < b.y1 - 4; yy += 26) {
                const cx = (b.x0 + b.x1) / 2;
                g.fillStyle = INK;
                g.fillRect(cx - 7, yy - 1, 14, 14);
                g.fillStyle = '#8b5a45';
                g.fillRect(cx - 5, yy + 1, 10, 10);
                g.fillStyle = '#c89a6a';
                g.fillRect(cx - 5, yy + 1, 10, 3);
            }
        } else if (b.kind === 'sawhorse') {
            g.fillStyle = INK;
            g.fillRect(b.x0 - 1, b.y0 - 1, w + 2, h + 2);
            for (let yy = b.y0, i = 0; yy < b.y1; yy += 14, i++) {
                g.fillStyle = i & 1 ? '#f4efe0' : '#e8731f';
                g.fillRect(b.x0 + 1, yy, w - 2, Math.min(14, b.y1 - yy));
            }
        }
    }
}

function drawLadder(g, b) {
    const horiz = b.d === 0 || b.d === 2; // rails run into the water, perpendicular to the wall
    g.fillStyle = INK;
    if (horiz) {
        const wx = b.d === 0 ? b.x0 - 14 : b.x0;
        const len = b.x1 - b.x0 + 14;
        g.fillRect(wx - 1, b.y0 + 5, len + 2, 6);
        g.fillRect(wx - 1, b.y1 - 11, len + 2, 6);
        g.fillStyle = HAZARD;
        g.fillRect(wx, b.y0 + 6, len, 4);
        g.fillRect(wx, b.y1 - 10, len, 4);
        g.fillStyle = INK;
        for (let k = 3; k < len; k += 6) g.fillRect(wx + k, b.y0 + 10, 2, b.y1 - b.y0 - 20);
    } else {
        const wy = b.d === 1 ? b.y0 - 14 : b.y0;
        const len = b.y1 - b.y0 + 14;
        g.fillRect(b.x0 + 5, wy - 1, 6, len + 2);
        g.fillRect(b.x1 - 11, wy - 1, 6, len + 2);
        g.fillStyle = HAZARD;
        g.fillRect(b.x0 + 6, wy, 4, len);
        g.fillRect(b.x1 - 10, wy, 4, len);
    }
}

// Steel deck: asphalt on a grated plate, expansion joints, yellow centre dashes
export function drawBridgeDeck(g, tx, ty, x, y) {
    g.fillStyle = '#58606a';
    g.fillRect(x, y, T + 1, T + 1);
    g.drawImage(GRIME.concrete[(tx * 5 + ty * 11) & 3], x, y, T + 1, T + 1);
    for (const jx of [0, LIP]) {
        g.fillStyle = INK;
        g.fillRect(x + jx, y + 10, 4, T - 20);
        g.fillStyle = 'rgba(236, 230, 210, 0.35)';
        g.fillRect(x + jx + 4, y + 10, 2, T - 20);
    }
    g.fillStyle = HAZARD;
    for (let d = 12; d < T; d += 36) g.fillRect(x + d, y + T / 2 - 2, 20, 4);
    overlayTiles.push(tx, ty);
}

// Guardrails (cars on the deck pass under them in the draw order): girder bar, lit edge, posts
function drawRail(g, x, y, w, top) {
    g.fillStyle = 'rgba(0, 0, 0, 0.22)';
    g.fillRect(x, top ? y + 8 : y - 5, w, 5);
    g.fillStyle = INK;
    g.fillRect(x, y, w, 8);
    g.fillStyle = STEEL;
    g.fillRect(x, y + 1, w, 6);
    g.fillStyle = STEEL_HI;
    g.fillRect(x, top ? y + 1 : y + 5, w, 2);
    g.fillStyle = INK;
    for (let k = 6; k < w; k += 36) g.fillRect(x + k, y + 2, 4, 4);
}

export function drawBridgeRails(g, tx, ty) {
    const x = tx * T;
    const y = ty * T;
    if (isBridge(tx, ty)) {
        drawRail(g, x, y, T + 1, true);
        drawRail(g, x, y + T - 8, T + 1, false);
    } else {
        const west = tx === RIVER.x0;
        const sx = west ? x : x + LIP;
        drawRail(g, sx, y, LIP, true);
        drawRail(g, sx, y + T - 8, LIP, false);
    }
}

// Broken drawbridge half: hazard-chevron ramp stub, jagged lip, flashing amber beacons, open water beyond
export function drawRampTile(g, tx, ty, x, y, nowSec) {
    g.fillStyle = WATER;
    g.fillRect(x, y, T + 1, T + 1);
    g.drawImage(GRIME.water[(tx + ty) & 1], x, y, T + 1, T + 1);
    g.fillStyle = 'rgba(16, 96, 112, 0.22)';
    g.fillRect(x, y, T + 1, T + 1);
    const west = tx === RIVER.x0;
    const dir = west ? 1 : -1; // direction of travel towards the lip
    const sx = west ? x : x + LIP;
    const lipX = west ? sx + LIP : sx;

    g.fillStyle = 'rgba(8, 28, 48, 0.32)'; // the cut-off span's shadow on the river
    g.fillRect(west ? lipX : lipX - 22, y, 22, T);

    g.save();
    g.beginPath();
    g.rect(sx, y, LIP, T);
    g.clip();
    g.fillStyle = HAZARD;
    g.fillRect(sx, y, LIP, T);
    g.strokeStyle = INK;
    g.lineWidth = 12;
    g.beginPath();
    for (let a = sx - 40; a < sx + LIP + 40; a += 30) {
        g.moveTo(a, y);
        g.lineTo(a + dir * 36, y + T / 2);
        g.lineTo(a, y + T);
    }
    g.stroke();
    // the stub tilts up: dark at the foot, bright at the lip
    const grad = g.createLinearGradient(west ? sx : sx + LIP, 0, west ? sx + LIP : sx, 0);
    grad.addColorStop(0, 'rgba(20, 19, 15, 0.38)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.12)');
    g.fillStyle = grad;
    g.fillRect(sx, y, LIP, T);
    g.restore();
    g.fillStyle = INK;
    g.fillRect(west ? lipX - 5 : lipX, y, 5, T);
    // snapped girder teeth sticking out over the water
    g.fillStyle = '#3a3f46';
    for (let k = 4; k < T - 14; k += 26) {
        g.beginPath();
        g.moveTo(lipX, y + k);
        g.lineTo(lipX + dir * (8 + ((k * 7) % 11)), y + k + 11);
        g.lineTo(lipX, y + k + 22);
        g.closePath();
        g.fill();
    }
    // amber beacons, alternating
    const on = Math.floor(nowSec * 2.5) % 2;
    for (let i = 0; i < 2; i++) {
        const bx = lipX - dir * 14;
        const by = i ? y + T - 22 : y + 14;
        const lit = (i + on) % 2 === 0;
        if (lit) {
            g.fillStyle = 'rgba(255, 176, 0, 0.30)';
            g.fillRect(bx - 12, by - 12, 32, 32);
        }
        g.fillStyle = INK;
        g.fillRect(bx - 1, by - 1, 10, 10);
        g.fillStyle = lit ? AMBER : '#5a3a00';
        g.fillRect(bx + 1, by + 1, 6, 6);
    }
    overlayTiles.push(tx, ty);
}

// Sinking cars: the car silhouette tinted deep teal
export function tealOf(skin) {
    if (skin.teal) return skin.teal;
    const c = cv(skin.tw, skin.th);
    const g = c.getContext('2d');
    g.drawImage(skin.mask, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#17566a';
    g.fillRect(0, 0, c.width, c.height);
    return (skin.teal = c);
}

// Scale the context about the car: loom closer while airborne, shrink as it goes under
export function applyAirScale(g, c) {
    const loom = 1 + Math.min(0.32, Math.max(0, c.z / 120));
    const k = loom * (1 - 0.25 * Math.min(1, c.sink || 0));
    g.scale(k, k);
}

export const isRampCell = (tx, ty) => mapGrid[ty]?.[tx] === T_RAMP;
