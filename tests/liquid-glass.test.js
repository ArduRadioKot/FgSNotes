const { test } = require('node:test');
const assert = require('node:assert/strict');
const optics = require('../src/liquid-glass/optics');
const presets = require('../src/liquid-glass/presets');

test('refraction is strongest at the rim and zero in the flat centre', () => {
    const profile = optics.refractionProfile({ curve: 3, thickness: 0.6 });
    const near = optics.sampleProfile(profile, 0.05), middle = optics.sampleProfile(profile, 0.5);
    assert.ok(near > middle, 'rim shifts more than the middle');
    assert.ok(Math.max(...profile) <= 1 && Math.min(...profile) >= 0);
    assert.equal(optics.sampleProfile(profile, 1), 0);
    assert.equal(optics.sampleProfile(profile, 2), 0);
});
test('rounded rect field gives distance to the edge and an outward normal', () => {
    const left = optics.roundedRectField(2, 50, 200, 100, 20);
    assert.ok(Math.abs(left.inside - 2) < 1e-6);
    assert.deepEqual([left.nx, left.ny], [-1, 0]);
    const corner = optics.roundedRectField(8, 8, 200, 100, 20);
    assert.ok(corner.nx < 0 && corner.ny < 0, 'corner normal points to the corner');
    assert.ok(Math.abs(corner.inside - (20 - Math.hypot(12, 12))) < 1e-6);
    assert.ok(optics.roundedRectField(3, 3, 200, 100, 20).inside < 0, 'the cut corner is outside the shape');
    const centre = optics.roundedRectField(100, 50, 200, 100, 20);
    assert.equal(centre.inside, 50);
});
test('rim width does not grow with element size', () => {
    assert.equal(optics.bezelWidth(18, 1200, 700), 18);
    assert.equal(optics.bezelWidth(18, 40, 30), 13.5);
    assert.ok(optics.maxDisplacement(30, 1, 40, 30) <= 15);
});
test('presets differ in optics, not only opacity', () => {
    const clear = presets.resolve('clear', 'dark'), frosted = presets.resolve('frosted', 'dark');
    assert.ok(clear.refraction > frosted.refraction && clear.blur < frosted.blur && clear.displacement > frosted.displacement);
    for (const name of ['subtle', 'regular', 'clear', 'frosted', 'vivid', 'ultraClear']) assert.ok(presets.presets[name], name);
});
test('values are clamped and unknown input is ignored', () => {
    const config = presets.resolve('regular', 'light', { blur: 9999, dispersion: -4, saturation: 'x', tint: 'red', radius: 5 });
    assert.equal(config.blur, 40);
    assert.equal(config.dispersion, 0);
    assert.ok(Number.isFinite(config.saturation));
    assert.equal(config.radius, 5);
    assert.match(config.tint, /^#[0-9a-f]{6}$/i);
});
test('light and dark themes get different tint and shadows', () => {
    const light = presets.resolve('regular', 'light'), dark = presets.resolve('regular', 'dark');
    assert.notEqual(light.tint, dark.tint);
    assert.notEqual(light.shadowRgb, dark.shadowRgb);
});
