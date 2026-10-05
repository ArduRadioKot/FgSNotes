// Liquid Glass runtime: shared SVG defs, per-element lens filters, spring-driven lighting, adaptive quality.
// Usage: LiquidGlass.attach(element, { overrides, interactive }) -> { update, destroy }
(function (root) {
    const presets = root.LiquidGlassPresets;
    const optics = root.LiquidGlassOptics;
    const displacement = root.LiquidGlassDisplacement;
    const storageKey = 'fgsnotes.glass.v1';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const instances = new Map();
    const state = { preset: 'regular', overrides: {}, quality: 'auto', refraction: true, animations: true };
    const media = {
        motion: window.matchMedia('(prefers-reduced-motion: reduce)'),
        transparency: window.matchMedia('(prefers-reduced-transparency: reduce)')
    };
    let defs = null, nextId = 1, frame = 0, lastTime = 0, config = null, mode = 'low';
    let visibility = null, sizeObserver = null;

    // --- capabilities -------------------------------------------------------------------------
    // SVG filters inside backdrop-filter render only in Chromium. There is no way to test the rendering
    // itself, so feature detection (CSS.supports) is combined with a Chromium brand check.
    function supportsRefraction() {
        const cssOk = typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#lg-probe) blur(1px)');
        const brands = navigator.userAgentData && navigator.userAgentData.brands || [];
        return cssOk && brands.some(entry => entry.brand === 'Chromium');
    }
    function resolveMode() {
        if (media.transparency.matches) return 'low';
        if (!state.refraction) return 'low';
        const wanted = state.quality;
        if (wanted === 'low' || !supportsRefraction()) return 'low';
        if (wanted === 'medium' || wanted === 'high') return wanted;
        const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
        return weak ? 'medium' : 'high';
    }
    const animated = () => state.animations && !media.motion.matches && mode !== 'low';

    // --- configuration ------------------------------------------------------------------------
    function theme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
    function recompute() {
        mode = resolveMode();
        config = presets.resolve(state.preset, theme(), state.overrides);
        applyTokens(document.documentElement, config);
        document.documentElement.dataset.lgQuality = mode;
        instances.forEach(instance => rebuild(instance, true));
    }
    function applyTokens(element, c, perInstance) {
        const style = element.style;
        const effectiveOpacity = c.opacity + (mode === 'low' ? 0.08 : 0);
        const set = (name, value) => style.setProperty('--lg-' + name, value);
        set('blur', (c.blur + c.frost * 12) + 'px');
        set('opacity', String(Math.min(0.85, effectiveOpacity + c.frost * 0.18)));
        set('tint', c.tint);
        set('saturation', c.saturation); set('brightness', c.brightness); set('contrast', c.contrast);
        set('border-width', c.borderWidth + 'px');
        set('highlight', c.highlight); set('edge-highlight', c.edgeHighlight);
        set('inner-glow', c.innerGlow); set('inner-shadow', c.innerShadow);
        set('specular', c.specular); set('spec-width', (22 + (1 - c.specularSharpness) * 48) + 'deg');
        set('light-angle', c.lightAngle + 'deg');
        set('shadow-opacity', c.shadowOpacity); set('shadow-blur', c.shadowBlur + 'px'); set('shadow-distance', c.shadowDistance + 'px'); set('ambient', c.ambientShadow);
        set('shadow-rgb', c.shadowRgb); set('rim-rgb', c.rimRgb);
        set('speed', c.speed + 'ms');
        // Substrate is the single window-wide glass; islands on top are denser so text stays readable.
        set('substrate', String(Math.min(0.8, 0.4 + c.opacity * 0.8 + c.frost * 0.12)));
        set('island', String(Math.min(0.92, 0.52 + c.opacity * 0.5 + c.frost * 0.1)));
        if (!perInstance) {
            if (c.radius !== undefined) set('radius', c.radius + 'px');
        }
    }
    function load() {
        try { Object.assign(state, JSON.parse(localStorage.getItem(storageKey)) || {}); } catch { /* use defaults */ }
        state.overrides = presets.sanitize(state.overrides);
    }
    function save() {
        try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* storage unavailable */ }
    }
    function configure(patch, { persist = true } = {}) {
        if (patch.preset && presets.presets[patch.preset]) state.preset = patch.preset;
        if (patch.quality && ['auto', 'high', 'medium', 'low'].includes(patch.quality)) state.quality = patch.quality;
        if (typeof patch.refraction === 'boolean') state.refraction = patch.refraction;
        if (typeof patch.animations === 'boolean') state.animations = patch.animations;
        if (patch.overrides) state.overrides = patch.overrides === 'reset' ? {} : { ...state.overrides, ...presets.sanitize(patch.overrides) };
        if (patch.reset) { state.overrides = {}; }
        if (persist) save();
        recompute();
        window.dispatchEvent(new CustomEvent('liquidglasschange', { detail: getState() }));
    }
    const getState = () => ({ ...state, overrides: { ...state.overrides }, config: { ...config }, mode });

    // --- shared SVG definitions ---------------------------------------------------------------
    function ensureDefs() {
        if (defs) return defs;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', 0); svg.setAttribute('height', 0);
        svg.setAttribute('aria-hidden', 'true');
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
        defs = document.createElementNS(SVG_NS, 'defs');
        svg.appendChild(defs);
        document.body.appendChild(svg);
        return defs;
    }
    function removeFilter(instance) {
        if (instance.filter) instance.filter.remove();
        instance.filter = null; instance.displace = null; instance.filterKey = '';
        instance.element.style.removeProperty('--lg-bf');
    }

    // --- lens build ---------------------------------------------------------------------------
    function chain(c) {
        return `blur(var(--lg-blur)) saturate(var(--lg-saturation)) brightness(var(--lg-brightness)) contrast(var(--lg-contrast))`;
    }
    function effectiveConfig(instance) {
        return instance.overrides ? presets.resolve(state.preset, theme(), { ...state.overrides, ...instance.overrides }) : config;
    }
    function rebuild(instance, force) {
        const { element } = instance;
        const c = effectiveConfig(instance);
        instance.config = c;
        if (instance.overrides) applyTokens(element, c, true);
        if (instance.overrides && instance.overrides.radius !== undefined) element.style.borderRadius = c.radius + 'px';
        if (mode === 'low' || c.refraction <= 0) return removeFilter(instance);
        const width = Math.round(element.offsetWidth), height = Math.round(element.offsetHeight);
        if (width < 8 || height < 8) return removeFilter(instance);
        const radius = Math.min(parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0, width / 2, height / 2);
        const dispersion = mode === 'high' ? c.dispersion * 0.25 : 0;
        const lens = { bezel: optics.bezelWidth(c.edgeWidth, width, height), curve: c.curve, thickness: c.thickness, resolution: mode === 'high' ? 1 : 0.5 };
        const key = [width, height, Math.round(radius), lens.bezel.toFixed(1), lens.curve, lens.thickness, lens.resolution, dispersion > 0].join('|');
        if (!force && key === instance.filterKey) return;
        removeFilter(instance);
        const id = 'lg-' + instance.id;
        const built = displacement.createFilter(id, width, height, displacement.buildMap(width, height, radius, lens), dispersion);
        ensureDefs().appendChild(built.filter);
        instance.filter = built.filter; instance.displace = built.displace; instance.filterKey = key;
        instance.maxShift = optics.maxDisplacement(c.displacement, c.refraction, width, height);
        instance.split = dispersion;
        displacement.setScale(instance.displace, instance.maxShift * 2, dispersion);
        element.style.setProperty('--lg-bf', `url(#${id}) ${chain(c)}`);
    }

    // --- motion: damped springs written straight to CSS variables (no framework re-render) ------
    function makeSpring(value) { return { x: value, v: 0, target: value }; }
    function step(spring, stiffness, damping, dt) {
        const force = stiffness * (spring.target - spring.x) - damping * spring.v;
        spring.v += force * dt; spring.x += spring.v * dt;
        return Math.abs(spring.target - spring.x) > 0.0008 || Math.abs(spring.v) > 0.0008;
    }
    function tick(time) {
        frame = 0;
        const dt = Math.min((time - lastTime) / 1000 || 0.016, 1 / 30);
        lastTime = time;
        let busy = false;
        instances.forEach(instance => {
            if (!instance.active || !instance.visible) return;
            const c = instance.config || config;
            const stiffness = c.stiffness, damping = c.damping;
            const moving = [instance.hover, instance.press, instance.px, instance.py].map(spring => step(spring, stiffness, damping, dt));
            if (!moving.some(Boolean)) { instance.active = false; }
            else busy = true;
            const style = instance.element.style;
            style.setProperty('--lg-hover', instance.hover.x.toFixed(3));
            style.setProperty('--lg-press', instance.press.x.toFixed(3));
            style.setProperty('--lg-px', instance.px.x.toFixed(3));
            style.setProperty('--lg-py', instance.py.x.toFixed(3));
            style.setProperty('--lg-light-offset', ((instance.px.x - 0.5) * 24 * c.pointerTracking).toFixed(2) + 'deg');
            if (instance.displace) {
                const gain = 1 + c.distortionAnimation * (0.14 * instance.hover.x - 0.1 * instance.press.x);
                displacement.setScale(instance.displace, instance.maxShift * 2 * gain, instance.split);
            }
        });
        if (busy) frame = requestAnimationFrame(tick);
    }
    function wake(instance) {
        instance.active = true;
        if (!frame) { lastTime = performance.now(); frame = requestAnimationFrame(tick); }
    }

    function bindPointer(instance) {
        const { element } = instance;
        const c = () => instance.config || config;
        const local = event => {
            const box = element.getBoundingClientRect();
            return [optics.clamp((event.clientX - box.left) / box.width, 0, 1), optics.clamp((event.clientY - box.top) / box.height, 0, 1)];
        };
        const handlers = {
            pointerenter: () => { if (!animated()) return; instance.hover.target = c().hover; wake(instance); },
            pointermove: event => {
                if (!animated()) return;
                [instance.px.target, instance.py.target] = local(event);
                wake(instance);
            },
            pointerleave: () => { instance.hover.target = 0; instance.press.target = 0; instance.px.target = 0.5; instance.py.target = 0.5; wake(instance); },
            pointerdown: () => { if (!animated()) return; instance.press.target = c().press; wake(instance); },
            pointerup: () => { instance.press.target = 0; wake(instance); },
            pointercancel: () => { instance.press.target = 0; wake(instance); }
        };
        for (const name of Object.keys(handlers)) element.addEventListener(name, handlers[name], { passive: true });
        return () => { for (const name of Object.keys(handlers)) element.removeEventListener(name, handlers[name]); };
    }

    // --- observers (created lazily, shared by all instances) ------------------------------------
    function observers() {
        if (sizeObserver) return;
        const pending = new Set();
        let queued = 0;
        sizeObserver = new ResizeObserver(entries => {
            entries.forEach(entry => { const instance = instances.get(entry.target); if (instance) pending.add(instance); });
            // Rebuild at most once per frame; the previous filter stays in place until the new one is ready.
            if (!queued) queued = requestAnimationFrame(() => { queued = 0; pending.forEach(instance => instance.visible && rebuild(instance, false)); pending.clear(); });
        });
        visibility = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                const instance = instances.get(entry.target);
                if (!instance) return;
                instance.visible = entry.isIntersecting;
                if (entry.isIntersecting) rebuild(instance, false);
            });
        });
    }

    function attach(element, options = {}) {
        if (instances.has(element)) return instances.get(element).api;
        observers();
        const instance = {
            id: nextId++, element, overrides: options.overrides ? presets.sanitize(options.overrides) : null, visible: true, active: false,
            hover: makeSpring(0), press: makeSpring(0), px: makeSpring(0.5), py: makeSpring(0.5), filter: null, displace: null, filterKey: '', config: null, maxShift: 0, split: 0
        };
        element.classList.add('lg');
        if (options.interactive !== false) instance.unbind = bindPointer(instance);
        instance.api = {
            update: () => rebuild(instance, true),
            setOverrides: overrides => { instance.overrides = overrides ? presets.sanitize(overrides) : null; rebuild(instance, true); },
            destroy: () => destroy(element)
        };
        instances.set(element, instance);
        sizeObserver.observe(element); visibility.observe(element);
        rebuild(instance, true);
        return instance.api;
    }
    function destroy(element) {
        const instance = instances.get(element);
        if (!instance) return;
        if (instance.unbind) instance.unbind();
        sizeObserver.unobserve(element); visibility.unobserve(element);
        removeFilter(instance);
        element.classList.remove('lg');
        ['hover', 'press', 'px', 'py', 'light-offset'].forEach(name => element.style.removeProperty('--lg-' + name));
        instances.delete(element);
    }
    function attachAll(selector, options) { document.querySelectorAll(selector).forEach(element => attach(element, options)); }
    function detachAll(selector) { document.querySelectorAll(selector).forEach(destroy); }

    function init() {
        load();
        recompute();
        media.motion.addEventListener('change', recompute);
        media.transparency.addEventListener('change', recompute);
        new MutationObserver(recompute).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        window.addEventListener('pagehide', () => { instances.forEach((_, element) => destroy(element)); displacement.clearCache(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    root.LiquidGlass = { attach, destroy, attachAll, detachAll, configure, getState, supportsRefraction, presets: presets.presets, limits: presets.limits };
})(window);
