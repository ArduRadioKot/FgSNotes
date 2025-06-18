// Функциональность для страницы магазина тем с загрузкой из JSON

// Глобальные переменные
let themesData = null;
let currentFilter = 'all';
let currentSearch = '';
let displayedThemes = 6; // Количество отображаемых тем

// Элементы DOM
const themeSearch = document.getElementById('themeSearch');
const filterButtons = document.querySelectorAll('.filter-btn');
const themesGrid = document.getElementById('themesGrid');
const loadMoreBtn = document.getElementById('loadMoreBtn');

// Статистика
const totalThemesEl = document.getElementById('totalThemes');
const totalDownloadsEl = document.getElementById('totalDownloads');
const averageRatingEl = document.getElementById('averageRating');

// Загрузка данных при загрузке страницы
document.addEventListener('DOMContentLoaded', loadThemesData);

// Загрузка данных из JSON файла
async function loadThemesData() {
    try {
        const response = await fetch('themes-data.json');
        themesData = await response.json();
        
        // Обновляем статистику
        updateStats();
        
        // Отображаем темы
        displayThemes();
        
        // Анимация появления карточек
        animateThemeCards();
        
    } catch (error) {
        console.error('Ошибка загрузки данных тем:', error);
        showNotification('Ошибка загрузки данных тем', 'error');
    }
}

// Обновление статистики
function updateStats() {
    if (!themesData) return;
    
    const stats = themesData.stats;
    totalThemesEl.textContent = stats.totalThemes;
    totalDownloadsEl.textContent = formatNumber(stats.totalDownloads);
    averageRatingEl.textContent = stats.averageRating.toFixed(1);
}

// Форматирование чисел
function formatNumber(num) {
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

// Отображение тем
function displayThemes() {
    if (!themesData) return;
    
    const filteredThemes = filterThemes();
    const themesToShow = filteredThemes.slice(0, displayedThemes);
    
    themesGrid.innerHTML = '';
    
    themesToShow.forEach(theme => {
        const themeCard = createThemeCard(theme);
        themesGrid.appendChild(themeCard);
    });
    
    // Показываем/скрываем кнопку "Загрузить еще"
    loadMoreBtn.style.display = filteredThemes.length > displayedThemes ? 'block' : 'none';
}

// Фильтрация тем
function filterThemes() {
    if (!themesData) return [];
    
    return themesData.themes.filter(theme => {
        const matchesSearch = currentSearch === '' || 
            theme.name.toLowerCase().includes(currentSearch) || 
            theme.description.toLowerCase().includes(currentSearch) ||
            theme.tags.some(tag => tag.toLowerCase().includes(currentSearch));
        
        const matchesFilter = currentFilter === 'all' || theme.category === currentFilter;
        
        return matchesSearch && matchesFilter;
    });
}

// Создание карточки темы
function createThemeCard(theme) {
    const card = document.createElement('div');
    card.className = 'theme-card';
    card.dataset.category = theme.category;
    card.dataset.themeId = theme.id;
    
    card.innerHTML = `
        <div class="theme-preview">
            <div class="preview-header">
                <div class="preview-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
            <div class="preview-content ${theme.preview.type}" style="background: ${theme.preview.background};">
                <div class="preview-sidebar" style="background: ${theme.preview.sidebar};">
                    <div class="sidebar-item"></div>
                    <div class="sidebar-item"></div>
                    <div class="sidebar-item active" style="background: ${theme.preview.accent};"></div>
                </div>
                <div class="preview-editor">
                    <div class="editor-line"></div>
                    <div class="editor-line"></div>
                    <div class="editor-line short"></div>
                    <div class="editor-line"></div>
                </div>
            </div>
        </div>
        <div class="theme-info">
            <h3>${theme.name}</h3>
            <p>${theme.description}</p>
            <div class="theme-meta">
                <span class="theme-author">by ${theme.author}</span>
                <span class="theme-rating">
                    <i class="fas fa-star"></i>
                    ${theme.rating}
                </span>
            </div>
            <div class="theme-tags">
                ${theme.tags.map(tag => `<span class="theme-tag">${tag}</span>`).join('')}
            </div>
            <div class="theme-details">
                <span class="theme-version">v${theme.version}</span>
                <span class="theme-downloads">${formatNumber(theme.downloads)} загрузок</span>
            </div>
        </div>
        <div class="theme-actions">
            <button class="btn btn-outline btn-preview" data-theme-id="${theme.id}">
                <i class="fas fa-eye"></i> Предпросмотр
            </button>
            <button class="btn btn-gradient btn-install" data-theme-id="${theme.id}">
                <i class="fas fa-download"></i> Скачать
            </button>
        </div>
    `;
    
    return card;
}

// Поиск тем
themeSearch.addEventListener('input', (e) => {
    currentSearch = e.target.value.toLowerCase();
    displayedThemes = 6; // Сбрасываем счетчик при поиске
    displayThemes();
});

// Фильтрация по категориям
filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        currentFilter = btn.dataset.filter;
        displayedThemes = 6; // Сбрасываем счетчик при фильтрации
        displayThemes();
    });
});

// Кнопка "Загрузить еще"
loadMoreBtn.addEventListener('click', () => {
    loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Загрузка...';
    loadMoreBtn.disabled = true;
    
    setTimeout(() => {
        displayedThemes += 6;
        displayThemes();
        
        loadMoreBtn.innerHTML = '<i class="fas fa-plus"></i> Загрузить еще';
        loadMoreBtn.disabled = false;
        
        showNotification('Новые темы загружены!', 'success');
    }, 1000);
});

// Предпросмотр темы
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-preview') || e.target.closest('.btn-preview')) {
        const themeId = e.target.dataset.themeId || e.target.closest('.btn-preview').dataset.themeId;
        const theme = themesData.themes.find(t => t.id === themeId);
        
        if (theme) {
            openThemePreview(theme);
        }
    }
});

// Установка темы
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-install') || e.target.closest('.btn-install')) {
        const themeId = e.target.dataset.themeId || e.target.closest('.btn-install').dataset.themeId;
        const theme = themesData.themes.find(t => t.id === themeId);
        
        if (theme) {
            installTheme(theme);
        }
    }
});

// Функция открытия предпросмотра темы
function openThemePreview(theme) {
    const modal = document.createElement('div');
    modal.className = 'theme-preview-modal';
    modal.innerHTML = `
        <div class="modal-overlay">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Предпросмотр: ${theme.name}</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="preview-container">
                        <div class="theme-preview">
                            <div class="preview-header">
                                <div class="preview-dots">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </div>
                            </div>
                            <div class="preview-content ${theme.preview.type}" style="background: ${theme.preview.background}; height: 300px;">
                                <div class="preview-sidebar" style="background: ${theme.preview.sidebar};">
                                    <div class="sidebar-item"></div>
                                    <div class="sidebar-item"></div>
                                    <div class="sidebar-item active" style="background: ${theme.preview.accent};"></div>
                                </div>
                                <div class="preview-editor">
                                    <div class="editor-line"></div>
                                    <div class="editor-line"></div>
                                    <div class="editor-line short"></div>
                                    <div class="editor-line"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="preview-info">
                        <p>${theme.description}</p>
                        <div class="preview-meta">
                            <span>Автор: ${theme.author}</span>
                            <span>Рейтинг: ${theme.rating} ⭐</span>
                            <span>Загрузок: ${formatNumber(theme.downloads)}</span>
                            <span>Версия: ${theme.version}</span>
                        </div>
                        <div class="preview-tags">
                            ${theme.tags.map(tag => `<span class="theme-tag">${tag}</span>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
                    <button class="btn btn-gradient" onclick="installThemeFromModal('${theme.id}')">
                        <i class="fas fa-download"></i> Скачать
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Добавляем стили для модального окна
    const modalStyles = document.createElement('style');
    modalStyles.textContent = `
        .theme-preview-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(5px);
        }
        
        .modal-content {
            background: var(--bg-light);
            border-radius: 16px;
            max-width: 700px;
            width: 90%;
            max-height: 85vh;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            animation: modalSlideIn 0.3s ease-out;
        }
        
        .dark-mode .modal-content {
            background: var(--card-bg-dark);
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 25px;
            border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        }
        
        .dark-mode .modal-header {
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .modal-header h3 {
            margin: 0;
            color: var(--text-light);
        }
        
        .dark-mode .modal-header h3 {
            color: var(--text-dark);
        }
        
        .modal-close {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: var(--text-light);
            opacity: 0.7;
            transition: opacity 0.3s;
        }
        
        .dark-mode .modal-close {
            color: var(--text-dark);
        }
        
        .modal-close:hover {
            opacity: 1;
        }
        
        .modal-body {
            padding: 25px;
            max-height: 60vh;
            overflow-y: auto;
        }
        
        .preview-container {
            margin-bottom: 20px;
        }
        
        .preview-container .theme-preview {
            border-radius: 8px;
            overflow: hidden;
        }
        
        .preview-info p {
            margin-bottom: 15px;
            line-height: 1.6;
        }
        
        .preview-meta {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 15px;
            margin-bottom: 15px;
            font-size: 14px;
            opacity: 0.8;
        }
        
        .preview-tags {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        .modal-footer {
            display: flex;
            gap: 15px;
            padding: 20px 25px;
            border-top: 1px solid rgba(0, 0, 0, 0.1);
            justify-content: flex-end;
        }
        
        .dark-mode .modal-footer {
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        @keyframes modalSlideIn {
            from {
                opacity: 0;
                transform: translateY(-50px) scale(0.9);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }
    `;
    
    document.head.appendChild(modalStyles);
    document.body.appendChild(modal);
    
    // Закрытие модального окна
    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.querySelector('.modal-overlay').addEventListener('click', (e) => {
        if (e.target === modal.querySelector('.modal-overlay')) {
            closeModal();
        }
    });
    
    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

// Функция закрытия модального окна
function closeModal() {
    const modal = document.querySelector('.theme-preview-modal');
    if (modal) {
        modal.remove();
    }
}

// Функция установки темы из модального окна
function installThemeFromModal(themeId) {
    const theme = themesData.themes.find(t => t.id === themeId);
    if (theme) {
        installTheme(theme);
        closeModal();
    }
}

// Функция установки темы
function installTheme(theme) {
    const card = document.querySelector(`[data-theme-id="${theme.id}"]`);
    const installBtn = card ? card.querySelector('.btn-install') : null;
    
    if (installBtn) {
        const originalText = installBtn.innerHTML;
        installBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Скачивание...';
        installBtn.disabled = true;
        
        // Создаем ссылку для скачивания
        const downloadLink = document.createElement('a');
        downloadLink.href = `themes/${theme.id}.css`;
        downloadLink.download = `${theme.id}.css`;
        downloadLink.style.display = 'none';
        
        // Добавляем ссылку в документ и кликаем по ней
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        // Показываем уведомление об успешном скачивании
        setTimeout(() => {
            installBtn.innerHTML = '<i class="fas fa-check"></i> Скачано';
            installBtn.classList.remove('btn-gradient');
            installBtn.classList.add('btn-primary');
            
            showNotification(`Тема "${theme.name}" успешно скачана!`, 'success');
            
            // Возвращаем кнопку в исходное состояние через 3 секунды
            setTimeout(() => {
                installBtn.innerHTML = originalText;
                installBtn.disabled = false;
                installBtn.classList.remove('btn-primary');
                installBtn.classList.add('btn-gradient');
            }, 3000);
        }, 1000);
    } else {
        // Если кнопка не найдена (например, в модальном окне), просто скачиваем
        const downloadLink = document.createElement('a');
        downloadLink.href = `themes/${theme.id}.css`;
        downloadLink.download = `${theme.id}.css`;
        downloadLink.style.display = 'none';
        
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        showNotification(`Тема "${theme.name}" успешно скачана!`, 'success');
    }
}

// Система уведомлений
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
        <button class="notification-close">&times;</button>
    `;
    
    // Стили для уведомлений
    const notificationStyles = document.createElement('style');
    notificationStyles.textContent = `
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--bg-light);
            border-radius: 8px;
            padding: 15px 20px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
            display: flex;
            align-items: center;
            gap: 15px;
            z-index: 10001;
            animation: slideInRight 0.3s ease-out;
            max-width: 400px;
        }
        
        .dark-mode .notification {
            background: var(--card-bg-dark);
        }
        
        .notification-success {
            border-left: 4px solid #10b981;
        }
        
        .notification-error {
            border-left: 4px solid #ef4444;
        }
        
        .notification-info {
            border-left: 4px solid var(--primary);
        }
        
        .notification-content {
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 1;
        }
        
        .notification-content i {
            font-size: 18px;
        }
        
        .notification-success .notification-content i {
            color: #10b981;
        }
        
        .notification-error .notification-content i {
            color: #ef4444;
        }
        
        .notification-info .notification-content i {
            color: var(--primary);
        }
        
        .notification-close {
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.3s;
        }
        
        .notification-close:hover {
            opacity: 1;
        }
        
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
    
    document.head.appendChild(notificationStyles);
    document.body.appendChild(notification);
    
    // Закрытие уведомления
    notification.querySelector('.notification-close').addEventListener('click', () => {
        notification.remove();
    });
    
    // Автоматическое закрытие через 5 секунд
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// Анимация появления карточек
function animateThemeCards() {
    const cards = document.querySelectorAll('.theme-card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        
        setTimeout(() => {
            card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

// Плавная прокрутка для кнопки "Создать тему"
document.querySelector('.create-theme .btn').addEventListener('click', (e) => {
    e.preventDefault();
    showNotification('Функция создания тем будет доступна в следующем обновлении!', 'info');
}); 