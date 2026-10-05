// Local SVG icon set drawn on a 16px grid in the IntelliJ style (thin 1.2px outlines).
const iconPaths = {
    'brand': '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>',
    'file': '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3M5.5 8.5h5M5.5 11h5"/>',
    'markdown': '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M4 10V6l1.75 2.25L7.5 6v4M11 6v4m-1.5-1.5L11 10l1.5-1.5"/>',
    'folder': '<path d="M1.5 3.5h4l1.5 1.5h7.5v8.5h-13z"/>',
    'save': '<path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5v3.5h5V2.5M5 13.5V9h6v4.5"/>',
    'download': '<path d="M8 2v8M4.5 6.75 8 10.25l3.5-3.5M2.5 13.5h11"/>',
    'settings': '<path d="M6.79 3.15 L7.06 1.37 L8.94 1.37 L9.21 3.15 L10.58 3.72 L12.02 2.64 L13.36 3.98 L12.28 5.42 L12.85 6.79 L14.63 7.06 L14.63 8.94 L12.85 9.21 L12.28 10.58 L13.36 12.02 L12.02 13.36 L10.58 12.28 L9.21 12.85 L8.94 14.63 L7.06 14.63 L6.79 12.85 L5.42 12.28 L3.98 13.36 L2.64 12.02 L3.72 10.58 L3.15 9.21 L1.37 8.94 L1.37 7.06 L3.15 6.79 L3.72 5.42 L2.64 3.98 L3.98 2.64 L5.42 3.72Z"/><circle cx="8" cy="8" r="2"/>',
    'sun': '<circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
    'moon': '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>',
    'plus': '<path d="M8 3v10M3 8h10"/>',
    'close': '<path d="M4 4l8 8M12 4l-8 8"/>',
    'check': '<path d="M3 8.5l3.25 3L13 4.5"/>',
    'edit': '<path d="M10.5 2.5l3 3-8 8H2.5v-3z"/><path d="M9 4l3 3"/>',
    'columns': '<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M8 2.5v11"/>',
    'eye': '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
    'heading': '<path d="M3 3v10M10 3v10M3 8h7M12.5 8l1.5-.8V13"/>',
    'bold': '<path d="M4.5 2.5v11M4.5 2.5h3.5a2.25 2.25 0 0 1 0 4.5H4.5M4.5 7h4a3 3 0 0 1 0 6H4.5"/>',
    'italic': '<path d="M6.5 3h5M4.5 13h5M9.5 3l-3 10"/>',
    'strike': '<path d="M2.5 8h11M10.8 5c-.4-1.200-1.500-2-3-2-1.600 0-2.800.8-2.800 2 0 1 .8 1.500 3 2M5.200 11c.5 1.200 1.600 2 3 2 1.600 0 2.800-.8 2.800-2 0-.4-.1-.7-.4-1"/>',
    'underline': '<path d="M4.5 2.5v5a3.500 3.500 0 0 0 7 0v-5M3 13.5h10"/>',
    'list': '<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.8" cy="4" r=".7" fill="currentColor" stroke="none"/><circle cx="2.8" cy="8" r=".7" fill="currentColor" stroke="none"/><circle cx="2.8" cy="12" r=".7" fill="currentColor" stroke="none"/>',
    'check-square': '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5.5 8l2 2 3.200-3.800"/>',
    'quote': '<path d="M2.500 8V6.500C2.500 5 3.500 4 5.500 3.500M2.500 8h3.500v3.500H2.500zM9 8V6.500C9 5 10 4 12 3.500M9 8h3.500v3.500H9z"/>',
    'link': '<path d="M6.500 9.500l3-3M7.200 4.300l.8-.8a2.600 2.600 0 0 1 3.700 3.700l-1 1M8.800 11.700l-.8.8a2.600 2.600 0 0 1-3.700-3.700l1-1"/>',
    'image': '<rect x="1.500" y="2.500" width="13" height="11" rx="1"/><circle cx="5.200" cy="6" r="1.200"/><path d="M2 12l3.500-3.500 2.500 2.500 2-2 4 3"/>',
    'code': '<path d="M5.500 4.500 2 8l3.500 3.500M10.500 4.500 14 8l-3.500 3.500"/>',
    'sup': '<path d="M2 5.500l6 7M8 5.500l-6 7M10.500 3.500c0-1.300 3-1.300 3 0 0 1.100-3 1.600-3 3.200h3"/>',
    'sub': '<path d="M2 3l6 7M8 3l-6 7M10.500 9.500c0-1.300 3-1.300 3 0 0 1.100-3 1.600-3 3.200h3"/>'
};
function icon(name) {
    return `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name] || iconPaths.file}</svg>`;
}
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
});
