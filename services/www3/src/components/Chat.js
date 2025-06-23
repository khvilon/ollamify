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
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Collapse,
    Chip,
    Button
} = window.MaterialUI;

const {
    useState,
    useCallback,
    useRef,
    useEffect,
    useMemo
} = window.React;

const ReactMarkdown = window.ReactMarkdown.default;

// Компонент для отображения секции размышлений
function ThinkingSection({ thinking }) {
    const [expanded, setExpanded] = useState(false);
    const theme = useTheme();

    if (!thinking) return null;

    return (
        <Box sx={{ mt: 1 }}>
            <Accordion 
                expanded={expanded} 
                onChange={() => setExpanded(!expanded)}
                sx={{
                    bgcolor: alpha(theme.palette.info.main, 0.1),
                    border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
                    borderRadius: 1,
                    boxShadow: 'none',
                    '&:before': { display: 'none' },
                    '& .MuiAccordionSummary-root': {
                        minHeight: 40,
                        py: 0.5,
                        '& .MuiAccordionSummary-content': {
                            margin: '8px 0',
                        }
                    }
                }}
            >
                <AccordionSummary>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Icon sx={{ fontSize: 16, color: 'info.main' }}>psychology</Icon>
                        <Typography variant="caption" sx={{ color: 'info.main', fontWeight: 500 }}>
                            {expanded ? 'Скрыть размышления' : 'Показать размышления модели'}
                        </Typography>
                    </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 1 }}>
                    <Typography 
                        variant="body2" 
                        sx={{ 
                            color: 'text.secondary',
                            fontStyle: 'italic',
                            bgcolor: alpha(theme.palette.background.paper, 0.5),
                            p: 1.5,
                            borderRadius: 1,
                            border: `1px dashed ${alpha(theme.palette.info.main, 0.3)}`,
                            whiteSpace: 'pre-wrap'
                        }}
                    >
                        {thinking}
                    </Typography>
                </AccordionDetails>
            </Accordion>
        </Box>
    );
}

// Компонент для отображения релевантных документов
function RelevantDocumentsSection({ documents }) {
    const [expanded, setExpanded] = useState(false);
    const [expandedDocs, setExpandedDocs] = useState({}); // Состояние для развернутых документов
    const theme = useTheme();

    if (!documents || documents.length === 0) return null;

    // Функция для очистки содержимого от thinking тегов
    const cleanContent = (content) => {
        if (!content) return '';
        // Удаляем секции размышлений из содержимого документов
        const thinkingRegex = /<(?:think|thinking|анализ|размышление)[^>]*>([\s\S]*?)<\/(?:think|thinking|анализ|размышление)>/gi;
        return content.replace(thinkingRegex, '').trim();
    };

    // Функция для сокращения текста содержимого
    const truncateContent = (content, maxLength = 150) => {
        if (!content) return '';
        const cleanedContent = cleanContent(content);
        if (cleanedContent.length <= maxLength) return cleanedContent;
        return cleanedContent.substring(0, maxLength) + '...';
    };

    // Функция для переключения развернутого состояния документа
    const toggleDocExpanded = (index) => {
        setExpandedDocs(prev => ({
            ...prev,
            [index]: !prev[index]
        }));
    };

    // Функция для форматирования similarity score
    const formatSimilarity = (score) => {
        return (score * 100).toFixed(1) + '%';
    };

    return (
        <Box sx={{ mt: 1 }}>
            <Accordion 
                expanded={expanded} 
                onChange={() => setExpanded(!expanded)}
                sx={{
                    bgcolor: alpha(theme.palette.success.main, 0.1),
                    border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
                    borderRadius: 1,
                    boxShadow: 'none',
                    '&:before': { display: 'none' },
                    '& .MuiAccordionSummary-root': {
                        minHeight: 40,
                        py: 0.5,
                        '& .MuiAccordionSummary-content': {
                            margin: '8px 0',
                        }
                    }
                }}
            >
                <AccordionSummary>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Icon sx={{ fontSize: 16, color: 'success.main' }}>description</Icon>
                        <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 500 }}>
                            {expanded ? 'Скрыть источники' : `Показать источники (${documents.length} документов)`}
                        </Typography>
                    </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 1 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {documents.map((doc, index) => (
                            <Paper
                                key={index}
                                sx={{
                                    p: 1.5,
                                    bgcolor: alpha(theme.palette.background.paper, 0.5),
                                    border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
                                    borderRadius: 1,
                                }}
                            >
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                                    <Box sx={{ flex: 1 }}>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                                            {doc.filename}
                                        </Typography>
                                        {doc.project && (
                                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                Проект: {doc.project}
                                            </Typography>
                                        )}
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Icon sx={{ fontSize: 14, color: 'success.main' }}>trending_up</Icon>
                                        <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>
                                            {formatSimilarity(doc.similarity)}
                                        </Typography>
                                    </Box>
                                </Box>
                                
                                {doc.content && (
                                    <Box>
                                        <Typography 
                                            variant="body2" 
                                            sx={{ 
                                                color: 'text.secondary',
                                                fontStyle: 'italic',
                                                bgcolor: alpha(theme.palette.common.white, 0.3),
                                                p: 1,
                                                borderRadius: 0.5,
                                                border: `1px dashed ${alpha(theme.palette.success.main, 0.3)}`,
                                                fontSize: '0.8rem',
                                                whiteSpace: 'pre-wrap'
                                            }}
                                        >
                                            {expandedDocs[index] ? cleanContent(doc.content) : truncateContent(doc.content)}
                                        </Typography>
                                        {cleanContent(doc.content).length > 150 && (
                                            <Button
                                                size="small"
                                                onClick={() => toggleDocExpanded(index)}
                                                sx={{ 
                                                    mt: 0.5, 
                                                    fontSize: '0.7rem',
                                                    color: 'success.main',
                                                    textTransform: 'none'
                                                }}
                                            >
                                                {expandedDocs[index] ? 'Показать меньше' : 'Показать больше'}
                                            </Button>
                                        )}
                                    </Box>
                                )}
                                
                                {doc.metadata && Object.keys(doc.metadata).length > 0 && (
                                    <Box sx={{ mt: 1 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                                            Метаданные:
                                        </Typography>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                            {Object.entries(doc.metadata).map(([key, value]) => (
                                                <Chip
                                                    key={key}
                                                    label={`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`}
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{ fontSize: '0.7rem', height: 20 }}
                                                />
                                            ))}
                                        </Box>
                                    </Box>
                                )}
                            </Paper>
                        ))}
                    </Box>
                </AccordionDetails>
            </Accordion>
        </Box>
    );
}

function Chat() {
    const [messageText, setMessageText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [messages, setMessages] = useState([]);
    const [projects, setProjects] = useState([]);
    const [selectedProject, setSelectedProject] = useState('');
    const [isLoadingProjects, setIsLoadingProjects] = useState(true);
    const [models, setModels] = useState({ installed: [], available: { ollama: [], openrouter: [] } });
    const [selectedModel, setSelectedModel] = useState('');
    const [modelSearch, setModelSearch] = useState('');
    const [isLoadingModels, setIsLoadingModels] = useState(true);
    const [isModelSelectOpen, setIsModelSelectOpen] = useState(false);
    const [useReranker, setUseReranker] = useState(true);
    const [thinkEnabled, setThinkEnabled] = useState(true);
    const [embeddingModels, setEmbeddingModels] = useState([]); // Список embedding моделей для исключения
    
    // Push-to-talk состояние
    const [isRecording, setIsRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState(null);
    const [isTranscribing, setIsTranscribing] = useState(false);
    
    const searchInputRef = useRef(null);
    const messagesEndRef = useRef(null);
    const chatContainerRef = useRef(null);
    const theme = useTheme();

    const handleModelSelectOpen = () => {
        setIsModelSelectOpen(true);
        // Сбрасываем поиск при открытии
        setModelSearch('');
        // Даем время для рендера перед фокусом
        setTimeout(() => {
            searchInputRef.current?.focus();
        }, 0);
    };

    const handleModelSelectClose = () => {
        setIsModelSelectOpen(false);
        // Сбрасываем поиск при закрытии
        setModelSearch('');
    };

    const handleModelChange = (event) => {
        const value = event.target.value;
        setSelectedModel(value);
        // Сохраняем выбранную модель в localStorage
        localStorage.setItem('chat_selected_model', value);
        // Закрываем выпадающий список при выборе модели
        handleModelSelectClose();
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Обработка отпускания кнопки мыши в любом месте страницы
    useEffect(() => {
        const handleMouseUp = () => {
            if (isRecording && mediaRecorder) {
                handleStopRecording();
            }
        };

        if (isRecording) {
            document.addEventListener('mouseup', handleMouseUp);
            document.addEventListener('mouseleave', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mouseleave', handleMouseUp);
        };
    }, [isRecording, mediaRecorder]);

    // Очистка ресурсов при размонтировании
    useEffect(() => {
        return () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
        };
    }, [mediaRecorder]);

    // Загрузка списка проектов и моделей при монтировании компонента
    useEffect(() => {
        const fetchData = async () => {
            try {
                // Загружаем проекты
                const projectsResponse = await window.api.fetch('/api/documents/projects');
                if (!projectsResponse.ok) {
                    throw new Error('Failed to fetch projects');
                }
                const projectsData = await projectsResponse.json();
                setProjects(projectsData);
                if (projectsData.length > 0) {
                    setSelectedProject(projectsData[0].name);
                }

                // Загружаем embedding модели (для исключения)
                const embeddingResponse = await window.api.fetch('/api/models');
                if (embeddingResponse.ok) {
                    const embeddingData = await embeddingResponse.json();
                    const embeddingModelsList = embeddingData.models.filter(model => 
                        model.downloadStatus?.status === 'ready' && 
                        model.capabilities?.includes('embedding')
                    );
                    // Добавляем FRIDA как embedding модель
                    embeddingModelsList.push({ name: 'frida' });
                    setEmbeddingModels(embeddingModelsList.map(m => m.name));
                }

                // Загружаем модели
                const modelsResponse = await window.api.fetch('/api/models/models');
                if (!modelsResponse.ok) {
                    throw new Error('Failed to fetch models');
                }
                const modelsData = await modelsResponse.json();
                setModels(modelsData.models);
                
                // Выбираем модель: сначала из localStorage, потом первую доступную
                const savedModel = localStorage.getItem('chat_selected_model');
                
                // Проверяем, есть ли сохраненная модель в списке доступных
                let modelToSelect = null;
                if (savedModel) {
                    // Проверяем в установленных моделях (исключая embedding)
                    const isInstalledModel = modelsData.models.installed.some(m => 
                        m.name === savedModel && !embeddingModels.includes(m.name)
                    );
                    // Проверяем в OpenRouter моделях
                    const isOpenRouterModel = modelsData.models.available.openrouter.some(m => `openrouter/${m.id}` === savedModel);
                    
                    if (isInstalledModel || isOpenRouterModel) {
                        modelToSelect = savedModel;
                    }
                }
                
                // Если сохраненной модели нет, выбираем первую доступную
                if (!modelToSelect) {
                    // Ищем первую не-embedding модель
                    const availableInstalled = modelsData.models.installed.filter(m => !embeddingModels.includes(m.name));
                    if (availableInstalled.length > 0) {
                        modelToSelect = availableInstalled[0].name;
                    } else if (modelsData.models.available.openrouter.length > 0) {
                        const firstOpenRouterModel = modelsData.models.available.openrouter[0];
                        modelToSelect = `openrouter/${firstOpenRouterModel.id}`;
                    }
                }
                
                if (modelToSelect) {
                    setSelectedModel(modelToSelect);
                }
            } catch (err) {
                console.error('Error fetching data:', err);
                setError('Failed to load data');
            } finally {
                setIsLoadingProjects(false);
                setIsLoadingModels(false);
            }
        };

        fetchData();
    }, []);

    // Фильтрация и подготовка списка моделей
    const allModels = useMemo(() => {
        return [
            // Установленные модели Ollama (исключаем embedding модели)
            ...models.installed
                .filter(model => {
                    // Исключаем модели из списка embedding моделей
                    return !embeddingModels.includes(model.name);
                })
                .map(model => ({
                    id: model.name,
                    name: model.name,
                    type: 'installed',
                    capabilities: model.capabilities || []
                })),
            // Модели OpenRouter
            ...models.available.openrouter.map(model => ({
                id: `openrouter/${model.id}`,
                name: model.name,
                type: 'openrouter',
                capabilities: model.capabilities || []
            }))
        ];
    }, [models, embeddingModels]);

    // Фильтрованные модели для отображения
    const displayedModels = useMemo(() => {
        // Если есть поисковый запрос, фильтруем модели
        if (modelSearch.trim()) {
            const searchTerms = modelSearch.toLowerCase().split(' ').filter(Boolean);
            return allModels
                .filter(model => {
                    const modelText = `${model.name} ${model.id}`.toLowerCase();
                    return searchTerms.every(term => modelText.includes(term));
                });
        }
        
        // Без поискового запроса показываем все модели
        return allModels;
    }, [allModels, modelSearch]);

    // Если выбранная модель не в списке доступных, сбрасываем на первую доступную
    useEffect(() => {
        if (selectedModel && !allModels.some(m => m.id === selectedModel)) {
            if (allModels.length > 0) {
                const newModel = allModels[0].id;
                setSelectedModel(newModel);
                localStorage.setItem('chat_selected_model', newModel);
            }
        }
    }, [selectedModel, allModels]);

    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();

        if (!messageText.trim() || isLoading || isTranscribing) return;

        const userMessage = messageText.trim();
        setMessageText('');
        
        // Используем новую функцию отправки
        await sendMessage(userMessage);
    }, [messageText, isLoading, isTranscribing, selectedProject, selectedModel, useReranker, thinkEnabled]);

    // Push-to-talk функции
    const handleStartRecording = async () => {
        try {
            setIsRecording(true);
            
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
                await transcribeAndSend(audioBlob);
                
                // Останавливаем поток
                stream.getTracks().forEach(track => track.stop());
                setMediaRecorder(null);
            };

            recorder.start();
            setMediaRecorder(recorder);
            
        } catch (err) {
            console.error('Error starting recording:', err);
            setIsRecording(false);
        }
    };

    const handleStopRecording = () => {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            setIsRecording(false);
        }
    };

    const transcribeAndSend = async (audioBlob) => {
        try {
            setIsTranscribing(true);
            
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.wav');
            formData.append('language', 'ru'); // можно сделать настраиваемым
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
            const transcribedText = result.text?.trim();
            
            // Сбрасываем индикатор STT сразу после получения текста
            setIsTranscribing(false);
            
            if (transcribedText) {
                // Отправляем сообщение напрямую
                await sendMessage(transcribedText);
            }

        } catch (err) {
            console.error('STT Error:', err);
            setError(`Ошибка распознавания речи: ${err.message}`);
            setIsTranscribing(false);
        }
    };

    // Отдельная функция для отправки сообщения
    const sendMessage = async (text) => {
        if (!text.trim() || isLoading || isTranscribing || !selectedProject) return;

        const userMessage = text.trim();
        setIsLoading(true);
        setError(null);

        // Сразу добавляем сообщение пользователя в чат
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

        try {
            const response = await window.api.fetch('/api/ai/rag', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ 
                    question: userMessage,
                    project: selectedProject,
                    model: selectedModel,
                    useReranker: useReranker,
                    think: thinkEnabled
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('Server error:', errorData);
                throw new Error(errorData.error || 'Failed to get answer');
            }

            const data = await response.json();
            
            // Добавляем ответ ассистента с возможным thinking и документами, т.к. сообщение пользователя уже добавлено
            setMessages(prev => [...prev, { 
                role: 'assistant', 
                content: data.answer,
                thinking: data.thinking, // Добавляем секцию размышлений если есть
                relevantDocuments: data.relevantDocuments, // Добавляем релевантные документы
                intentQuery: data.intentQuery // Добавляем извлеченный поисковый запрос
            }]);
        } catch (error) {
            console.error('Error:', error);
            setError(error.message);
            // В случае ошибки удаляем сообщение пользователя
            setMessages(prev => prev.slice(0, -1));
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoadingProjects || isLoadingModels) {
        return (
            <Box sx={{ 
                position: 'fixed',
                top: '64px',
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                justifyContent: 'center'
            }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ 
            position: 'fixed',
            top: '64px',
            left: '240px', // ширина левого меню
            right: 0,
            bottom: 0,
            display: 'flex',
            justifyContent: 'center'
        }}>
            <Container maxWidth="lg" sx={{ height: '100%', p: 0 }}>
                <Box sx={{ 
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    px: 3,
                    py: 2
                }}>
                    {/* Заголовок */}
                    <Box sx={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        mb: 3 
                    }}>
                        <Typography variant="h4" component="h1" sx={{
                            fontWeight: 600,
                            background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent'
                        }}>
                            Chat
                        </Typography>
                    </Box>

                    {/* Controls */}
                    <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
                        <FormControl sx={{ minWidth: 200 }}>
                            <InputLabel>Project</InputLabel>
                            <Select
                                value={selectedProject}
                                onChange={(e) => setSelectedProject(e.target.value)}
                                disabled={isLoadingProjects}
                                label="Project"
                            >
                                {projects.map((project) => (
                                    <MenuItem key={project.name} value={project.name}>
                                        {project.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl sx={{ minWidth: 250 }}>
                            <InputLabel>Model</InputLabel>
                            <Select
                                value={selectedModel}
                                onChange={handleModelChange}
                                disabled={isLoadingModels}
                                label="Model"
                                open={isModelSelectOpen}
                                onOpen={handleModelSelectOpen}
                                onClose={handleModelSelectClose}
                                MenuProps={{
                                    autoFocus: false,
                                    disableAutoFocusItem: true
                                }}
                            >
                                <MenuItem 
                                    sx={{ p: 0, '&.Mui-selected': { backgroundColor: 'transparent' } }}
                                    disableRipple
                                    onClick={(e) => e.preventDefault()}
                                >
                                    <TextField
                                        inputRef={searchInputRef}
                                        size="small"
                                        placeholder="Search models..."
                                        value={modelSearch}
                                        onChange={(e) => setModelSearch(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        onKeyDown={(e) => {
                                            // Предотвращаем закрытие выпадающего списка при нажатии Enter
                                            if (e.key === 'Enter') {
                                                e.stopPropagation();
                                            }
                                        }}
                                        autoFocus
                                        sx={{ 
                                            m: 1, 
                                            width: 'calc(100% - 16px)',
                                            '& .MuiInputBase-root': {
                                                backgroundColor: 'background.paper'
                                            }
                                        }}
                                    />
                                </MenuItem>
                                <Divider />
                                {displayedModels.map((model) => (
                                    <MenuItem 
                                        key={model.id} 
                                        value={model.id}
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1
                                        }}
                                    >
                                        <Icon sx={{ 
                                            color: model.type === 'installed' ? 'success.main' : 'primary.main',
                                            fontSize: 'small'
                                        }}>
                                            {model.type === 'installed' ? 'download_done' : 'cloud'}
                                        </Icon>
                                        {model.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                            <Typography variant="body2" sx={{ mr: 1 }}>Использовать Reranker:</Typography>
                            <Switch
                                checked={useReranker}
                                onChange={(e) => setUseReranker(e.target.checked)}
                                color="primary"
                            />
                        </FormControl>
                        <FormControl sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                            <Typography variant="body2" sx={{ mr: 1 }}>Показывать размышления:</Typography>
                            <Switch
                                checked={thinkEnabled}
                                onChange={(e) => setThinkEnabled(e.target.checked)}
                                color="primary"
                            />
                        </FormControl>
                    </Box>

                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
                    )}

                    {/* Chat Area */}
                    <Paper 
                        sx={{ 
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            borderRadius: 2,
                            background: theme => theme.palette.mode === 'light' 
                                ? 'rgba(255, 255, 255, 0.7)'
                                : 'rgba(50, 50, 50, 0.7)',
                            backdropFilter: 'blur(10px)',
                            boxShadow: theme => theme.palette.mode === 'light'
                                ? '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                : '0 6px 20px 0 rgba(8, 8, 15, 0.35)'
                        }}
                    >
                        {/* Messages Area */}
                        <Box 
                            ref={chatContainerRef}
                            sx={{ 
                                flex: 1,
                                overflowY: 'auto',
                                '&::-webkit-scrollbar': {
                                    width: '8px',
                                    backgroundColor: 'transparent',
                                },
                                '&::-webkit-scrollbar-thumb': {
                                    backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                    borderRadius: '4px',
                                    '&:hover': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.2)',
                                    }
                                },
                                '&::-webkit-scrollbar-track': {
                                    backgroundColor: 'transparent',
                                },
                                scrollbarWidth: 'thin',
                                scrollbarColor: 'rgba(0, 0, 0, 0.1) transparent',
                                // Добавляем анимацию пульса
                                '@keyframes pulse': {
                                    '0%': {
                                        opacity: 1,
                                        transform: 'scale(1)'
                                    },
                                    '50%': {
                                        opacity: 0.7,
                                        transform: 'scale(1.1)'
                                    },
                                    '100%': {
                                        opacity: 1,
                                        transform: 'scale(1)'
                                    }
                                }
                            }}
                        >
                            <Box sx={{ 
                                p: 2,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2
                            }}>
                                {messages.map((msg, index) => (
                                    <Box
                                        key={index}
                                        sx={{
                                            display: 'flex',
                                            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                            alignItems: 'flex-start',
                                            gap: 1
                                        }}
                                    >
                                        {/* Message Card */}
                                        <Box sx={{ maxWidth: '70%' }}>
                                            <Card
                                                elevation={0}
                                                sx={{
                                                    bgcolor: msg.role === 'user' 
                                                        ? 'primary.main'
                                                        : theme.palette.mode === 'dark'
                                                            ? alpha(theme.palette.common.white, 0.05)
                                                            : alpha(theme.palette.common.black, 0.05),
                                                }}
                                            >
                                                <CardContent sx={{ 
                                                    py: 1.5,
                                                    px: 2,
                                                    '&:last-child': { pb: 1.5 }
                                                }}>
                                                    <Typography 
                                                        component="div"
                                                        sx={{ 
                                                            color: msg.role === 'user'
                                                                ? '#fff'
                                                                : 'text.primary',
                                                            '& p': { m: 0 },
                                                            '& pre': {
                                                                bgcolor: theme.palette.mode === 'dark'
                                                                    ? alpha(theme.palette.common.black, 0.3)
                                                                    : alpha(theme.palette.common.white, 0.3),
                                                                p: 1,
                                                                borderRadius: 1,
                                                                overflowX: 'auto'
                                                            },
                                                            '& code': {
                                                                bgcolor: theme.palette.mode === 'dark'
                                                                    ? alpha(theme.palette.common.black, 0.3)
                                                                    : alpha(theme.palette.common.white, 0.3),
                                                                px: 0.5,
                                                                borderRadius: 0.5
                                                            }
                                                        }}
                                                    >
                                                        {msg.role === 'assistant' ? (
                                                            <>
                                                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                                                            </>
                                                        ) : (
                                                            <>
                                                                {msg.content}
                                                            </>
                                                        )}
                                                    </Typography>
                                                </CardContent>
                                            </Card>
                                            {/* Отображаем секцию размышлений только для ассистента */}
                                            {msg.role === 'assistant' && <ThinkingSection thinking={msg.thinking} />}
                                            {/* Отображаем релевантные документы только для ассистента */}
                                            {msg.role === 'assistant' && <RelevantDocumentsSection documents={msg.relevantDocuments} />}
                                        </Box>
                                    </Box>
                                ))}
                                {isLoading && (
                                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                        <CircularProgress size={20} />
                                        <Typography variant="body2" color="text.secondary">
                                            Processing your request...
                                        </Typography>
                                    </Box>
                                )}
                                {isRecording && (
                                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                        <Box sx={{
                                            width: 20,
                                            height: 20,
                                            borderRadius: '50%',
                                            bgcolor: 'error.main',
                                            animation: 'pulse 1s infinite'
                                        }} />
                                        <Typography variant="body2" color="text.secondary">
                                            Recording... Release to send
                                        </Typography>
                                    </Box>
                                )}
                                {isTranscribing && (
                                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                        <CircularProgress size={20} color="info" />
                                        <Typography variant="body2" color="text.secondary">
                                            Converting speech to text...
                                        </Typography>
                                    </Box>
                                )}
                                <div ref={messagesEndRef} />
                            </Box>
                        </Box>

                        {/* Input Area */}
                        <Divider />
                        <Box sx={{ p: 2, bgcolor: 'background.paper' }}>
                            <form onSubmit={handleSubmit}>
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    <TextField
                                        fullWidth
                                        value={messageText}
                                        onChange={(e) => setMessageText(e.target.value)}
                                        placeholder={selectedProject ? "Type your message..." : "Please select a project first"}
                                        variant="outlined"
                                        size="small"
                                        disabled={isLoading || !selectedProject || isTranscribing}
                                    />
                                    
                                    {/* Push-to-talk кнопка */}
                                    <IconButton
                                        onMouseDown={handleStartRecording}
                                        onMouseUp={handleStopRecording}
                                        onMouseLeave={handleStopRecording} // На случай если курсор ушел с кнопки
                                        disabled={isLoading || !selectedProject || isTranscribing}
                                        sx={{
                                            bgcolor: isRecording ? 'error.main' : 'info.main',
                                            color: 'white',
                                            '&:hover': {
                                                bgcolor: isRecording ? 'error.dark' : 'info.dark',
                                            },
                                            '&.Mui-disabled': {
                                                bgcolor: alpha(theme.palette.info.main, 0.1)
                                            },
                                            transition: 'all 0.2s',
                                            transform: isRecording ? 'scale(1.1)' : 'scale(1)'
                                        }}
                                        title={isRecording ? "Release to send" : "Hold to record"}
                                    >
                                        <Icon>
                                            {isTranscribing ? 'hourglass_empty' : isRecording ? 'stop' : 'mic'}
                                        </Icon>
                                    </IconButton>
                                    
                                    {/* Кнопка отправки */}
                                    <IconButton 
                                        type="submit" 
                                        color="primary" 
                                        disabled={isLoading || !messageText.trim() || !selectedProject || isTranscribing}
                                        sx={{
                                            bgcolor: 'primary.main',
                                            color: 'white',
                                            '&:hover': {
                                                bgcolor: 'primary.dark',
                                            },
                                            '&.Mui-disabled': {
                                                bgcolor: alpha(theme.palette.primary.main, 0.1)
                                            }
                                        }}
                                    >
                                        <Icon>send</Icon>
                                    </IconButton>
                                </Box>
                            </form>
                        </Box>
                    </Paper>
                </Box>
            </Container>
        </Box>
    );
}

// Export for browser environment
window.Chat = Chat;
