// Переключение темы
const themeToggle = document.getElementById('themeToggle');
const icon = themeToggle.querySelector('i');
const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');

// Проверка сохраненной темы или системных предпочтений
let currentTheme = localStorage.getItem('theme');
if (!currentTheme) {
    currentTheme = prefersDarkScheme.matches ? 'dark' : 'light';
}

// Применение темы
if (currentTheme === 'dark') {
    document.body.classList.add('dark-mode');
    icon.classList.remove('fa-moon');
    icon.classList.add('fa-sun');
}

// Обработчик переключения темы
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    
    if (isDark) {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
        localStorage.setItem('theme', 'dark');
    } else {
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
        localStorage.setItem('theme', 'light');
    }
});

// Мобильное меню
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const navLinks = document.querySelector('.nav-links');

mobileMenuBtn.addEventListener('click', () => {
    navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
});

// Закрытие меню при ресайзе
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        navLinks.style.display = 'flex';
    } else {
        navLinks.style.display = 'none';
    }
});

// Плавная прокрутка
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        
        document.querySelector(this.getAttribute('href')).scrollIntoView({
            behavior: 'smooth'
        });
        
        // Закрытие мобильного меню после клика
        if (window.innerWidth <= 768) {
            navLinks.style.display = 'none';
        }
    });
});

// Анимация при скролле
const animateOnScroll = () => {
    const elements = document.querySelectorAll('.feature-card, .download-card, .demo-image-container');
    
    elements.forEach(element => {
        const elementPosition = element.getBoundingClientRect().top;
        const screenPosition = window.innerHeight / 1.3;
        
        if (elementPosition < screenPosition) {
            element.style.opacity = '1';
            element.style.transform = 'translateY(0)';
        }
    });
};

// Инициализация анимации
window.addEventListener('load', () => {
    const animatedElements = document.querySelectorAll('.feature-card, .download-card, .demo-image-container');
    animatedElements.forEach(element => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(20px)';
        element.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    });
    
    setTimeout(animateOnScroll, 300);
});

window.addEventListener('scroll', animateOnScroll); 