// A shared set of local SVG icons. All icons inherit the interface colour.
const iconPaths = {
    brand: '<path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M8 13h8M8 16h5"/>',
    file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
    folder: '<path d="M3 7V5h6l2 2h10v13H3z"/><path d="M3 10h18"/>',
    save: '<path d="M4 3h13l4 4v14H3V3zM7 3v6h9V3M7 21v-8h10v8"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
    settings: '<path d="m9 3-.5 3-2 1.2-2.8-1-2 3.6L4 12l-2.3 2.2 2 3.6 2.8-1 2 1.2.5 3h6l.5-3 2-1.2 2.8 1 2-3.6L20 12l2.3-2.2-2-3.6-2.8 1-2-1.2L15 3z"/><circle cx="12" cy="12" r="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    moon: '<path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    heading: '<path d="M5 5v14M16 5v14M5 12h11M19 15l2-1v7"/>',
    bold: '<path d="M7 12h6a4 4 0 0 0 0-8H7v16h7a4 4 0 0 0 0-8H7"/>',
    italic: '<path d="M10 4h9M5 20h9M15 4 9 20"/>',
    strike: '<path d="M17 6c-1-2-9-3-10 1-.5 2 1 3 3 3M7 18c2 3 10 3 10-2 0-1-1-2-3-3M3 12h18"/>',
    underline: '<path d="M6 3v8a6 6 0 0 0 12 0V3M4 21h16"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01"/>',
    'check-square': '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
    quote: '<path d="M4 6h6v7H4zM14 6h6v7h-6zM10 13c0 3-2 5-5 5m15-5c0 3-2 5-5 5"/>',
    link: '<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" transform="translate(1 -1) scale(.92)"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    code: '<path d="m7 7-5 5 5 5m10-10 5 5-5 5M14 4l-4 16"/>',
    sup: '<path d="m3 10 8 10m0-10L3 20M16 5c0-3 5-3 5 0 0 2-5 3-5 6h5"/>',
    sub: '<path d="m3 4 8 10m0-10L3 14M16 15c0-3 5-3 5 0 0 2-5 3-5 6h5"/>'
};
function icon(name) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name] || iconPaths.file}</svg>`;
}
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
});
