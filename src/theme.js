function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Update preview theme if it's set to default
    const preview = document.getElementById('preview');
    const settings = loadSettings();
    if (preview && settings.previewTheme === 'default') {
        const previewTheme = newTheme === 'dark' ? 'preview-theme-dark' : '';
        preview.className = 'preview-content ' + previewTheme;
    }
    
    document.dispatchEvent(new Event('theme-changed'));
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    // Initialize preview theme
    const preview = document.getElementById('preview');
    const settings = loadSettings();
    if (preview && settings.previewTheme === 'default') {
        const previewTheme = savedTheme === 'dark' ? 'preview-theme-dark' : '';
        preview.className = 'preview-content ' + previewTheme;
    }
});