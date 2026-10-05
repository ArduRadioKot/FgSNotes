// Liquid Glass configuration: schema with safe limits, presets and theme-aware resolving.
(function (root) {
    // [min, max, step] — every numeric parameter is clamped so a slider cannot break the UI.
    const limits = {
        blur: [0, 40, 0.5], opacity: [0, 0.8, 0.01], brightness: [0.7, 1.4, 0.01], contrast: [0.8, 1.4, 0.01], saturation: [0.6, 2.2, 0.01], frost: [0, 1, 0.01],
        refraction: [0, 1, 0.01], displacement: [0, 48, 1], edgeWidth: [4, 48, 1], thickness: [0.2, 1.6, 0.01], curve: [1.5, 6, 0.1],
        dispersion: [0, 0.3, 0.005], highlight: [0, 1, 0.01], edgeHighlight: [0, 1, 0.01], innerGlow: [0, 1, 0.01], innerShadow: [0, 1, 0.01], specular: [0, 1, 0.01], specularSharpness: [0, 1, 0.01], lightAngle: [0, 360, 1],
        radius: [0, 60, 1], borderWidth: [0, 3, 0.1],
        shadowOpacity: [0, 0.6, 0.01], shadowBlur: [0, 60, 1], shadowDistance: [0, 30, 1], ambientShadow: [0, 0.4, 0.01],
        hover: [0, 1, 0.01], press: [0, 1, 0.01], speed: [60, 600, 10], stiffness: [60, 400, 5], damping: [8, 40, 1], pointerTracking: [0, 1, 0.01], distortionAnimation: [0, 1, 0.01]
    };
    const groups = [
        ['Материал', ['blur', 'opacity', 'saturation', 'brightness', 'contrast', 'frost']],
        ['Преломление', ['refraction', 'displacement', 'edgeWidth', 'thickness', 'curve']],
        ['Оптика', ['dispersion', 'highlight', 'edgeHighlight', 'innerGlow', 'innerShadow', 'specular', 'specularSharpness', 'lightAngle']],
        ['Геометрия', ['radius', 'borderWidth']],
        ['Тень', ['shadowOpacity', 'shadowBlur', 'shadowDistance', 'ambientShadow']],
        ['Движение', ['hover', 'press', 'speed', 'stiffness', 'damping', 'pointerTracking', 'distortionAnimation']]
    ];
    const labels = {
        blur: 'Размытие', opacity: 'Плотность тонировки', saturation: 'Насыщенность', brightness: 'Яркость', contrast: 'Контраст', frost: 'Матовость',
        refraction: 'Сила преломления', displacement: 'Смещение, px', edgeWidth: 'Ширина кромки, px', thickness: 'Толщина линзы', curve: 'Кривая искажения',
        dispersion: 'Дисперсия', highlight: 'Блик', edgeHighlight: 'Блик кромки', innerGlow: 'Внутреннее свечение', innerShadow: 'Внутренняя тень', specular: 'Зеркальность', specularSharpness: 'Резкость блика', lightAngle: 'Направление света, °',
        radius: 'Скругление', borderWidth: 'Толщина кромки',
        shadowOpacity: 'Тень', shadowBlur: 'Размытие тени', shadowDistance: 'Смещение тени', ambientShadow: 'Мягкая тень',
        hover: 'Реакция на наведение', press: 'Реакция на нажатие', speed: 'Скорость, мс', stiffness: 'Жёсткость пружины', damping: 'Затухание пружины', pointerTracking: 'Следование за курсором', distortionAnimation: 'Анимация искажения'
    };

    const base = {
        blur: 8, opacity: 0.16, saturation: 1.25, brightness: 1.04, contrast: 1, frost: 0,
        refraction: 0.65, displacement: 24, edgeWidth: 18, thickness: 0.6, curve: 3,
        dispersion: 0.08, highlight: 0.45, edgeHighlight: 0.55, innerGlow: 0.2, innerShadow: 0.25, specular: 0.5, specularSharpness: 0.6, lightAngle: 315,
        radius: 28, borderWidth: 1.2,
        shadowOpacity: 0.22, shadowBlur: 28, shadowDistance: 10, ambientShadow: 0.12,
        hover: 0.5, press: 0.6, speed: 220, stiffness: 170, damping: 18, pointerTracking: 0.6, distortionAnimation: 0.5
    };
    // Presets differ in optics (lens, scattering, lighting), not just opacity.
    const presets = {
        subtle: { label: 'Тонкое', blur: 14, opacity: 0.22, refraction: 0.25, displacement: 10, edgeWidth: 10, dispersion: 0.02, highlight: 0.25, edgeHighlight: 0.35, specular: 0.3, innerGlow: 0.12, shadowOpacity: 0.12, shadowBlur: 20, shadowDistance: 6 },
        regular: { label: 'Обычное' },
        clear: { label: 'Прозрачное', blur: 2, opacity: 0.06, saturation: 1.1, refraction: 0.8, displacement: 30, edgeWidth: 22, dispersion: 0.1, highlight: 0.35, edgeHighlight: 0.5, specular: 0.45, innerGlow: 0.1 },
        frosted: { label: 'Матовое', blur: 22, opacity: 0.3, frost: 0.5, refraction: 0.3, displacement: 12, edgeWidth: 14, dispersion: 0.02, highlight: 0.3, edgeHighlight: 0.4, innerGlow: 0.35, specular: 0.25 },
        vivid: { label: 'Яркое', blur: 6, opacity: 0.12, saturation: 1.75, brightness: 1.08, refraction: 0.9, displacement: 30, edgeWidth: 20, dispersion: 0.12, specular: 0.7, specularSharpness: 0.75, highlight: 0.5 },
        ultraClear: { label: 'Ультрапрозрачное', blur: 0.5, opacity: 0.02, saturation: 1.05, refraction: 1, displacement: 34, edgeWidth: 26, thickness: 0.8, dispersion: 0.14, highlight: 0.3, edgeHighlight: 0.45, specular: 0.4, innerGlow: 0.1, shadowOpacity: 0.15 }
    };
    // Tint and lighting depend on the theme; dark mode is tuned separately, not just inverted.
    const themes = {
        dark: { tint: '#17181c', shadowRgb: '0 0 0', rimRgb: '255 255 255', opacityMul: 1, highlightMul: 1, innerShadowMul: 1, shadowMul: 1.4, brightnessAdd: 0 },
        light: { tint: '#ffffff', shadowRgb: '28 36 64', rimRgb: '255 255 255', opacityMul: 1.35, highlightMul: 0.85, innerShadowMul: 0.8, shadowMul: 0.8, brightnessAdd: 0.02 }
    };

    function clampValue(key, value) {
        const range = limits[key];
        const number = Number(value);
        if (!range || !Number.isFinite(number)) return base[key];
        return Math.min(range[1], Math.max(range[0], number));
    }
    function sanitize(config) {
        const clean = {};
        for (const key of Object.keys(limits)) if (config && key in config) clean[key] = clampValue(key, config[key]);
        if (config && typeof config.tint === 'string' && /^#[0-9a-f]{6}$/i.test(config.tint)) clean.tint = config.tint;
        return clean;
    }
    // preset -> theme adjustments -> user overrides (always last, so sliders win).
    function resolve(presetName, theme, overrides) {
        const preset = presets[presetName] || presets.regular;
        const mode = themes[theme] || themes.dark;
        const merged = { ...base, ...preset };
        delete merged.label;
        merged.opacity = merged.opacity * mode.opacityMul;
        merged.highlight = merged.highlight * mode.highlightMul;
        merged.innerShadow = merged.innerShadow * mode.innerShadowMul;
        merged.shadowOpacity = merged.shadowOpacity * mode.shadowMul;
        merged.brightness = merged.brightness + mode.brightnessAdd;
        const resolved = { ...merged, ...sanitize(overrides) };
        resolved.tint = (overrides && sanitize(overrides).tint) || mode.tint;
        resolved.shadowRgb = mode.shadowRgb;
        resolved.rimRgb = mode.rimRgb;
        return { ...resolved, ...sanitize(resolved) };
    }

    const api = { limits, groups, labels, base, presets, themes, sanitize, resolve, clampValue };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LiquidGlassPresets = api;
})(typeof window !== 'undefined' ? window : globalThis);
