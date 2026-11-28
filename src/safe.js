// Resolved px values of the device safe-area insets (notch, Dynamic Island, home indicator).
// CSS env() can't be read back from custom properties, so measure a hidden probe instead.
let probe;
export function safeInsets() {
    if (!probe) {
        probe = document.createElement('div');
        probe.style.cssText =
            'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
            'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
        document.body.appendChild(probe);
    }
    const cs = getComputedStyle(probe);
    return {
        t: parseFloat(cs.paddingTop) || 0,
        r: parseFloat(cs.paddingRight) || 0,
        b: parseFloat(cs.paddingBottom) || 0,
        l: parseFloat(cs.paddingLeft) || 0
    };
}
