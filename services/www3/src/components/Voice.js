// Get dependencies from global scope
const {
    Container,
    Box,
    Typography,
    TextField,
    IconButton,
    CircularProgress,
    Card,
    CardContent,
    Divider,
    Icon,
    useTheme,
    alpha,
    Paper,
    Alert,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Switch,
    FormControlLabel,
    Button,
    Slider,
    Grid,
    Tab,
    Tabs,
    InputAdornment,
    Chip,
    LinearProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions
} = window.MaterialUI;

const {
    useState,
    useCallback,
    useRef,
    useEffect,
    useMemo
} = window.React;

function Voice() {
    // TTS состояние
    const [ttsText, setTtsText] = useState('Привет! Это тест системы синтеза речи на базе Coqui XTTS версии два. Коммерческая лицензия Apache 2.0 позволяет использовать эту технологию в любых целях.');
    const [ttsVoice, setTtsVoice] = useState('female_1');
    const [ttsLanguage, setTtsLanguage] = useState('ru');
    const [ttsSpeed, setTtsSpeed] = useState(1.0);
    const [ttsSampleRate, setTtsSampleRate] = useState(24000);
    const [isTtsSynthesizing, setIsTtsSynthesizing] = useState(false);
    const [ttsError, setTtsError] = useState(null);
    const [ttsResult, setTtsResult] = useState(null);
    const [voices, setVoices] = useState([]);
    const [isLoadingVoices, setIsLoadingVoices] = useState(true);
    
    // STT состояние (заглушка для будущего)
    const [isRecording, setIsRecording] = useState(false);
    const [sttResult, setSttResult] = useState('');
    const [sttError, setSttError] = useState(null);
    
    // Клонирование голоса (заглушка для будущего)
    const [showVoiceCloning, setShowVoiceCloning] = useState(false);
    
    // Вкладки
    const [activeTab, setActiveTab] = useState(0);
    
    const audioRef = useRef(null);
    const theme = useTheme();

    // Загрузка списка голосов при монтировании
    useEffect(() => {
        const fetchVoices = async () => {
            try {
                const response = await window.api.fetch('/api/tts/voices');
                if (!response.ok) {
                    throw new Error('Failed to fetch voices');
                }
                const voicesData = await response.json();
                setVoices(voicesData);
            } catch (err) {
                console.error('Error fetching voices:', err);
                setTtsError('Не удалось загрузить список голосов');
            } finally {
                setIsLoadingVoices(false);
            }
        };

        fetchVoices();
    }, []);

    // Доступные языки
    const languages = [
        { code: 'ru', name: 'Русский' },
        { code: 'en', name: 'English' },
        { code: 'es', name: 'Español' },
        { code: 'fr', name: 'Français' },
        { code: 'de', name: 'Deutsch' },
        { code: 'it', name: 'Italiano' },
        { code: 'pt', name: 'Português' },
        { code: 'pl', name: 'Polski' },
        { code: 'tr', name: 'Türkçe' },
        { code: 'nl', name: 'Nederlands' },
        { code: 'cs', name: 'Čeština' },
        { code: 'ar', name: 'العربية' },
        { code: 'zh', name: '中文' },
        { code: 'ja', name: '日本語' },
        { code: 'hu', name: 'Magyar' },
        { code: 'ko', name: '한국어' }
    ];

    // Обработка синтеза речи
    const handleTtsSynthesize = useCallback(async () => {
        if (!ttsText.trim() || isTtsSynthesizing) return;

        setIsTtsSynthesizing(true);
        setTtsError(null);
        setTtsResult(null);

        try {
            const response = await window.api.fetch('/api/tts/synthesize/stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: ttsText,
                    voice: ttsVoice,
                    language: ttsLanguage,
                    speed: ttsSpeed,
                    sample_rate: ttsSampleRate,
                    format: 'wav'
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Ошибка синтеза речи');
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            
            setTtsResult({
                url: audioUrl,
                blob: audioBlob,
                size: audioBlob.size
            });

            // Автоматически воспроизводим
            if (audioRef.current) {
                audioRef.current.src = audioUrl;
                audioRef.current.play();
            }

            window.enqueueSnackbar('Синтез речи завершен успешно!', { variant: 'success' });

        } catch (err) {
            console.error('TTS Error:', err);
            setTtsError(err.message);
            window.enqueueSnackbar(`Ошибка синтеза речи: ${err.message}`, { variant: 'error' });
        } finally {
            setIsTtsSynthesizing(false);
        }
    }, [ttsText, ttsVoice, ttsLanguage, ttsSpeed, ttsSampleRate]);

    // Скачивание аудио
    const handleDownloadAudio = () => {
        if (ttsResult && ttsResult.blob) {
            const a = document.createElement('a');
            a.href = ttsResult.url;
            a.download = `speech_${ttsVoice}_${Date.now()}.wav`;
            a.click();
        }
    };

    // Заглушки для STT
    const handleStartRecording = () => {
        setSttError('Функция распознавания речи будет добавлена в следующей версии');
    };

    const handleStopRecording = () => {
        setIsRecording(false);
    };

    // Заглушка для клонирования голоса
    const handleVoiceCloning = () => {
        setShowVoiceCloning(true);
    };

    // Быстрые фразы для тестирования
    const quickPhrases = [
        'Привет! Как дела?',
        'Это тест системы синтеза речи.',
        'Коммерческая лицензия Apache 2.0.',
        'Hello! How are you doing today?',
        'This is a text-to-speech test.',
        'Bonjour! Comment allez-vous?',
        'Hola! ¿Cómo estás?'
    ];

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            {/* Заголовок */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" gutterBottom sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 2,
                    background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                }}>
                    <Icon>record_voice_over</Icon>
                    Voice Assistant
                </Typography>
                <Typography variant="subtitle1" color="text.secondary">
                    Тестирование синтеза речи (TTS) и распознавания речи (STT) • Coqui XTTS v2 • Apache 2.0
                </Typography>
            </Box>

            {/* Вкладки */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
                    <Tab icon={<Icon>speaker</Icon>} label="Синтез речи (TTS)" />
                    <Tab icon={<Icon>mic</Icon>} label="Распознавание (STT)" />
                    <Tab icon={<Icon>content_copy</Icon>} label="Клонирование голоса" />
                </Tabs>
            </Box>

            {/* Вкладка TTS */}
            {activeTab === 0 && (
                <Grid container spacing={3}>
                    {/* Настройки TTS */}
                    <Grid item xs={12} md={4}>
                        <Card>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>
                                    <Icon sx={{ mr: 1, verticalAlign: 'middle' }}>settings</Icon>
                                    Настройки
                                </Typography>

                                {/* Выбор голоса */}
                                <FormControl fullWidth sx={{ mb: 2 }}>
                                    <InputLabel>Голос</InputLabel>
                                    <Select
                                        value={ttsVoice}
                                        label="Голос"
                                        onChange={(e) => setTtsVoice(e.target.value)}
                                        disabled={isLoadingVoices}
                                    >
                                        {voices.map((voice) => (
                                            <MenuItem key={voice.name} value={voice.name}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Icon>{voice.gender === 'female' ? 'face_3' : 'face'}</Icon>
                                                    <Box>
                                                        <Typography variant="body2">
                                                            {voice.description}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {voice.name} • {voice.gender}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                {/* Выбор языка */}
                                <FormControl fullWidth sx={{ mb: 2 }}>
                                    <InputLabel>Язык</InputLabel>
                                    <Select
                                        value={ttsLanguage}
                                        label="Язык"
                                        onChange={(e) => setTtsLanguage(e.target.value)}
                                    >
                                        {languages.map((lang) => (
                                            <MenuItem key={lang.code} value={lang.code}>
                                                {lang.name}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                {/* Скорость речи */}
                                <Typography gutterBottom>
                                    Скорость: {ttsSpeed}x
                                </Typography>
                                <Slider
                                    value={ttsSpeed}
                                    onChange={(e, newValue) => setTtsSpeed(newValue)}
                                    min={0.5}
                                    max={2.0}
                                    step={0.1}
                                    sx={{ mb: 2 }}
                                />

                                {/* Частота дискретизации */}
                                <FormControl fullWidth sx={{ mb: 2 }}>
                                    <InputLabel>Качество</InputLabel>
                                    <Select
                                        value={ttsSampleRate}
                                        label="Качество"
                                        onChange={(e) => setTtsSampleRate(e.target.value)}
                                    >
                                        <MenuItem value={22050}>22 kHz (стандарт)</MenuItem>
                                        <MenuItem value={24000}>24 kHz (высокое)</MenuItem>
                                    </Select>
                                </FormControl>

                                {/* Быстрые фразы */}
                                <Typography variant="body2" gutterBottom sx={{ mt: 2 }}>
                                    Быстрые фразы:
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {quickPhrases.map((phrase, index) => (
                                        <Chip
                                            key={index}
                                            label={phrase.length > 20 ? phrase.substring(0, 20) + '...' : phrase}
                                            onClick={() => setTtsText(phrase)}
                                            size="small"
                                            variant="outlined"
                                            sx={{ fontSize: '0.7rem' }}
                                        />
                                    ))}
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Ввод текста и результат */}
                    <Grid item xs={12} md={8}>
                        <Card>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>
                                    <Icon sx={{ mr: 1, verticalAlign: 'middle' }}>edit</Icon>
                                    Текст для озвучивания
                                </Typography>

                                <TextField
                                    fullWidth
                                    multiline
                                    rows={6}
                                    value={ttsText}
                                    onChange={(e) => setTtsText(e.target.value)}
                                    placeholder="Введите текст для синтеза речи..."
                                    disabled={isTtsSynthesizing}
                                    sx={{ mb: 2 }}
                                    InputProps={{
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <Typography variant="caption" color="text.secondary">
                                                    {ttsText.length}/1000
                                                </Typography>
                                            </InputAdornment>
                                        )
                                    }}
                                />

                                {/* Кнопки действий */}
                                <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                                    <Button
                                        variant="contained"
                                        onClick={handleTtsSynthesize}
                                        disabled={!ttsText.trim() || isTtsSynthesizing}
                                        startIcon={isTtsSynthesizing ? <CircularProgress size={20} /> : <Icon>speaker</Icon>}
                                        sx={{ flex: 1 }}
                                    >
                                        {isTtsSynthesizing ? 'Синтезирую...' : 'Озвучить'}
                                    </Button>
                                    
                                    {ttsResult && (
                                        <Button
                                            variant="outlined"
                                            onClick={handleDownloadAudio}
                                            startIcon={<Icon>download</Icon>}
                                        >
                                            Скачать
                                        </Button>
                                    )}
                                </Box>

                                {/* Прогресс */}
                                {isTtsSynthesizing && (
                                    <LinearProgress sx={{ mb: 2 }} />
                                )}

                                {/* Ошибка */}
                                {ttsError && (
                                    <Alert severity="error" sx={{ mb: 2 }}>
                                        {ttsError}
                                    </Alert>
                                )}

                                {/* Аудио плеер */}
                                {ttsResult && (
                                    <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.success.main, 0.1) }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                            <Icon color="success">check_circle</Icon>
                                            <Box sx={{ flex: 1 }}>
                                                <Typography variant="body2" gutterBottom>
                                                    Синтез завершен! Размер: {Math.round(ttsResult.size / 1024)} KB
                                                </Typography>
                                                <audio ref={audioRef} controls style={{ width: '100%' }}>
                                                    <source src={ttsResult.url} type="audio/wav" />
                                                    Ваш браузер не поддерживает аудио элемент.
                                                </audio>
                                            </Box>
                                        </Box>
                                    </Paper>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            )}

            {/* Вкладка STT */}
            {activeTab === 1 && (
                <Card>
                    <CardContent sx={{ textAlign: 'center', py: 6 }}>
                        <Icon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }}>mic_off</Icon>
                        <Typography variant="h6" gutterBottom>
                            Распознавание речи (STT)
                        </Typography>
                        <Typography variant="body2" color="text.secondary" paragraph>
                            Функция распознавания речи будет добавлена в следующей версии.
                            Планируется интеграция с Whisper, Vosk или GigaAM2.
                        </Typography>
                        <Button
                            variant="outlined"
                            startIcon={<Icon>mic</Icon>}
                            onClick={handleStartRecording}
                            disabled
                        >
                            Начать запись (скоро)
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Вкладка клонирования голоса */}
            {activeTab === 2 && (
                <Card>
                    <CardContent sx={{ textAlign: 'center', py: 6 }}>
                        <Icon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }}>content_copy</Icon>
                        <Typography variant="h6" gutterBottom>
                            Клонирование голоса
                        </Typography>
                        <Typography variant="body2" color="text.secondary" paragraph>
                            Функция клонирования голоса позволит создавать уникальные голоса
                            из 3-15 секундных образцов речи с помощью XTTS v2.
                        </Typography>
                        <Button
                            variant="outlined"
                            startIcon={<Icon>upload_file</Icon>}
                            onClick={handleVoiceCloning}
                            disabled
                        >
                            Загрузить образец (скоро)
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Диалог клонирования голоса (заглушка) */}
            <Dialog open={showVoiceCloning} onClose={() => setShowVoiceCloning(false)}>
                <DialogTitle>Клонирование голоса</DialogTitle>
                <DialogContent>
                    <Typography variant="body2">
                        Эта функция будет добавлена в следующей версии.
                        Вы сможете загружать аудио образцы и создавать уникальные голоса.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowVoiceCloning(false)}>Закрыть</Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}

// Export component
window.Voice = Voice; 