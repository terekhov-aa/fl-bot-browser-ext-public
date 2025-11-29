// background.js - Service Worker для парсинга и отправки данных FL.ru

const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");

// Настройки по умолчанию
let settings = {
    endpoint: "http://localhost:8000/api/upload",
    autoDownload: true,
    sendMetadata: true
};

// Загрузка настроек при старте
chrome.storage.local.get(['uploadSettings'], (result) => {
    if (result.uploadSettings) {
        settings = {...settings, ...result.uploadSettings};
    }
});

// Создание контекстного меню при установке
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "parse-and-upload",
        title: "Парсить проект и отправить на сервер",
        contexts: ["page"],
        documentUrlPatterns: [
            "https://*.fl.ru/projects/*",
            "https://fl.ru/projects/*"
        ]
    });
});

// Обработка клика по контекстному меню
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "parse-and-upload" && tab?.id !== undefined) {
        chrome.scripting.executeScript({
            target: {tabId: tab.id},
            func: parseProjectAndSend
        });
    }
});

// Создание offscreen документа для загрузки больших файлов
async function ensureOffscreen() {
    if (chrome.offscreen && chrome.offscreen.hasDocument) {
        const has = await chrome.offscreen.hasDocument();
        if (has) return;
    }
    await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ["BLOBS"],
        justification: "Долгие multipart-загрузки крупных файлов (200+ МБ) с прогрессом."
    });
}

// Обработка сообщений
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "PROJECT_DATA") {
        handleProjectData(message.data, sender.tab?.id);
    } else if (message.type === "GET_SETTINGS") {
        sendResponse(settings);
    } else if (message.type === "UPLOAD_PROGRESS") {
        const {name, percent} = message;
        chrome.notifications.create({
            type: "basic",
            iconUrl: "icon48.png",
            title: "Загрузка файла",
            message: `${name}: ${percent}%`
        });
    } else if (message.type === "UPLOAD_DONE") {
        chrome.notifications.create({
            type: "basic",
            iconUrl: "icon48.png",
            title: "Готово",
            message: `${message.name} загружен успешно`
        });
    } else if (message.type === "UPLOAD_ERROR") {
        chrome.notifications.create({
            type: "basic",
            iconUrl: "icon48.png",
            title: "Ошибка загрузки",
            message: `${message.name}: ${message.error}`
        });
    }
    return true;
});

// Функция парсинга проекта (выполняется в контексте страницы) - точная копия из оригинала
function parseProjectAndSend() {

    // Helper для извлечения ID проекта
    function getProjectId() {
        // 1) Пытаемся вытащить ID из h1#prj_name_<ID>
        let id = null;
        const h1 = document.querySelector('h1[id^="prj_name_"]');
        if (h1 && h1.id) {
            const m = h1.id.match(/prj_name_(\d+)/);
            if (m) id = m[1];
        }

        // 2) Если не нашли — og:url
        if (!id) {
            const og = document.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
            const m = og.match(/\/projects\/(\d+)\//);
            if (m) id = m[1];
        }

        // 3) Если не нашли — canonical
        if (!id) {
            const can = document.querySelector('link[rel="canonical"]')?.href || '';
            const m = can.match(/\/projects\/(\d+)\//);
            if (m) id = m[1];
        }

        // 4) Если не нашли — URL страницы
        if (!id) {
            const m = location.href.match(/\/projects\/(\d+)\//);
            if (m) id = m[1];
        }

        return id;
    }

    // Helper для извлечения заголовка
    function getTitle() {
        const id = getProjectId();

        // Возвращаем заголовок из h1#prj_name_<ID>
        if (id) {
            const node = document.querySelector(`h1#prj_name_${id}`);
            if (node) return node.textContent || '';
        }

        return '';
    }

    // Helper для извлечения текста после метки
    function extractAfterLabel(label) {
        const bodyText = document.body.innerText;
        const idx = bodyText.indexOf(label);
        if (idx === -1) return '';
        const remainder = bodyText.slice(idx + label.length);
        // Split on newlines and return the first non-empty line.
        const lines = remainder.split(/\r?\n/).map(l => l.trim()).filter(l => l);
        return lines.length > 0 ? lines[0] : '';
    }

    // Извлекаем верификацию и безопасную сделку
    const verified = document.querySelector('[title*="Верифицированный"]') ? 'Да' : 'Нет';
//     const safeDeal = detectSafeDealInCustomer() ? 'Да' : 'Нет';
//
// // --- где-то ниже поместите функцию ---
//     function detectSafeDealInCustomer() {
//         const SAFE_PATTERNS = [
//             /безопасн\w*\s*сделк\w*/i,        // «Безопасная сделка», «Безопасной Сделке», и т.п.
//             /сделк\w*\s*без\s*риска/i,        // «Сделка без риска»
//             /\bСБР\b/i                        // «СБР» (старое название)
//         ];
//         const ATTRS = ['title', 'aria-label', 'data-title', 'data-original-title', 'data-tooltip'];
//
//         // Находим контейнер «Заказчик» (несколько эвристик, затем фоллбэк)
//         const customerRoot = (() => {
//             // 1) Заголовок «Заказчик»
//             const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4,strong,b,legend,div,span'))
//                 .find(el => /^\s*заказчик\b/i.test((el.textContent || '').trim()));
//             if (heading) return heading.closest('section,aside,article,div') || heading;
//
//             // 2) Частые контейнеры блока пользователя
//             const known = document.querySelector(
//                 'aside[class*="user"],aside[class*="customer"],' +
//                 'div[class*="user-info"],div[class*="proj-user"],.b-user,.user-info'
//             );
//             if (known) return known;
//
//             // 3) Боксы, где встречаются «На сайте», «Отзывы» и т.п.
//             const candidate = Array.from(document.querySelectorAll('aside,section,div'))
//                 .find(n => /на сайте|отзывы|заказчик/i.test(n.textContent || ''));
//             return candidate || document; // последний фоллбэк — весь документ
//         })();
//
//         // 1) Проверяем подсказки/тултипы/титлы
//         const labeledEls = customerRoot.querySelectorAll('[title],[aria-label],[data-title],[data-original-title],[data-tooltip],svg title');
//         for (const el of labeledEls) {
//             const value = el.tagName.toLowerCase() === 'title' && el.parentNode?.tagName?.toLowerCase() === 'svg'
//                 ? (el.textContent || '')
//                 : ATTRS.map(a => el.getAttribute(a) || '').join(' ');
//             if (SAFE_PATTERNS.some(re => re.test(value))) return true;
//         }
//
//         // 2) Ищем текстовые метки/бейджи внутри блока «Заказчик»
//         const textBucket = Array.from(customerRoot.querySelectorAll('a,span,div,li,small,em,strong'))
//             .map(e => e.textContent || '')
//             .join(' ');
//         if (SAFE_PATTERNS.some(re => re.test(textBucket))) return true;
//
//         // 3) Лёгкие эвристики по классам и ссылкам (редко нужны, но полезны)
//         if (customerRoot.querySelector('[class*="sbr"],[class*="safe"],[class*="sbdeal"],[href*="sbr"]')) {
//             return true;
//         }
//
//         return false;
//     }

    // Бюджет - сохраняем оригинальную логику
    function getCostInDollars() {
        let rawCost = extractAfterLabel('Бюджет:');
        if (!rawCost) rawCost = extractAfterLabel('Бюджет');
        if (rawCost && /договоренност/i.test(rawCost)) {
            return rawCost;
        }
        const bodyText = document.body.innerText;
        const idxBudget = bodyText.indexOf('Бюджет');
        if (idxBudget !== -1) {
            const after = bodyText.slice(idxBudget);
            const match = after.match(/([0-9]+(?:[.,][0-9]+)?)\s*\$/);
            if (match) {
                return match[1].replace(',', '.');
            }
        }
        return rawCost;
    }

    const cost = getCostInDollars();
    const reviews = extractAfterLabel('Отзывы фрилансеров:');
    const registration = extractAfterLabel('Зарегистрирован на сайте');
    const sections = extractAfterLabel('Разделы:');
    let pubDate = extractAfterLabel('Опубликован:');
    if (!pubDate) {
        pubDate = extractAfterLabel('Опубликована:');
    }
    // const customer = extractAfterLabel('Заказчик:');

    // Описание проекта
    function getDescription(projectId) {
        let id = projectId;
        if (!id) {
            id = getProjectId();
        }
        if (!id) return '';

        const node =
            document.querySelector(`#projectp${id}`) ||
            document.querySelector(`#project_info_${id}`);

        return node ? (node.textContent ?? '') : '';
    }

    const description = getDescription();

    // Функции для работы с ссылками и файлами
    function findDescriptionNode() {
        const id = getProjectId();
        if (!id) return null;
        return document.querySelector(`#projectp${id}`) ||
            document.querySelector(`#project_info_${id}`) ||
            null;
    }

    function abs(href) {
        try {
            return new URL(href, location.href).href;
        } catch {
            return null;
        }
    }

    function filenameFromHrefOrId(href) {
        try {
            const u = new URL(href, location.href);
            // try identifier like /f_<id>
            const idm = u.pathname.match(/\/(f_[^\/?#]+)/i);
            if (idm) return decodeURIComponent(idm[1]);
            const last = u.pathname.split('/').pop() || '';
            return decodeURIComponent(last.split('?')[0]);
        } catch {
            return href;
        }
    }

    // Сбор всех ссылок из описания
    const descNode = findDescriptionNode();
    const linkSet = new Set();
    if (descNode) {
        descNode.querySelectorAll('a[href]').forEach(a => {
            const u = abs(a.getAttribute('href'));
            if (u) linkSet.add(u);
        });
    }
    const allLinks = Array.from(linkSet);

    // Сбор файлов (вложений) - расширенная логика из оригинала
    const fileUrlSet = new Set();

    // explicit attachments block
    document.querySelectorAll('.base-attach-class a[href]').forEach(a => {
        const u = abs(a.getAttribute('href'));
        if (u) fileUrlSet.add(u);
    });

    // backup known classes
    document.querySelectorAll('.fl-attached-doc a[href], .fl-attached-doc_doc a[href], .fl-attached-doc_pdf a[href]').forEach(a => {
        const u = abs(a.getAttribute('href'));
        if (u) fileUrlSet.add(u);
    });

    // fallback: from description, detect by extension/keywords
    if (descNode) {
        const fileExt = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z|png|jpe?g|gif|svg|stl|obj|fbx|blend|3ds|max|dwg|dxf|heic|mp4|mov|avi|mkv)$/i;
        descNode.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href') || '';
            const text = (a.textContent || '').toLowerCase();
            const u = abs(href);
            if (!u) return;
            const low = u.toLowerCase();
            if (fileExt.test(low) ||
                low.includes('/download/') || low.includes('get-file') || low.includes('attachments') ||
                text.includes('скачать') || text.includes('download') || text.includes('файл')) {
                fileUrlSet.add(u);
            }
        });
    }

    const fileUrls = Array.from(fileUrlSet);
    const fileNames = fileUrls.map(filenameFromHrefOrId);

    // Формируем данные для отправки
    const projectData = {
        // ID и URL
        id: getProjectId(),
        url: location.href,
        pageTitle: document.title,

        // Основная информация
        title: getTitle().trim(),
        verified: verified,
        // safeDeal: safeDeal,

        // Заказчик и регистрация
        // customer: customer,
        registration: registration,

        // Финансы
        budget: cost,

        // Отзывы и категории
        reviews: reviews,
        sections: sections,

        // Даты
        publishedDate: pubDate,
        parsedAt: new Date().toISOString(),

        // Описание
        description: description.trim(),

        // Ссылки и файлы
        links: allLinks,
        fileUrls: fileUrls,
        fileNames: fileNames,

        // Для совместимости с первым расширением - формируем attachments
        attachments: fileUrls.map((url, index) => ({
            url: url,
            name: fileNames[index]
        }))
    };

    // Отправляем данные в background script
    chrome.runtime.sendMessage({
        type: "PROJECT_DATA",
        data: projectData
    });
}

// Обработка полученных данных проекта
async function handleProjectData(projectData, tabId) {
    console.log('Получены данные проекта:', projectData);

    // Показываем уведомление о начале обработки
    chrome.notifications.create({
        type: "basic",
        iconUrl: "icon48.png",
        title: "FL.ru Parser",
        message: `Обработка проекта: ${projectData.title || 'Без названия'}`
    });

    try {
        // Сначала отправляем метаданные проекта
        const metadataFormData = new FormData();

        // Подготавливаем JSON с метаданными (все поля из оригинала)
        const projectMetadata = {
            id: projectData.id,
            url: projectData.url,
            pageTitle: projectData.pageTitle,
            title: projectData.title,
            verified: projectData.verified,
            // safeDeal: projectData.safeDeal,
            // customer: projectData.customer,
            registration: projectData.registration,
            budget: projectData.budget,
            reviews: projectData.reviews,
            sections: projectData.sections,
            publishedDate: projectData.publishedDate,
            parsedAt: projectData.parsedAt,
            description: projectData.description,
            links: projectData.links,
            fileUrls: projectData.fileUrls,
            fileNames: projectData.fileNames
        };

        metadataFormData.append('projectData', JSON.stringify(projectMetadata));
        metadataFormData.append('hasAttachments', projectData.attachments.length > 0 ? 'true' : 'false');

        // Отправляем метаданные
        console.log(`Отправка метаданных на ${settings.endpoint}`);
        const metadataResponse = await fetch(settings.endpoint, {
            method: 'POST',
            body: metadataFormData
        });

        if (!metadataResponse.ok) {
            throw new Error(`HTTP ${metadataResponse.status}: ${metadataResponse.statusText}`);
        }

        // Если есть вложения и включена их загрузка, используем offscreen API
        if (settings.autoDownload && projectData.attachments && projectData.attachments.length > 0) {
            console.log(`Найдено ${projectData.attachments.length} вложений для загрузки`);

            // Создаем offscreen документ для загрузки
            await ensureOffscreen();

            // Последовательно загружаем файлы через offscreen
            for (const attachment of projectData.attachments) {
                try {
                    await chrome.runtime.sendMessage({
                        type: "UPLOAD_FILE",
                        mode: "direct",
                        attachment: attachment,
                        pageUrl: projectData.url,
                        projectId: projectData.id,
                        settings: {
                            directEndpoint: settings.endpoint
                        }
                    });

                    console.log(`Файл ${attachment.name} отправлен на загрузку`);
                } catch (error) {
                    console.error(`Ошибка при загрузке файла ${attachment.name}:`, error);
                }
            }

            chrome.notifications.create({
                type: "basic",
                iconUrl: "icon48.png",
                title: "Загрузка запущена",
                message: `Отправлено на загрузку файлов: ${projectData.attachments.length}`
            });
        } else if (projectData.attachments.length === 0) {
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icon48.png",
                title: "Данные отправлены",
                message: `Проект "${projectData.title}" отправлен (вложений не найдено)`
            });
        }

    } catch (error) {
        console.error('Ошибка при отправке данных:', error);

        chrome.notifications.create({
            type: "basic",
            iconUrl: "icon48.png",
            title: "Ошибка отправки",
            message: `Не удалось отправить данные: ${error.message}`
        });
    }
}

// Обновление настроек
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.uploadSettings) {
        settings = {...settings, ...changes.uploadSettings.newValue};
        console.log('Настройки обновлены:', settings);
    }
});
