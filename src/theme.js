function updateThemeButton() {
    const button = document.getElementById('theme-button');
    if (!button) return;
    const isDark = document.documentElement.dataset.theme === 'dark';
    button.innerHTML = icon(isDark ? 'sun' : 'moon');
    button.title = isDark ? 'Светлая тема' : 'Тёмная тема';
    button.setAttribute('aria-label', button.title);
}
function toggleTheme() {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    updateThemeButton();
}
document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark';
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('theme-button').addEventListener('click', toggleTheme);
    updateThemeButton();
});
