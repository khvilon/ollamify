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
    const [ttsText, setTtsText] = useState('Привет! Это тест мультиязычного синтеза речи.');
    const [ttsVoice, setTtsVoice] = useState('');
    const [ttsLanguage, setTtsLanguage] = useState('ru');
    const [ttsSpeed, setTtsSpeed] = useState(1.0);
    const [ttsSampleRate, setTtsSampleRate] = useState(24000);
    const [isTtsSynthesizing, setIsTtsSynthesizing] = useState(false);
    const [ttsError, setTtsError] = useState(null);
    const [ttsResult, setTtsResult] = useState(null);
    const [voices, setVoices] = useState([]);
    const [isLoadingVoices, setIsLoadingVoices] = useState(true);
    
    // STT состояние
    const [isRecording, setIsRecording] = useState(false);
    const [sttResult, setSttResult] = useState('');
    const [sttError, setSttError] = useState(null);
    const [mediaRecorder, setMediaRecorder] = useState(null);
    const [sttModels, setSttModels] = useState({});
    const [selectedSttModel, setSelectedSttModel] = useState('');
    const [currentSttModel, setCurrentSttModel] = useState(''); // Текущая загруженная модель
    const [sttLanguage, setSttLanguage] = useState('ru');
    const [isLoadingSttModels, setIsLoadingSttModels] = useState(true);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isLoadingModel, setIsLoadingModel] = useState(false); // Загрузка модели
    
    // Клонирование голоса (заглушка для будущего)
    const [showVoiceCloning, setShowVoiceCloning] = useState(false);
    
    // Вкладки
    const [activeTab, setActiveTab] = useState(0);
    
    const audioRef = useRef(null);
    const theme = useTheme();

    const isSecureContext = useMemo(() => {
        try {
            return !!window.isSecureContext;
        } catch {
            return false;
        }
    }, []);

    const isMicrophoneSupported = useMemo(() => {
        return !!(navigator?.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
    }, []);

    // Функция для перевода gender на английский
    const translateGender = (gender) => {
        const translations = {
            'мужской': 'male',
            'женский': 'female',
            'male': 'male',
            'female': 'female'
        };
        return translations[gender] || gender;
    };

    // Функция для перевода характеристик STT моделей
    const translateModelInfo = (text) => {
        const translations = {
            'быстрый': 'fast',
            'средний': 'medium', 
            'медленный': 'slow',
            'низкое': 'low',
            'среднее': 'medium',
            'высокое': 'high',
            'очень высокое': 'very high'
        };
        return translations[text] || text;
    };

    // Фильтрация голосов по выбранному языку
    const filteredVoices = useMemo(() => {
        return voices.filter(voice => 
            voice.language === ttsLanguage || 
            voice.language === 'multi' || 
            !voice.language // fallback для голосов без указания языка
        );
    }, [voices, ttsLanguage]);

    // Автоматическое обновление голоса при смене языка
    useEffect(() => {
        if (isLoadingVoices) return;
        if (filteredVoices.length === 0) {
            if (ttsVoice !== '') setTtsVoice('');
            return;
        }
        if (!filteredVoices.find(v => v.name === ttsVoice)) {
            setTtsVoice(filteredVoices[0].name);
        }
    }, [filteredVoices, ttsVoice, isLoadingVoices]);

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

                // Prefer "aidar" when available, otherwise pick the first voice.
                const voiceNames = Array.isArray(voicesData) ? voicesData.map(v => v?.name).filter(Boolean) : [];
                if (!voiceNames.includes(ttsVoice)) {
                    const preferred = voiceNames.includes('aidar') ? 'aidar' : (voiceNames[0] || '');
                    setTtsVoice(preferred);
                }
            } catch (err) {
                console.error('Error fetching voices:', err);
                setTtsError('Failed to load voice list');
            } finally {
                setIsLoadingVoices(false);
            }
        };

        fetchVoices();
    }, []);

    // Загрузка STT моделей при монтировании
    useEffect(() => {
        const fetchSttModels = async () => {
            try {
                const response = await window.api.fetch('/api/stt/models');
                if (!response.ok) {
                    throw new Error('Failed to fetch STT models');
                }
                const modelsData = await response.json();
                const models = modelsData?.models || {};
                setSttModels(models);

                const available = Object.keys(models);
                const current = modelsData?.current_model || available[0] || '';
                setCurrentSttModel(current);
                setSelectedSttModel(current);
            } catch (err) {
                console.error('Error fetching STT models:', err);
                setSttError('Failed to load STT models');
            } finally {
                setIsLoadingSttModels(false);
            }
        };

        fetchSttModels();
    }, []);

    // Получение статуса STT сервиса
    const fetchSttStatus = async () => {
        try {
            const response = await window.api.fetch('/api/stt/health');
            if (response.ok) {
                const statusData = await response.json();
                setCurrentSttModel(statusData.model_name || 'base');
            }
        } catch (err) {
            console.warn('Could not fetch STT status:', err);
        }
    };

    // Загрузка новой модели STT
    const handleLoadSttModel = async (modelName) => {
        if (modelName === currentSttModel || isLoadingModel) return;

        setIsLoadingModel(true);
        setSttError(null);

        try {
            const response = await window.api.fetch('/api/stt/model/load', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ model_name: modelName })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Model loading error');
            }

            const result = await response.json();
            setCurrentSttModel(modelName);
            window.enqueueSnackbar(`Model ${modelName} loaded successfully!`, { variant: 'success' });

        } catch (err) {
            console.error('STT Model loading error:', err);
            setSttError(`Model loading error: ${err.message}`);
            window.enqueueSnackbar(`Model loading error: ${err.message}`, { variant: 'error' });
            setSelectedSttModel(currentSttModel); // Возвращаем выбор к текущей модели
        } finally {
            setIsLoadingModel(false);
        }
    };

    // Обработчик смены модели STT
    const handleSttModelChange = (e) => {
        const newModel = e.target.value;
        if (!newModel) return;
        setSelectedSttModel(newModel);
        handleLoadSttModel(newModel);
    };

    // Языки для TTS берём из доступных голосов сервиса, чтобы UI всегда совпадал с backend.
    const ttsLanguages = useMemo(() => {
        const languageLabels = {
            ru: 'Russian',
            en: 'English',
            he: 'Hebrew'
        };

        const detected = Array.from(
            new Set((voices || []).map(v => v?.language).filter(Boolean))
        );

        if (detected.length === 0) {
            return [
                { code: 'ru', name: 'Russian' },
                { code: 'en', name: 'English' },
                { code: 'he', name: 'Hebrew' }
            ];
        }

        return detected.map(code => ({
            code,
            name: languageLabels[code] || code.toUpperCase()
        }));
    }, [voices]);

    // Языки для STT (Whisper поддерживает много языков)
    const sttLanguages = [
        { code: 'ru', name: 'Russian' },
        { code: 'en', name: 'English' },
        { code: 'es', name: 'Spanish' },
        { code: 'fr', name: 'French' },
        { code: 'de', name: 'German' },
        { code: 'it', name: 'Italian' },
        { code: 'pt', name: 'Portuguese' },
        { code: 'pl', name: 'Polish' },
        { code: 'tr', name: 'Turkish' },
        { code: 'nl', name: 'Dutch' },
        { code: 'cs', name: 'Czech' },
        { code: 'ar', name: 'Arabic' },
        { code: 'he', name: 'Hebrew' },
        { code: 'zh', name: 'Chinese' },
        { code: 'ja', name: 'Japanese' },
        { code: 'ko', name: 'Korean' }
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
                    format: 'mp3'
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Speech synthesis error');
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            
            const mimeType = audioBlob.type || response.headers.get('Content-Type') || 'audio/mpeg';
            const fileExtension = mimeType.includes('wav') ? 'wav' : 'mp3';

            setTtsResult({
                url: audioUrl,
                blob: audioBlob,
                size: audioBlob.size,
                mimeType,
                fileExtension
            });

            // Автоматически воспроизводим
            if (audioRef.current) {
                audioRef.current.src = audioUrl;
                audioRef.current.play();
            }

            window.enqueueSnackbar('Speech synthesis completed successfully!', { variant: 'success' });

        } catch (err) {
            console.error('TTS Error:', err);
            setTtsError(err.message);
            window.enqueueSnackbar(`Speech synthesis error: ${err.message}`, { variant: 'error' });
        } finally {
            setIsTtsSynthesizing(false);
        }
    }, [ttsText, ttsVoice, ttsLanguage, ttsSpeed, ttsSampleRate]);

    // Скачивание аудио
    const handleDownloadAudio = () => {
        if (ttsResult && ttsResult.blob) {
            const a = document.createElement('a');
            a.href = ttsResult.url;
            const extension = ttsResult.fileExtension || 'mp3';
            a.download = `speech_${ttsVoice || 'auto'}_${Date.now()}.${extension}`;
            a.click();
        }
    };

    // STT функции
    const handleStartRecording = async () => {
        try {
            setSttError(null);
            setSttResult('');

            // Browser support / secure context checks
            if (!navigator?.mediaDevices?.getUserMedia) {
                if (!isSecureContext) {
                    setSttError('Микрофон недоступен в HTTP. Откройте страницу через HTTPS (или localhost).');
                } else {
                    setSttError('Ваш браузер не поддерживает доступ к микрофону (navigator.mediaDevices.getUserMedia недоступен).');
                }
                return;
            }
            if (typeof MediaRecorder === 'undefined') {
                setSttError('Ваш браузер не поддерживает запись аудио (MediaRecorder недоступен).');
                return;
            }
            
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            const chunks = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            recorder.onstop = async () => {
                const audioBlob = new Blob(chunks, { type: 'audio/wav' });
                await transcribeAudio(audioBlob);
                
                // Останавливаем поток
                stream.getTracks().forEach(track => track.stop());
            };

            recorder.start();
            setMediaRecorder(recorder);
            setIsRecording(true);
            
        } catch (err) {
            console.error('Error starting recording:', err);
            const name = err?.name || '';
            if (name === 'NotAllowedError' || name === 'SecurityError') {
                setSttError('Доступ к микрофону запрещён. Разрешите микрофон в настройках браузера и обновите страницу.');
            } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
                setSttError('Микрофон не найден. Проверьте, что устройство подключено и доступно системе.');
            } else {
                setSttError('Не удалось получить доступ к микрофону.');
            }
        }
    };

    const handleStopRecording = () => {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            setIsRecording(false);
            setMediaRecorder(null);
        }
    };

    const transcribeAudio = async (audioBlob) => {
        try {
            setIsTranscribing(true);
            
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.wav');
            formData.append('language', sttLanguage);
            formData.append('task', 'transcribe');

            const response = await window.api.fetch('/api/stt/transcribe', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Transcription error');
            }

            const result = await response.json();
            setSttResult(result.text);
            
            window.enqueueSnackbar('Speech recognition completed!', { variant: 'success' });

        } catch (err) {
            console.error('STT Error:', err);
            setSttError(err.message);
            window.enqueueSnackbar(`Recognition error: ${err.message}`, { variant: 'error' });
        } finally {
            setIsTranscribing(false);
        }
    };

    // Заглушка для клонирования голоса
    const handleVoiceCloning = () => {
        setShowVoiceCloning(true);
    };

    // Быстрые фразы для тестирования
    const quickPhrasesByLanguage = {
        ru: [
            'Привет! Как дела?',
            'Это тест системы синтеза речи в реальном времени.',
            'Проверяем скорость и качество озвучки.',
            'Съешь ещё этих мягких французских булок, да выпей чаю.'
        ],
        en: [
            'Hello! How are you?',
            'This is a real-time multilingual speech synthesis test.',
            'Let us check quality and latency.',
            'The quick brown fox jumps over the lazy dog.'
        ],
        he: [
            'שלום, מה שלומך?',
            'זה מבחן של סינתזת דיבור רב-לשונית.',
            'בוא נבדוק את המהירות והאיכות.',
            'אני רוצה לבדוק דיבור בעברית.'
        ]
    };
    const quickPhrases = quickPhrasesByLanguage[ttsLanguage] || quickPhrasesByLanguage.ru;

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            {/* Заголовок */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" component="h1" sx={{
                    fontWeight: 600,
                    background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                }}>
                    Voice
                </Typography>
                <Typography variant="subtitle1" color="text.secondary">
                    Text-to-Speech (Realtime TTS) • Speech Recognition (Whisper)
                </Typography>
            </Box>

            {/* Вкладки */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
                    <Tab icon={<Icon>speaker</Icon>} label="Text-to-Speech (TTS)" />
                    <Tab icon={<Icon>mic</Icon>} label="Speech Recognition (STT)" />
                    {/* Временно скрыта вкладка клонирования */}
                    {/* <Tab icon={<Icon>content_copy</Icon>} label="Voice Cloning" /> */}
                </Tabs>
            </Box>

            {/* Вкладка TTS */}
            {activeTab === 0 && (
                <Grid container spacing={3}>
                    {/* Настройки TTS */}
                    <Grid item xs={12} md={4}>
                        <Card sx={{
                            borderRadius: 2,
                            background: theme => theme.palette.mode === 'light' 
                                ? 'rgba(255, 255, 255, 0.7)'
                                : 'rgba(50, 50, 50, 0.7)',
                            backdropFilter: 'blur(10px)',
                            boxShadow: theme => theme.palette.mode === 'light'
                                ? '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                : '0 6px 20px 0 rgba(8, 8, 15, 0.35)'
                        }}>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>
                                    <Icon sx={{ mr: 1, verticalAlign: 'middle' }}>settings</Icon>
                                    Settings
                                </Typography>

                                {/* Выбор голоса */}
                                <FormControl fullWidth sx={{ mb: 2 }}>
                                    <InputLabel>Voice</InputLabel>
                                    <Select
                                        value={ttsVoice}
                                        label="Voice"
                                        onChange={(e) => setTtsVoice(e.target.value)}
                                        disabled={isLoadingVoices || filteredVoices.length === 0}
                                        displayEmpty
                                    >
                                        <MenuItem value="">
                                            <em>{isLoadingVoices ? 'Loading...' : 'Select voice'}</em>
                                        </MenuItem>
                                        {filteredVoices.map((voice) => (
                                            <MenuItem key={voice.name} value={voice.name}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Icon>{translateGender(voice.gender) === 'female' ? 'face_3' : 'face'}</Icon>
                                                    <Box>
                                                        <Typography variant="body2">
                                                            {voice.description}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {voice.name} • {translateGender(voice.gender)}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                            </MenuItem>
                                        ))}
                                    </Select>
                                    {filteredVoices.length === 0 && !isLoadingVoices && (
                                        <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                                            No voices available for selected language
                                        </Typography>
                                    )}
                                    {filteredVoices.length > 0 && (
                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                                            {filteredVoices.length} voice{filteredVoices.length > 1 ? 's' : ''} available
                                        </Typography>
                                    )}
                                </FormControl>

                                {/* Выбор языка */}
                                <FormControl fullWidth sx={{ mb: 2 }}>
                                    <InputLabel>Language</InputLabel>
                                    <Select
                                        value={ttsLanguage}
                                        label="Language"
                                        onChange={(e) => setTtsLanguage(e.target.value)}
                                    >
                                        {ttsLanguages.map((lang) => (
                                            <MenuItem key={lang.code} value={lang.code}>
                                                {lang.name}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                {/* Скорость речи */}
                                <Typography gutterBottom>
                                    Speed: {ttsSpeed}x
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
                                    <InputLabel>Quality</InputLabel>
                                    <Select
                                        value={ttsSampleRate}
                                        label="Quality"
                                        onChange={(e) => setTtsSampleRate(e.target.value)}
                                    >
                                        <MenuItem value={8000}>8 kHz (low)</MenuItem>
                                        <MenuItem value={24000}>24 kHz (standard)</MenuItem>
                                        <MenuItem value={48000}>48 kHz (high)</MenuItem>
                                    </Select>
                                </FormControl>

                                {/* Быстрые фразы */}
                                <Typography variant="body2" gutterBottom sx={{ mt: 2 }}>
                                    Quick phrases:
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
                        <Card sx={{
                            borderRadius: 2,
                            background: theme => theme.palette.mode === 'light' 
                                ? 'rgba(255, 255, 255, 0.7)'
                                : 'rgba(50, 50, 50, 0.7)',
                            backdropFilter: 'blur(10px)',
                            boxShadow: theme => theme.palette.mode === 'light'
                                ? '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                : '0 6px 20px 0 rgba(8, 8, 15, 0.35)'
                        }}>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>
                                    <Icon sx={{ mr: 1, verticalAlign: 'middle' }}>edit</Icon>
                                    Text to Synthesize
                                </Typography>

                                <TextField
                                    fullWidth
                                    multiline
                                    rows={6}
                                    value={ttsText}
                                    onChange={(e) => setTtsText(e.target.value)}
                                    placeholder="Enter text for speech synthesis..."
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
                                        {isTtsSynthesizing ? 'Synthesizing...' : 'Synthesize'}
                                    </Button>
                                    
                                    {ttsResult && (
                                        <Button
                                            variant="outlined"
                                            onClick={handleDownloadAudio}
                                            startIcon={<Icon>download</Icon>}
                                        >
                                            Download
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
                                                    Synthesis completed! Size: {Math.round(ttsResult.size / 1024)} KB
                                                </Typography>
                                                <audio ref={audioRef} controls style={{ width: '100%' }}>
                                                    <source src={ttsResult.url} type={ttsResult.mimeType || 'audio/mpeg'} />
                                                    Your browser does not support the audio element.
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
                <Grid container spacing={3}>
                    {/* Настройки STT */}
                    <Grid item xs={12} md={4}>
                        <Card sx={{
                            borderRadius: 2,
                            background: theme => theme.palette.mode === 'light' 
                                ? 'rgba(255, 255, 255, 0.7)'
                                : 'rgba(50, 50, 50, 0.7)',
                            backdropFilter: 'blur(10px)',
                            boxShadow: theme => theme.palette.mode === 'light'
                                ? '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                : '0 6px 20px 0 rgba(8, 8, 15, 0.35)'
                        }}>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>
                                    <Icon sx={{ mr: 1, verticalAlign: 'middle' }}>settings</Icon>
                                    Settings
                                </Typography>

                                {/* Выбор модели */}
                                <FormControl fullWidth sx={{ mb: 2 }}>
                                    <InputLabel>Whisper Model</InputLabel>
                                    <Select
                                        value={selectedSttModel}
                                        label="Whisper Model"
                                        onChange={handleSttModelChange}
                                        disabled={isLoadingSttModels || isLoadingModel || Object.keys(sttModels).length === 0}
                                        displayEmpty
                                        endAdornment={isLoadingModel && (
                                            <InputAdornment position="end">
                                                <CircularProgress size={20} />
                                            </InputAdornment>
                                        )}
                                    >
                                        <MenuItem value="">
                                            <em>{isLoadingSttModels ? 'Loading...' : 'Select model'}</em>
                                        </MenuItem>
                                        {Object.entries(sttModels).map(([model, info]) => (
                                            <MenuItem key={model} value={model}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                                    <Box sx={{ flexGrow: 1 }}>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                                            <Typography variant="body2" component="span">
                                                                {model} ({info.size})
                                                            </Typography>
                                                            {model === currentSttModel && (
                                                                <Chip
                                                                    label="Loaded"
                                                                    size="small"
                                                                    color="success"
                                                                />
                                                            )}
                                                        </Box>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {translateModelInfo(info.speed)} • {translateModelInfo(info.quality)}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                {/* Статус модели */}
                                {isLoadingModel && (
                                    <Box sx={{ mb: 2 }}>
                                        <Typography variant="body2" color="primary" gutterBottom>
                                            Loading model {selectedSttModel}...
                                        </Typography>
                                        <LinearProgress />
                                    </Box>
                                )}

                                {/* Информация о текущей модели */}
                                {!isLoadingModel && currentSttModel && (
                                    <Box sx={{ mb: 2, p: 1, bgcolor: 'success.light', borderRadius: 1 }}>
                                        <Typography variant="body2" color="success.dark">
                                            <Icon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }}>check_circle</Icon>
                                            Active model: {currentSttModel}
                                            {sttModels[currentSttModel] && ` (${sttModels[currentSttModel].size})`}
                                        </Typography>
                                    </Box>
                                )}

                                {/* Выбор языка */}
                                <FormControl fullWidth sx={{ mb: 2 }}>
                                    <InputLabel>Language</InputLabel>
                                    <Select
                                        value={sttLanguage}
                                        label="Language"
                                        onChange={(e) => setSttLanguage(e.target.value)}
                                    >
                                        {sttLanguages.map((lang) => (
                                            <MenuItem key={lang.code} value={lang.code}>
                                                {lang.name}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                                    💡 Tip: Click the record button, speak clearly, and stop recording for transcription.
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Запись и результат */}
                    <Grid item xs={12} md={8}>
                        <Card sx={{
                            borderRadius: 2,
                            background: theme => theme.palette.mode === 'light' 
                                ? 'rgba(255, 255, 255, 0.7)'
                                : 'rgba(50, 50, 50, 0.7)',
                            backdropFilter: 'blur(10px)',
                            boxShadow: theme => theme.palette.mode === 'light'
                                ? '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                : '0 6px 20px 0 rgba(8, 8, 15, 0.35)'
                        }}>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>
                                    <Icon sx={{ mr: 1, verticalAlign: 'middle' }}>mic</Icon>
                                    Speech Recognition
                                </Typography>

                                {/* Кнопка записи */}
                                <Box sx={{ textAlign: 'center', mb: 3 }}>
                                    <IconButton
                                        onClick={isRecording ? handleStopRecording : handleStartRecording}
                                        disabled={isTranscribing || !isMicrophoneSupported}
                                        sx={{
                                            width: 80,
                                            height: 80,
                                            bgcolor: isRecording ? 'error.main' : 'primary.main',
                                            color: 'white',
                                            '&:hover': {
                                                bgcolor: isRecording ? 'error.dark' : 'primary.dark',
                                                transform: 'scale(1.05)'
                                            },
                                            '&:disabled': {
                                                bgcolor: 'grey.400'
                                            },
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <Icon sx={{ fontSize: 40 }}>
                                            {isTranscribing ? 'hourglass_empty' : isRecording ? 'stop' : 'mic'}
                                        </Icon>
                                    </IconButton>
                                    <Typography variant="body2" sx={{ mt: 1 }}>
                                        {isTranscribing ? 'Processing...' : isRecording ? 'Click to stop' : 'Click to record'}
                                    </Typography>
                                    {!isMicrophoneSupported && (
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                            Mic is available only in a secure context (HTTPS / localhost) and supported browsers.
                                        </Typography>
                                    )}
                                </Box>

                                {/* Прогресс */}
                                {isTranscribing && (
                                    <LinearProgress sx={{ mb: 2 }} />
                                )}

                                {/* Ошибка */}
                                {sttError && (
                                    <Alert severity="error" sx={{ mb: 2 }}>
                                        {sttError}
                                    </Alert>
                                )}

                                {/* Результат */}
                                <TextField
                                    fullWidth
                                    multiline
                                    rows={6}
                                    value={sttResult}
                                    onChange={(e) => setSttResult(e.target.value)}
                                    placeholder="Speech recognition result will appear here..."
                                    sx={{ mb: 2 }}
                                    InputProps={{
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <Typography variant="caption" color="text.secondary">
                                                    {sttResult.length} characters
                                                </Typography>
                                            </InputAdornment>
                                        )
                                    }}
                                />

                                {/* Кнопки действий */}
                                {sttResult && (
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        <Button
                                            variant="outlined"
                                            onClick={() => navigator.clipboard.writeText(sttResult)}
                                            startIcon={<Icon>copy</Icon>}
                                        >
                                            Copy
                                        </Button>
                                        <Button
                                            variant="outlined"
                                            onClick={() => setSttResult('')}
                                            startIcon={<Icon>clear</Icon>}
                                        >
                                            Clear
                                        </Button>
                                        <Button
                                            variant="contained"
                                            onClick={() => setTtsText(sttResult)}
                                            startIcon={<Icon>speaker</Icon>}
                                        >
                                            Synthesize
                                        </Button>
                                    </Box>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            )}

            {/* Диалог клонирования голоса (заглушка) */}
            <Dialog open={showVoiceCloning} onClose={() => setShowVoiceCloning(false)}>
                <DialogTitle>Voice Cloning</DialogTitle>
                <DialogContent>
                    <Typography variant="body2">
                        This feature will be added in the next version.
                        You will be able to upload audio samples and create unique voices.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowVoiceCloning(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}

// Export component
window.Voice = Voice; 