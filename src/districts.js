import { DISTRICT_SPLIT, TILE } from './config.js';
import { PAPER, shade } from './palette.js';

// --- THE FOUR DISTRICTS ---
// idx: 0 = Downtown (NW), 1 = Parkside (NE), 2 = Midtown (SW), 3 = Harbor (SE)
export const D_DOWNTOWN = 0;
export const D_PARKSIDE = 1;
export const D_MIDTOWN = 2;
export const D_HARBOR = 3;

export const DISTRICTS = [
    {
        id: 'downtown',
        name: 'DOWNTOWN FINANCIAL',
        ground: { road: '#3b4350', walk: '#d6dce2', concrete: false, tiled: true },
        bldg: { stories: [4, 6], roofs: ['#7d8d9c', '#6b7b8b', '#94a3b0'], win: '#cfe6f5', winAlpha: 0.6 },
        blocks: { towers: 0.35, standard: 0.15, split: 0.12, L: 0.18, U: 0.08, plaza: 0.12 },
        foliage: {
            sideChance: 0.22,
            bushRatio: 0.85,
            pal: [
                ['sage', 0.4],
                ['meadow', 0.3],
                ['olive', 0.3]
            ]
        },
        traffic: { hellcrab: 3, cabbie: 3, police: 1.6, blitz: 1.2, bumbler: 1 },
        peds: { shirts: ['#1f2937', '#334155', '#e2e8f0', '#475569', '#64748b', '#0f172a'], suit: true }
    },
    {
        id: 'parkside',
        name: 'PARKSIDE',
        ground: { road: '#4a4845', walk: '#e1d8bf', concrete: false, tiled: false },
        bldg: { stories: [1, 2], roofs: ['#a5553f', '#b56a50', '#92472f'], win: PAPER, winAlpha: 0.5 },
        blocks: { standard: 0.5, L: 0.18, split: 0.1, plaza: 0.1, U: 0.12 },
        foliage: { sideChance: 0.45, bushRatio: 0.2, pal: null },
        traffic: { bumbler: 3, cabbie: 2, van: 1, blitz: 0.6, hellcrab: 0.3, police: 0.4 },
        peds: { shirts: null }
    },
    {
        id: 'midtown',
        name: 'RED LIGHT MIDTOWN',
        ground: { road: '#2a2a2f', walk: '#cfc3ae', concrete: false, tiled: false },
        bldg: {
            stories: [2, 3],
            roofs: ['#6b3a52', '#4f3a5e', '#7a4545'],
            win: '#ff4fd8',
            winAlpha: 0.8,
            neon: ['#ff2bd6', '#22e5ff']
        },
        blocks: { U: 0.34, split: 0.18, L: 0.14, standard: 0.2, plaza: 0.08, towers: 0.06 },
        foliage: {
            sideChance: 0.4,
            bushRatio: 0.2,
            pal: [
                ['maple', 0.45],
                ['sycamore', 0.4],
                ['oak', 0.15]
            ]
        },
        traffic: { blitz: 3, bumbler: 2, cabbie: 1, van: 0.6, hellcrab: 0.5, police: 0.5 },
        peds: { shirts: ['#14130f', '#7c2d92', '#be123c', '#0f766e', '#27272a', '#a21caf'], punk: true }
    },
    {
        id: 'harbor',
        name: 'HARBOR INDUSTRIAL',
        ground: { road: '#6e6a62', walk: '#b9b3a2', concrete: true, tiled: false },
        bldg: { stories: [1, 2], roofs: ['#8a4a2c', '#7b4a34', '#9a5a38'], win: '#d8cfb0', winAlpha: 0.35 },
        blocks: { split: 0.32, whRow: 0.28, whSingle: 0.14, L: 0.1, plaza: 0.1, standard: 0.06 },
        foliage: {
            sideChance: 0.1,
            bushRatio: 0.9,
            pal: [
                ['olive', 0.5],
                ['moss', 0.3],
                ['sage', 0.2]
            ]
        },
        traffic: { hauler: 2.4, van: 3, bumbler: 2, cabbie: 0.4, blitz: 0.3, police: 0.4 },
        peds: { shirts: ['#f59e0b', '#fb923c', '#a3a3a3', '#65a30d', '#facc15'], dock: true }
    }
];

export function districtAtTile(tx, ty) {
    return (tx >= DISTRICT_SPLIT ? 1 : 0) + (ty >= DISTRICT_SPLIT ? 2 : 0);
}
export function getDistrictAt(wx, wy) {
    return districtAtTile(Math.floor(wx / TILE), Math.floor(wy / TILE));
}

// Weighted pick from a { key: weight } table
export function pickWeighted(table, rand = Math.random) {
    let total = 0;
    for (const k in table) total += table[k];
    let r = rand() * total;
    for (const k in table) {
        r -= table[k];
        if (r <= 0) return k;
    }
    return Object.keys(table)[0];
}

// --- BUILDING LOOKS ---
export const CONTAINER_COLORS = ['#b8322a', '#2f6db5', '#d98b1f'];
const STORY_H = 0.14; // extrusion height per storey

export function buildingMeta(x, y, rand) {
    const di = districtAtTile(x, y);
    const d = DISTRICTS[di];
    const roof = d.bldg.roofs[(x * 7 + y * 13) % d.bldg.roofs.length];
    const [lo, hi] = d.bldg.stories;
    const stories = lo + Math.floor(rand() * (hi - lo + 1));
    return {
        h: stories * STORY_H + ((x * 17 + y * 31) % 3) * 0.015,
        roof,
        wall: shade(roof, 0.8),
        dark: shade(roof, 0.62),
        win: d.bldg.win,
        winAlpha: d.bldg.winAlpha,
        neon: d.bldg.neon ? d.bldg.neon[(x + y) % d.bldg.neon.length] : null,
        style: (x * 3 + y * 7) % 4,
        kind: 'building'
    };
}

export function containerMeta(x, y) {
    const c = CONTAINER_COLORS[(x * 5 + y * 3) % CONTAINER_COLORS.length];
    return {
        h: 0.09 + ((x + y) % 2) * 0.05,
        roof: c,
        wall: shade(c, 0.82),
        dark: shade(c, 0.6),
        win: shade(c, 0.5),
        winAlpha: 0,
        neon: null,
        style: -1,
        kind: 'container'
    };
}
