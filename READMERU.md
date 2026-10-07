# FgSNotes

[![Electron](https://img.shields.io/badge/Electron-36.4.0-47848F?style=flat-square&logo=electron)](https://electronjs.org/) [![License](https://img.shields.io/badge/License-GPL2-blue.svg?style=flat-square)](LICENSE) [![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg?style=flat-square)](https://github.com/ArduRadioKot/FgSNotes)

FgSNotes — настольный Markdown-редактор на Electron. Окно приложения разделено на редактор и предпросмотр, поэтому результат можно видеть во время работы с документом.

![Интерфейс FgSNotes](images/landing1.png)

## Возможности

- создание, открытие и сохранение Markdown-файлов;
- несколько открытых документов во вкладках;
- режимы «Редактор», «Рядом» и «Просмотр»;
- предпросмотр Markdown в реальном времени;
- панель форматирования для заголовков, выделения, списков, цитат, ссылок, изображений и блоков кода;
- настройка шрифта, размера текста, межстрочного интервала, табуляции и переноса строк;
- переключение темы интерфейса и предпросмотра;
- изменение ширины редактора и предпросмотра.

## Запуск из исходников

Требуется Node.js и npm.

```bash
npm install
npm start
```

Окно приложения запускается командой `npm start`.

## Тесты

```bash
npm test
```

Тесты находятся в каталоге `tests/` и запускаются встроенным тестовым модулем Node.js.

## Сборка

Для локальной сборки без создания установщика:

```bash
npm run dist
```

Для создания установщиков и архивов используются следующие команды:

```bash
npm run build:mac       # macOS, arm64 и x64
npm run build:win       # Windows, x64 и ia32
npm run build:linux     # Linux, x64
npm run build:all       # все поддерживаемые платформы
```

Команды сборки используют Electron Builder. Готовые файлы появляются в каталоге `dist/`.

## Горячие клавиши

| Действие       | macOS     | Windows/Linux |
| -------------- | --------- | ------------- |
| Новый документ | `Cmd + N` | `Ctrl + N`    |
| Открыть файл   | `Cmd + O` | `Ctrl + O`    |
| Сохранить файл | `Cmd + S` | `Ctrl + S`    |
| Жирный текст   | `Cmd + B` | `Ctrl + B`    |
| Курсив         | `Cmd + I` | `Ctrl + I`    |

## Структура проекта

```text
main.js                 Главный процесс Electron
preload.js              Безопасный мост между процессами
src/MarkDownEditor.html Разметка приложения
src/editor.js           Работа с документами и предпросмотром
src/markdown.js         Обработка Markdown
src/settings.js         Настройки редактора
src/theme.js            Темы интерфейса
src/resize.js           Изменение размеров панелей
src/highlight.js        Подсветка синтаксиса
src/styles.css          Стили приложения
tests/                  Автоматические тесты
```

## Лицензия

Проект распространяется по лицензии, указанной в файле [LICENSE](LICENSE).
