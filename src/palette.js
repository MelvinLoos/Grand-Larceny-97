// --- PRINT PALETTE (the foldout street map) ---
export const INK = '#14130f';
export const PAPER = '#ece6d2';
export const WALK = '#e1d8bf';
export const ROAD = '#f7f2e2';
export const WATER = '#2f6db5';
export const PARK = '#79a957';
export const HAZARD = '#ffd400';
export const ROUTE = '#d23a2a';
export const DISTRICTS = {
    downtown: { name: 'DOWNTOWN NEON BAY', roofs: ['#dcb85a', '#cfa64a', '#e3c77c'] },
    park: { name: 'CENTRAL PARK PLAZA', roofs: ['#dcb85a', '#cfa64a', '#e3c77c'] },
    uptown: { name: 'UPTOWN FINANCIAL', roofs: ['#9fb6cc', '#8ea7bf', '#b3c6d8'] },
    west: { name: 'WESTSIDE HEIGHTS', roofs: ['#cf9474', '#c2805f', '#dba88c'] },
    dock: { name: 'SOUTHEAST DOCKYARD', roofs: ['#aaa69c', '#99958b', '#bcb8ae'] }
};
export const STREETS_H = [
    '',
    'FERRY ST',
    'OLD MILL RD',
    'HARBOR AVE',
    'DIVISION ST',
    'CANAL ST',
    'KING ST',
    'BAYSHORE BLVD',
    'DOCK RD'
];
export const STREETS_V = [
    '',
    '1ST AVE',
    '3RD AVE',
    '5TH AVE',
    'PARK AVE',
    '9TH AVE',
    '11TH AVE',
    'MARKET ST',
    'PIER AVE'
];
export function districtOf(tx, ty) {
    if (tx >= 11 && tx <= 17 && ty >= 11 && ty <= 17) return 'park';
    if (tx >= 21 && ty >= 21) return 'dock';
    if (ty < 9) return 'uptown';
    if (tx < 9) return 'west';
    return 'downtown';
}
export function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.round(Math.min(255, v * f));
    return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}
export function buildingPalette(x, y) {
    const roofs = DISTRICTS[districtOf(x, y)].roofs;
    const roof = roofs[(x * 7 + y * 13) % roofs.length];
    return { roof, wall: shade(roof, 0.8), dark: shade(roof, 0.62), win: PAPER };
}
