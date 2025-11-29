// offscreen.js - для загрузки больших файлов в фоне
// Принимает { type: "UPLOAD_FILE", attachment:{url,name}, pageUrl, projectId, settings:{directEndpoint} }
// 1) Скачивает файл с учётом cookies (credentials: include)
// 2) Отправляет FormData(file, project_id, page_url, original_url, filename) через XHR с прогрессом

async function downloadWithCookies(url) {
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} при скачивании`);
  
  // Пытаемся извлечь имя файла из заголовка
  const cd = resp.headers.get("content-disposition") || "";
  let filename = null;
  const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
  if (m) {
    try { 
      filename = decodeURIComponent(m[1]); 
    } catch { 
      filename = m[1]; 
    }
  }
  
  const blob = await resp.blob();
  return { blob, filename };
}

function uploadMultipartXHR({ blob, filename, pageUrl, projectId, originalUrl, endpoint }, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    
    // Добавляем файл
    form.append("file", blob, filename);
    
    // Добавляем метаданные для связи с проектом
    form.append("project_id", projectId || "");
    form.append("page_url", pageUrl || "");
    form.append("original_url", originalUrl || "");
    form.append("filename", filename || "file.bin");
    form.append("type", "attachment"); // помечаем что это вложение

    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint, true);

    // Прогресс загрузки
    if (xhr.upload && typeof onProgress === "function") {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Пробуем распарсить JSON ответ
          try { 
            resolve(JSON.parse(xhr.responseText)); 
          } catch { 
            resolve({ ok: true }); 
          }
        } else {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("NETWORK_ERROR"));
    xhr.send(form);
  });
}

// Обработчик сообщений от background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type !== "UPLOAD_FILE") return;

    const { attachment, pageUrl, projectId, settings } = msg;
    const endpoint = "http://localhost:8000/api/upload_file";
    
    if (!endpoint) {
      chrome.runtime.sendMessage({ 
        type: "UPLOAD_ERROR", 
        name: attachment?.name || "file", 
        error: "Не задан endpoint для загрузки" 
      });
      sendResponse?.({ ok: false, error: "no endpoint" });
      return;
    }

    try {
      console.log(`Начинаем загрузку файла: ${attachment.name} с URL: ${attachment.url}`);
      
      // Скачиваем файл с cookies
      const { blob, filename: nameFromCD } = await downloadWithCookies(attachment.url);
      const filename = nameFromCD || attachment.name || "file.bin";
      
      console.log(`Файл скачан: ${filename}, размер: ${blob.size} байт`);

      // Функция для отправки прогресса
      let lastNotified = 0;
      const onProgress = (percent) => {
        // Отправляем уведомления о прогрессе каждые 5%
        if (percent !== lastNotified && percent % 5 === 0) {
          lastNotified = percent;
          chrome.runtime.sendMessage({ 
            type: "UPLOAD_PROGRESS", 
            name: filename, 
            percent: percent 
          });
        }
      };

      // Отправляем файл на сервер
      console.log(`Отправка файла ${filename} на сервер ${endpoint}`);
      
      const result = await uploadMultipartXHR({
        blob,
        filename,
        pageUrl,
        projectId,
        originalUrl: attachment.url,
        endpoint
      }, onProgress);

      console.log(`Файл ${filename} успешно отправлен`, result);
      
      // Уведомляем об успешной загрузке
      chrome.runtime.sendMessage({ 
        type: "UPLOAD_DONE", 
        name: filename, 
        result 
      });
      
      sendResponse?.({ ok: true });
      
    } catch (error) {
      console.error(`Ошибка при обработке файла ${attachment?.name}:`, error);
      
      chrome.runtime.sendMessage({
        type: "UPLOAD_ERROR",
        name: attachment?.name || "file",
        error: String(error?.message || error)
      });
      
      sendResponse?.({ ok: false, error: String(error?.message || error) });
    }
  })();

  return true; // async sendResponse
});

console.log('Offscreen document загружен и готов к работе');
