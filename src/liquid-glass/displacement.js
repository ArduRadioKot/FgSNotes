// Displacement map + SVG filter generation. The map follows the element's own rounded-rect shape:
// neutral grey in the flat centre, outward displacement only inside the bezel.
(function (root) {
    const optics = typeof require === 'function' && typeof module !== 'undefined' ? require('./optics') : root.LiquidGlassOptics;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const mapCache = new Map();
    const CACHE_LIMIT = 24;

    // Maps are cached by shape and lens parameters; many identical buttons share one bitmap.
    function mapKey(width, height, radius, lens) {
        return [width, height, Math.round(radius), lens.bezel.toFixed(1), lens.curve.toFixed(2), lens.thickness.toFixed(2), lens.resolution].join('|');
    }
    function buildMap(width, height, radius, lens) {
        const key = mapKey(width, height, radius, lens);
        if (mapCache.has(key)) return mapCache.get(key);
        const scale = lens.resolution;
        const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const context = canvas.getContext('2d');
        const image = context.createImageData(w, h);
        const data = image.data;
        const profile = optics.refractionProfile({ curve: lens.curve, thickness: lens.thickness });
        const bezel = lens.bezel * scale, radiusPx = radius * scale;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const offset = (y * w + x) * 4;
                let red = 128, green = 128;
                const field = optics.roundedRectField(x + 0.5, y + 0.5, w, h, radiusPx);
                if (field.inside < bezel) {
                    // Displacement encoded as 0.5 + shift / (2 * maxShift); the filter scale restores the pixels.
                    const f = optics.sampleProfile(profile, Math.max(field.inside, 0) / bezel);
                    red = 128 + field.nx * f * 127;
                    green = 128 + field.ny * f * 127;
                }
                data[offset] = red; data[offset + 1] = green; data[offset + 2] = 128; data[offset + 3] = 255;
            }
        }
        context.putImageData(image, 0, 0);
        const url = canvas.toDataURL('image/png');
        mapCache.set(key, url);
        if (mapCache.size > CACHE_LIMIT) mapCache.delete(mapCache.keys().next().value);
        return url;
    }

    const channelMatrix = {
        r: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
        g: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
        b: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'
    };
    function node(name, attributes) {
        const element = document.createElementNS(SVG_NS, name);
        for (const key of Object.keys(attributes)) element.setAttribute(key, attributes[key]);
        return element;
    }
    // sRGB interpolation is required, otherwise the map is gamma-converted and the image drifts or ghosts.
    // With dispersion the same map is applied three times at slightly different strength, one per colour channel.
    function createFilter(id, width, height, mapUrl, dispersion) {
        const filter = node('filter', { id, x: 0, y: 0, width, height, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
        filter.appendChild(node('feImage', { href: mapUrl, x: 0, y: 0, width, height, preserveAspectRatio: 'none', result: 'map' }));
        const displace = [];
        const channels = dispersion > 0 ? ['r', 'g', 'b'] : ['g'];
        for (const channel of channels) {
            const attributes = { in: 'SourceGraphic', in2: 'map', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', result: dispersion > 0 ? `d${channel}` : 'out' };
            const element = node('feDisplacementMap', attributes);
            filter.appendChild(element);
            displace.push({ channel, element });
            if (dispersion > 0) filter.appendChild(node('feColorMatrix', { in: `d${channel}`, type: 'matrix', values: channelMatrix[channel], result: channel }));
        }
        if (dispersion > 0) {
            filter.appendChild(node('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }));
            filter.appendChild(node('feBlend', { in: 'rg', in2: 'b', mode: 'screen' }));
        }
        return { filter, displace };
    }
    // Red bends slightly less than green and blue slightly more, like a real prism edge.
    function setScale(displace, scale, dispersion) {
        for (const { channel, element } of displace) {
            const split = channel === 'r' ? 1 - dispersion : channel === 'b' ? 1 + dispersion : 1;
            element.setAttribute('scale', (scale * split).toFixed(2));
        }
    }

    const api = { buildMap, createFilter, setScale, clearCache: () => mapCache.clear() };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LiquidGlassDisplacement = api;
})(typeof window !== 'undefined' ? window : globalThis);
