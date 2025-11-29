// server.js - Простой сервер для приема данных от расширения
// Запуск: node server.js

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8000;

// Настройка CORS для разрешения запросов от расширения
app.use(cors());
app.use(express.json());

// Создаем папку для сохранения файлов, если её нет
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Настройка multer для обработки файлов
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Временная папка для файлов
        const tempDir = path.join(uploadsDir, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
        // Временное имя файла
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // Максимум 100MB на файл
        files: 50 // Максимум 50 файлов за раз
    }
});

// Основной endpoint для приема данных
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        console.log('\n=== Получен новый запрос ===');
        console.log('Время:', new Date().toLocaleString());
        
        // Проверяем тип запроса
        if (req.body.type === 'attachment' && req.file) {
            // Это загрузка файла-вложения
            console.log('\n📎 Получен файл-вложение:');
            console.log('  Имя файла:', req.body.filename || req.file.originalname);
            console.log('  Размер:', (req.file.size / 1024).toFixed(2), 'KB');
            console.log('  ID проекта:', req.body.project_id || 'Не указан');
            console.log('  URL страницы:', req.body.page_url || 'Не указан');
            console.log('  Оригинальный URL:', req.body.original_url || 'Не указан');
            
            // Создаем папку для проекта если её еще нет
            const projectId = req.body.project_id || 'unknown';
            const projectDir = path.join(uploadsDir, `project_${projectId}`);
            
            if (!fs.existsSync(projectDir)) {
                fs.mkdirSync(projectDir, { recursive: true });
            }
            
            // Перемещаем файл в папку проекта
            const oldPath = req.file.path;
            const newPath = path.join(projectDir, req.body.filename || req.file.originalname);
            
            fs.renameSync(oldPath, newPath);
            console.log('  Сохранен в:', newPath);
            
            return res.json({
                status: 'success',
                message: 'File uploaded successfully',
                file: {
                    name: req.body.filename || req.file.originalname,
                    size: req.file.size,
                    projectId: projectId
                }
            });
        }
        
        // Это загрузка метаданных проекта
        if (req.body.projectData) {
            const projectData = JSON.parse(req.body.projectData || '{}');
            
            // Проверка на тестовый запрос
            if (projectData.test) {
                console.log('Получен тестовый запрос');
                return res.json({ 
                    status: 'success', 
                    message: 'Test connection successful',
                    timestamp: new Date().toISOString()
                });
            }
            
            console.log('\n📋 Информация о проекте:');
            console.log('ID:', projectData.id || 'Не указан');
            console.log('Название:', projectData.title || 'Без названия');
            console.log('URL:', projectData.url || 'Не указан');
            // console.log('Заказчик:', projectData.customer || 'Не указан');
            console.log('Верифицирован:', projectData.verified || 'Нет');
            // console.log('Безопасная сделка:', projectData.safeDeal || 'Нет');
            
            if (projectData.budget) {
                console.log('Бюджет:', projectData.budget || 'Не указан');
            }
            
            console.log('Дата публикации:', projectData.publishedDate || 'Не указана');
            console.log('Категории:', projectData.sections || 'Не указаны');
            console.log('Отзывы:', projectData.reviews || 'Не указаны');
            console.log('Регистрация заказчика:', projectData.registration || 'Не указана');
            
            // Создаем папку для проекта
            const projectId = projectData.id || `unknown_${Date.now()}`;
            const projectDir = path.join(uploadsDir, `project_${projectId}`);
            
            if (!fs.existsSync(projectDir)) {
                fs.mkdirSync(projectDir, { recursive: true });
            }
            
            // Сохраняем метаданные проекта в JSON файл
            const metadataPath = path.join(projectDir, 'project_metadata.json');
            fs.writeFileSync(metadataPath, JSON.stringify(projectData, null, 2));
            console.log('\n✅ Метаданные сохранены в:', metadataPath);
            
            // Информация о ссылках
            if (projectData.links && projectData.links.length > 0) {
                console.log(`\n🔗 Найдено ссылок: ${projectData.links.length}`);
                const linksPath = path.join(projectDir, 'links.txt');
                const linksContent = projectData.links.join('\n');
                fs.writeFileSync(linksPath, linksContent);
                console.log('Ссылки сохранены в:', linksPath);
            }
            
            // Информация о файлах
            if (projectData.fileUrls && projectData.fileUrls.length > 0) {
                console.log(`\n📎 Обнаружено файлов для загрузки: ${projectData.fileUrls.length}`);
                projectData.fileNames.forEach((name, index) => {
                    console.log(`  ${index + 1}. ${name}`);
                });
            }
            
            // Отправляем успешный ответ
            return res.json({
                status: 'success',
                message: 'Project metadata received successfully',
                project: {
                    id: projectData.id,
                    title: projectData.title,
                    savedTo: projectDir,
                    filesExpected: projectData.fileUrls ? projectData.fileUrls.length : 0
                }
            });
        }
        
        // Если ничего не распознано
        res.status(400).json({
            status: 'error',
            message: 'Invalid request format'
        });
        
    } catch (error) {
        console.error('❌ Ошибка обработки запроса:', error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// Endpoint для получения статистики (опционально)
app.get('/api/stats', (req, res) => {
    try {
        const projects = fs.readdirSync(uploadsDir).filter(f => f.startsWith('project_'));
        res.json({
            totalProjects: projects.length,
            projects: projects
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log('🚀 FL.ru Parser Server');
    console.log(`📡 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📁 Файлы сохраняются в: ${uploadsDir}`);
    console.log('\nEndpoints:');
    console.log(`  POST http://localhost:${PORT}/api/upload - Прием данных от расширения`);
    console.log(`  GET  http://localhost:${PORT}/api/stats  - Статистика загрузок`);
    console.log('\nОжидание данных от расширения...\n');
});

// Обработка graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Сервер остановлен');
    process.exit(0);
});
