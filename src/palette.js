// --- PRINT PALETTE (the foldout street map) ---
export const INK = '#14130f';
export const PAPER = '#ece6d2';
export const WALK = '#e1d8bf';
export const ROAD = '#3a3b3e';
export const WATER = '#2f6db5';
export const PARK = '#79a957';
export const HAZARD = '#ffd400';
export const ROUTE = '#d23a2a';
export const STREETS_H = [
    '',
    'FERRY ST',
    'OLD MILL RD',
    'HARBOR AVE',
    'DIVISION ST',
    'CANAL ST',
    'KING ST',
    'BAYSHORE BLVD',
    'DOCK RD',
    'MERCHANT ST',
    'NEON ROW',
    'SALT ST',
    'RAILYARD RD',
    'CRANE AVE',
    'BREAKWATER RD',
    'LIGHTHOUSE ST'
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
    'PIER AVE',
    'LINDEN AVE',
    'SYCAMORE AVE',
    'ORCHARD ST',
    'GANTRY AVE',
    'TIDE ST',
    'ANCHOR AVE',
    'BEACON AVE'
];
export function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.round(Math.min(255, v * f));
    return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}
// --- NPC LOOKS (hair / skin recoloured onto the key-colour sprite; shirt comes from ped.color) ---
export const SKIN_TONES = ['#ffdbac', '#f1c9a0', '#e0ac69', '#c68642', '#8d5524', '#5c3a21'];
export const HAIR_COLORS = ['#14130f', '#2b1b10', '#4a2e1a', '#7a4a24', '#a8431f', '#d9b25a', '#bdbdb5', '#c13a8a'];
export const SHIRT_COLORS = [
    '#60a5fa',
    '#f472b6',
    '#34d399',
    '#c084fc',
    '#ffd400',
    '#e2e8f0',
    '#f87171',
    '#2dd4bf',
    '#a3e635'
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const PUNK_HAIR = ['#c13a8a', '#22e5ff', '#a3e635', '#14130f', '#ff2bd6'];
export function pedLook(role, hairPool = null) {
    const hair =
        role === 'boss' ? '#fef08a' : role === 'cop' ? pick(HAIR_COLORS.slice(0, 4)) : pick(hairPool || HAIR_COLORS);
    return { hair, skin: pick(SKIN_TONES) };
}
