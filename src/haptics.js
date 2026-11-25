const canVibrate = typeof navigator.vibrate === 'function' && window.matchMedia('(pointer: coarse)').matches;
let last = 0;

// Single pulses are throttled; array patterns always go through.
export function buzz(pattern) {
    if (!canVibrate) return;
    if (typeof pattern === 'number') {
        const now = performance.now();
        if (now - last < 60) return;
        last = now;
    }
    navigator.vibrate(pattern);
}
