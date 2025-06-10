function parseMarkdown(text) {
    text = text.replace(/^\[toc\]$/gm, '<div class="table-of-contents"></div>');
    
    text = text.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    text = text.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    text = text.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    text = text.replace(/^#### (.*$)/gm, '<h4>$1</h4>');
    text = text.replace(/^##### (.*$)/gm, '<h5>$1</h5>');
    text = text.replace(/^###### (.*$)/gm, '<h6>$1</h6>');
    
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    text = text.replace(/~~(.*?)~~/g, '<del>$1</del>');
    
    text = text.replace(/<u>(.*?)<\/u>/g, '<u>$1</u>');
    
    text = text.replace(/<sup>(.*?)<\/sup>/g, '<sup>$1</sup>');

    text = text.replace(/<sub>(.*?)<\/sub>/g, '<sub>$1</sub>');
    
    text = text.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
    
    text = text.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1">');
    
    text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    text = text.replace(/`(.*?)`/g, '<code>$1</code>');
    
    text = text.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');
    
    text = text.replace(/^- \[ \] (.*$)/gm, '<li class="todo-item"><input type="checkbox" disabled> $1</li>');
    text = text.replace(/^- \[x\] (.*$)/gm, '<li class="todo-item"><input type="checkbox" checked disabled> $1</li>');
    text = text.replace(/(<li class="todo-item">.*<\/li>)/gs, '<ul class="todo-list">$1</ul>');
    
    text = text.replace(/^- (.*$)/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    
    text = text.replace(/^(\d+)\. (.*$)/gm, '<li>$2</li>');
    text = text.replace(/(<li>.*<\/li>)/gs, '<ol>$1</ol>');
    
    text = text.replace(/^  - (.*$)/gm, '<li class="nested">$1</li>');
    text = text.replace(/^  (\d+)\. (.*$)/gm, '<li class="nested">$2</li>');
    
    const tableRegex = /\|(.*)\|\n\|(.*)\|\n((?:\|.*\|\n?)*)/g;
    text = text.replace(tableRegex, function(match, header, separator, content) {
        const headers = header.split('|').map(h => h.trim()).filter(h => h);
        const headerHtml = headers.map(h => `<th>${h}</th>`).join('');
        
        const rows = content.split('\n').filter(row => row.trim());
        const contentHtml = rows.map(row => {
            const cells = row.split('|').map(cell => cell.trim()).filter(cell => cell);
            return `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`;
        }).join('');
        
        return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${contentHtml}</tbody></table>`;
    });
    
    text = text.replace(/^(?!<[h|ul|ol|blockquote|pre|u|sup|sub|table|div])(.*$)/gm, '<p>$1</p>');
    
    text = text.replace(/<p><\/p>/g, '');
    
    const toc = document.querySelector('.table-of-contents');
    if (toc) {
        const headings = text.match(/<h[1-6].*?>(.*?)<\/h[1-6]>/g) || [];
        let tocHtml = '<ul class="toc-list">';
        headings.forEach(heading => {
            const level = heading.match(/<h([1-6])/)[1];
            const title = heading.replace(/<h[1-6].*?>(.*?)<\/h[1-6]>/, '$1');
            tocHtml += `<li class="toc-level-${level}"><a href="#${title.toLowerCase().replace(/\s+/g, '-')}">${title}</a></li>`;
        });
        tocHtml += '</ul>';
        toc.innerHTML = tocHtml;
    }
    
    return text;
}

function downloadArticle() {
    try {
        const editor = document.getElementById('markdown-editor');
        if (!editor) {
            throw new Error('Не удалось найти редактор на странице');
        }

        const content = editor.value.trim();
        const filename = 'article.md';

        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Ошибка при скачивании:', error);
        alert('Произошла ошибка при скачивании файла: ' + error.message);
    }
}

window.insertMarkdown = function(start, end) {
    const textarea = document.getElementById('markdown-editor');
    if (textarea) {
        const startPos = textarea.selectionStart;
        const endPos = textarea.selectionEnd;
        const selectedText = textarea.value.substring(startPos, endPos);
        const newText = start + selectedText + end;
        textarea.value = textarea.value.substring(0, startPos) + newText + textarea.value.substring(endPos, textarea.value.length);
        textarea.focus();
        textarea.selectionStart = startPos + start.length;
        textarea.selectionEnd = startPos + start.length + selectedText.length;
        
        updatePreview();
        saveCurrentDocument();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('markdown-editor');
    const preview = document.getElementById('preview');

    let documents = [];
    let activeDocumentIndex = 0;
    let nextDocumentId = 1;

    const tabBar = document.querySelector('.tab-bar');
    const newTabButton = document.querySelector('.new-tab-button');

    const newFileButton = document.getElementById('new-file-button');
    const openFileButton = document.getElementById('open-file-button');
    const saveFileButton = document.getElementById('save-file-button');

    function updatePreview() {
        if (editor && preview) {
            const markdownText = editor.value;
            const html = parseMarkdown(markdownText);
            preview.innerHTML = html;
        }
    }

    function saveCurrentDocument() {
        if (documents[activeDocumentIndex]) {
            localStorage.setItem(`editorContent_doc${documents[activeDocumentIndex].id}`, editor.value);
            documents[activeDocumentIndex].content = editor.value;
        }
    }

    function loadDocument(index) {
        if (documents[index]) {
            editor.value = documents[index].content;
            updatePreview();
        }
    }

    function addNewTab() {
        saveCurrentDocument();

        const newDocument = {
            id: nextDocumentId++,
            title: `Документ ${nextDocumentId}`,
            content: ''
        };
        documents.push(newDocument);
        activeDocumentIndex = documents.length - 1;

        renderTabs();
        loadDocument(activeDocumentIndex);
        editor.focus();
    }

    function switchTab(index) {
        if (index === activeDocumentIndex) return;
        saveCurrentDocument();
        activeDocumentIndex = index;
        renderTabs();
        loadDocument(activeDocumentIndex);
        editor.focus();
    }

    function closeTab(indexToClose) {
        if (documents.length === 1) {
            alert('Cannot close the last tab.');
            return;
        }

        const closedDocId = documents[indexToClose].id;
        localStorage.removeItem(`editorContent_doc${closedDocId}`);

        if (indexToClose === activeDocumentIndex) {
            if (indexToClose === documents.length - 1) {
                activeDocumentIndex--;
            }
        } else if (indexToClose < activeDocumentIndex) {
            activeDocumentIndex--;
        }

        documents.splice(indexToClose, 1);
        renderTabs();
        loadDocument(activeDocumentIndex);
        editor.focus();
    }

    function renderTabs() {
        tabBar.innerHTML = '';
        documents.forEach((doc, index) => {
            const tabItem = document.createElement('div');
            tabItem.classList.add('tab-item');
            if (index === activeDocumentIndex) {
                tabItem.classList.add('active');
            }
            tabItem.dataset.index = index;
            tabItem.textContent = doc.title;

            const closeSpan = document.createElement('span');
            closeSpan.classList.add('close-tab');
            closeSpan.textContent = 'x';
            closeSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(index);
            });
            tabItem.appendChild(closeSpan);

            tabItem.addEventListener('click', () => switchTab(index));
            tabBar.appendChild(tabItem);
        });

        tabBar.appendChild(newTabButton);
    }

    function newFile() {
        addNewTab();
    }

    function openFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md, .txt';
        input.onchange = e => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    saveCurrentDocument();
                    const newDocument = {
                        id: nextDocumentId++,
                        title: file.name,
                        content: event.target.result
                    };
                    documents.push(newDocument);
                    activeDocumentIndex = documents.length - 1;
                    renderTabs();
                    loadDocument(activeDocumentIndex);
                    editor.focus();
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    function saveFile() {
        if (documents[activeDocumentIndex]) {
            const content = documents[activeDocumentIndex].content;
            const filename = documents[activeDocumentIndex].title + '.md';
            const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } else {
            alert('No document to save.');
        }
    }

    editor.addEventListener('input', () => {
        updatePreview();
        saveCurrentDocument();
    });

    newTabButton.addEventListener('click', addNewTab);

    newFileButton.addEventListener('click', newFile);
    openFileButton.addEventListener('click', openFile);
    saveFileButton.addEventListener('click', saveFile);

    for (let i = 0; ; i++) {
        const savedContent = localStorage.getItem(`editorContent_doc${i}`);
        if (savedContent) {
            documents.push({
                id: i,
                title: `Документ ${i + 1}`,
                content: savedContent
            });
            nextDocumentId = i + 1;
        } else {
            break;
        }
    }

    if (documents.length === 0) {
        const exampleText = `# Добро пожаловать в редактор Markdown

[toc]

## Основные возможности

### Форматирование текста
- Поддержка **жирного** текста
- Поддержка *курсива*
- Поддержка ~~зачеркнутого~~ текста
- Поддержка <u>подчеркнутого</u> текста
- Поддержка <sup>надстрочного</sup> и <sub>подстрочного</sub> текста

### Списки
1. Нумерованные списки
2. Маркированные списки
   1. С поддержкой вложенности
   2. На несколько уровней

### Задачи
- [ ] Создать новый документ
- [x] Изучить возможности редактора
- [ ] Настроить тему оформления

### Таблицы
| Функция | Описание | Пример |
|---------|----------|---------|
| Заголовки | Создание заголовков | # Заголовок |
| Списки | Создание списков | - Элемент |
| Код | Вставка кода | \`\`\`код\`\`\` |

### Код
\`\`\`
console.log("Hello, World!");
\`\`\`

### Цитаты
> Это пример цитаты
> Она может быть на несколько строк

### Ссылки и изображения
[Ссылка на сайт](https://example.com)
![Описание изображения](https://example.com/image.jpg)

## Дополнительные возможности
- Автоматическое сохранение
- Поддержка тем оформления
- Предпросмотр в реальном времени
- Возможность изменения размеров панелей`;
        documents.push({
            id: nextDocumentId++,
            title: 'Документ 1',
            content: exampleText
        });
    }
    
    renderTabs();
    loadDocument(activeDocumentIndex);
});