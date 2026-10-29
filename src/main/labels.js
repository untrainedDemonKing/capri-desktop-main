'use strict';

// The tray menu (and the one she opens when you right-click her), in the two languages she speaks.

const TRAY = {
  en: {
    name: 'English',
    mood: (m) => `Mood: ${m}`, moods: { calm: 'calm', happy: 'in a good mood', angry: 'angry', annoyed: 'annoyed', sad: 'sad', shy: 'flustered', bored: 'bored' },
    character: 'Character', emotions: 'Emotions (anger, laughs, sulking)', life: 'Her own activities', dj: 'DJ mode (she skips tracks)', musicAware: 'Know what’s playing', learn: 'Learns about me (adapts to me)', bond: 'What she knows about me…',
    colors: 'Colours', themes: { classic: 'Red (like the anime)', netrunner: 'Netrunner (cyan)', toxic: 'Toxic (acid green)', violet: 'Violet', gold: 'Gold', sakura: 'Sakura (pink)', ghost: 'Ghost (white)', mood: 'Follow her mood' },
    voice: 'Voice', voiceOff: 'Silent (blips only)', voiceChat: 'Reads her chat answers', voiceAll: 'Reads everything she says', voiceEngine: 'Engine', engines: { piper: 'Piper (light, on this PC, run by her)', system: 'System voice (offline, free)', chatterbox: 'Chatterbox (on this PC, started by her)', openai: 'OpenAI (key)', elevenlabs: 'ElevenLabs (key)', custom: 'OpenAI-compatible server (local)' }, voiceFx: '“Many minds” effect', voiceSetup: 'Key, address or voice…', voiceTest: 'Test her voice', voiceKeyPage: 'Where do I get a key?',
    senses: 'Senses', vision: 'Let her see my screen', lookNow: 'Look at my screen', rhythm: 'Move to my music', ears: 'Listen to me (mic)', converse: 'Conversation mode', pushToTalk: 'Press to talk', visionSetup: 'Vision model…', earsSetup: 'Speech-to-text…', hands: 'Hands', handsOn: 'Let her work my windows', handsType: 'Let her type messages', handsMouse: 'Let her move the mouse and press buttons',
    online: (port) => `Capri — listening on ${port}`,
    teleport: 'Teleport', satellite: 'Look at the satellite', demo: 'Play demo', help: 'How does it work?', prepare: 'Setup (Ollama and Chatterbox)…', hub: 'Main menu (AI and set-up)…',
    report: 'Mission report', talk: 'Talk to her', ring: 'Circular menu', custom: 'Make her yours…', chatModel: 'AI model', aiSetup: 'Set it up with her…', apiKey: 'API key or address…', noOllama: 'Ollama not found',
    rest: 'When she rests', restCorner: 'In her corner', restTaskbar: 'Sitting on the taskbar', watch: 'Watch', watchNone: 'Nothing, just keep me company',
    motion: 'Animations', motionAuto: 'Like Windows', motionFull: 'Full', motionReduced: 'Reduced',
    display: 'Display', displayAuto: 'Normal', displayGl: 'OpenGL (if her background is black)', displaySoftware: 'Without the graphics card (if still black)',
    show: 'Bring her back', hide: 'Put her away',
    size: 'Size', small: 'Small', medium: 'Medium', large: 'Large', sound: 'Sound', mute: 'Mute',
    soundsDir: 'Open custom sounds folder', screen: 'Screen', wander: 'Wander around when idle',
    possess: 'Possess my windows', possessMove: 'Move them while she has them', lang: 'Language', auto: 'Automatic (system)', startup: 'Start with Windows',
    hooksOn: 'Claude Code hooks: installed', hooksOff: 'Install Claude Code hooks',
    hooksRemove: 'Remove Claude Code hooks', forget: 'Forget our conversations', quit: 'Quit',
  },
  ru: {
    name: 'Русский',
    mood: (m) => `Настроение: ${m}`, moods: { calm: 'спокойна', happy: 'в духе', angry: 'злится', annoyed: 'не в духе', sad: 'грустит', shy: 'смущена', bored: 'скучает' },
    character: 'Характер', emotions: 'Эмоции (злость, смех, обиды)', life: 'Свои занятия на экране', dj: 'Режим DJ (сама переключает треки)', musicAware: 'Знать, что играет', learn: 'Узнаёт меня (саморазвитие)', bond: 'Что она обо мне знает…',
    colors: 'Цвет', themes: { classic: 'Красный (как в аниме)', netrunner: 'Нетраннер (циан)', toxic: 'Токсичный (кислотно-зелёный)', violet: 'Фиолетовый', gold: 'Золото', sakura: 'Сакура (розовый)', ghost: 'Призрак (белый)', mood: 'По настроению' },
    voice: 'Голос', voiceOff: 'Молчит (только писк)', voiceChat: 'Озвучивает ответы в чате', voiceAll: 'Озвучивает всё, что говорит', voiceEngine: 'Движок', engines: { piper: 'Piper (лёгкий, на этом ПК, запускает она)', system: 'Системный голос (офлайн, бесплатно)', chatterbox: 'Chatterbox (на этом ПК, запускает она)', openai: 'OpenAI (ключ)', elevenlabs: 'ElevenLabs (ключ)', custom: 'Свой сервер, совместимый с OpenAI' }, voiceFx: 'Эффект «множества разумов»', voiceSetup: 'Ключ, адрес или голос…', voiceTest: 'Проверить голос', voiceKeyPage: 'Где взять ключ?',
    senses: 'Чувства', vision: 'Разрешить видеть мой экран', lookNow: 'Посмотри на экран', rhythm: 'Двигаться под мою музыку', ears: 'Слушать меня (микрофон)', converse: 'Режим разговора', pushToTalk: 'Чтобы говорить', visionSetup: 'Модель зрения…', earsSetup: 'Распознавание речи…', hands: 'Руки', handsOn: 'Разрешить управлять окнами', handsType: 'Разрешить писать сообщения', handsMouse: 'Разрешить двигать мышку и нажимать кнопки',
    online: (port) => `Capri — слушаю порт ${port}`,
    teleport: 'Телепортироваться', satellite: 'Посмотреть на спутник', demo: 'Запустить демо', help: 'Как это работает?', prepare: 'Подготовка (Ollama и Chatterbox)…', hub: 'Главное меню (нейросети и установка)…',
    report: 'Отчёт о миссиях', talk: 'Поговорить с ней', ring: 'Круговое меню', custom: 'Настроить её…', chatModel: 'ИИ-модель', aiSetup: 'Выбрать вместе с ней…', apiKey: 'API-ключ или адрес…', noOllama: 'Ollama не найдена',
    rest: 'Когда она отдыхает', restCorner: 'В своём углу', restTaskbar: 'Сидит на панели задач', watch: 'Что отслеживать', watchNone: 'Ничего, просто будь рядом',
    motion: 'Анимации', motionAuto: 'Как в Windows', motionFull: 'Все', motionReduced: 'Минимум',
    display: 'Отображение', displayAuto: 'Обычное', displayGl: 'OpenGL (если её фон чёрный)', displaySoftware: 'Без видеокарты (если всё ещё чёрный)',
    show: 'Вернуть её', hide: 'Спрятать',
    size: 'Размер', small: 'Маленькая', medium: 'Средняя', large: 'Большая', sound: 'Звук', mute: 'Без звука',
    soundsDir: 'Открыть папку своих звуков', screen: 'Экран', wander: 'Гулять, когда ничего не происходит',
    possess: 'Вселяться в мои окна', possessMove: 'Двигать окна, в которые вселилась', lang: 'Язык', auto: 'Автоматически (системный)', startup: 'Запускать вместе с Windows',
    hooksOn: 'Хуки Claude Code: установлены', hooksOff: 'Установить хуки Claude Code',
    hooksRemove: 'Удалить хуки Claude Code', forget: 'Забыть наши разговоры', quit: 'Выйти',
  },
};

// (the order of the Language submenu)
const LANGS = ['ru', 'en'];

module.exports = { TRAY, LANGS };
