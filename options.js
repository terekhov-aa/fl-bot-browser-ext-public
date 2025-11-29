// options.js - Логика страницы настроек

// Загрузка сохраненных настроек при открытии страницы
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    
    // Обработчик формы
    document.getElementById('settingsForm').addEventListener('submit', saveSettings);
    
    // Обработчик кнопки тестирования
    document.getElementById('testButton').addEventListener('click', testConnection);
});

// Загрузка настроек из хранилища
function loadSettings() {
    chrome.storage.local.get(['uploadSettings'], (result) => {
        if (result.uploadSettings) {
            document.getElementById('endpoint').value = result.uploadSettings.endpoint || 'http://localhost:8000/api/upload';
            document.getElementById('autoDownload').checked = result.uploadSettings.autoDownload !== false;
            document.getElementById('sendMetadata').checked = result.uploadSettings.sendMetadata !== false;
        } else {
            // Значения по умолчанию
            document.getElementById('endpoint').value = 'http://localhost:8000/api/upload';
            document.getElementById('autoDownload').checked = true;
            document.getElementById('sendMetadata').checked = true;
        }
    });
}

// Сохранение настроек
function saveSettings(e) {
    e.preventDefault();
    
    const settings = {
        endpoint: document.getElementById('endpoint').value,
        autoDownload: document.getElementById('autoDownload').checked,
        sendMetadata: document.getElementById('sendMetadata').checked
    };
    
    chrome.storage.local.set({ uploadSettings: settings }, () => {
        showStatus('Настройки успешно сохранены!', 'success');
    });
}

// Тестирование подключения к серверу
async function testConnection() {
    const endpoint = document.getElementById('endpoint').value;
    
    if (!endpoint) {
        showStatus('Пожалуйста, укажите URL сервера', 'error');
        return;
    }
    
    const button = document.getElementById('testButton');
    const originalText = button.textContent;
    button.textContent = 'Тестирование...';
    button.disabled = true;
    
    try {
        // Создаем тестовый запрос
        const testData = new FormData();
        testData.append('test', 'true');
        testData.append('projectData', JSON.stringify({
            test: true,
            timestamp: new Date().toISOString()
        }));
        
        const response = await fetch(endpoint, {
            method: 'POST',
            body: testData
        });
        
        if (response.ok) {
            showStatus('✅ Соединение успешно установлено!', 'success');
        } else {
            showStatus(`❌ Ошибка подключения: HTTP ${response.status}`, 'error');
        }
    } catch (error) {
        if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
            showStatus(`❌ Не удалось подключиться к серверу. Убедитесь, что сервер запущен и доступен по адресу ${endpoint}`, 'error');
        } else {
            showStatus(`❌ Ошибка: ${error.message}`, 'error');
        }
    } finally {
        button.textContent = originalText;
        button.disabled = false;
    }
}

// Показ статуса операции
function showStatus(message, type) {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
    statusElement.style.display = 'block';
    
    // Автоматически скрыть через 5 секунд
    setTimeout(() => {
        statusElement.style.display = 'none';
    }, 5000);
}

// Обработка ошибок
chrome.runtime.lastError && console.error(chrome.runtime.lastError);
