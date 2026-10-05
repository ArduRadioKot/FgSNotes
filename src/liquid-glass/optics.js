// Lens optics for Liquid Glass. Pure functions, no DOM.
// Model: a convex "squircle" bezel. A vertical ray entering the curved rim is bent by Snell's law,
// so the background seen at the rim is shifted outward; the flat centre shifts nothing.
(function (root) {
    const GLASS_IOR = 1.5;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    // Height of the convex squircle surface, t = 0 at the outer edge, t = 1 at the end of the bezel.
    function surfaceHeight(t, curve) {
        return Math.pow(1 - Math.pow(1 - t, curve), 1 / curve);
    }
    function surfaceSlope(t, curve) {
        const base = 1 - Math.pow(1 - t, curve);
        return Math.pow(base, 1 / curve - 1) * Math.pow(1 - t, curve - 1);
    }

    // Refraction profile f(t) in 0..1: sideways shift of a ray that crosses the lens at depth t.
    // Sampled once per curve/thickness, then normalised so the strongest point equals 1.
    function refractionProfile({ curve, thickness, samples = 128 }) {
        const profile = new Float32Array(samples + 1);
        let peak = 0;
        for (let i = 0; i <= samples; i++) {
            const t = Math.max(i / samples, 0.002);
            const slope = surfaceSlope(t, curve) * thickness;
            const incidence = Math.atan(Math.min(slope, 40));
            const refracted = Math.asin(Math.sin(incidence) / GLASS_IOR);
            profile[i] = Math.tan(incidence - refracted);
            peak = Math.max(peak, profile[i]);
        }
        for (let i = 0; i <= samples; i++) profile[i] = peak ? Math.min(profile[i] / peak, 1) : 0;
        return profile;
    }
    function sampleProfile(profile, t) {
        if (t >= 1) return 0;
        const position = clamp(t, 0, 1) * (profile.length - 1);
        const index = Math.floor(position);
        const fraction = position - index;
        return profile[index] * (1 - fraction) + profile[Math.min(index + 1, profile.length - 1)] * fraction;
    }

    // Distance from (x, y) to the edge of a rounded rectangle, plus the outward direction.
    function roundedRectField(x, y, width, height, radius) {
        const halfW = width / 2, halfH = height / 2;
        const r = Math.min(radius, halfW, halfH);
        const px = x - halfW, py = y - halfH;
        const qx = Math.abs(px) - (halfW - r), qy = Math.abs(py) - (halfH - r);
        const outsideX = Math.max(qx, 0), outsideY = Math.max(qy, 0);
        const corner = Math.hypot(outsideX, outsideY);
        const signedDistance = corner + Math.min(Math.max(qx, qy), 0) - r;
        let nx, ny;
        if (corner > 0) { nx = Math.sign(px) * outsideX / corner; ny = Math.sign(py) * outsideY / corner; }
        else if (qx > qy) { nx = Math.sign(px) || 1; ny = 0; }
        else { nx = 0; ny = Math.sign(py) || 1; }
        return { inside: -signedDistance, nx, ny };
    }

    // The rim width is a property of the glass, not of the element: a big panel keeps the same thin rim.
    function bezelWidth(edgeWidth, width, height) {
        return clamp(edgeWidth, 2, Math.max(2, Math.min(width, height) * 0.45));
    }
    function maxDisplacement(displacement, strength, width, height) {
        return Math.min(displacement * strength, Math.min(width, height) * 0.5);
    }

    const api = { GLASS_IOR, clamp, surfaceHeight, surfaceSlope, refractionProfile, sampleProfile, roundedRectField, bezelWidth, maxDisplacement };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LiquidGlassOptics = api;
})(typeof window !== 'undefined' ? window : globalThis);
