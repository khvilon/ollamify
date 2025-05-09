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
    Switch
} = window.MaterialUI;

const {
    useState,
    useCallback,
    useRef,
    useEffect,
    useMemo
} = window.React;

const ReactMarkdown = window.ReactMarkdown.default;

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
        // Закрываем выпадающий список при выборе модели
        handleModelSelectClose();
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

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

                // Загружаем модели
                const modelsResponse = await window.api.fetch('/api/models/models');
                if (!modelsResponse.ok) {
                    throw new Error('Failed to fetch models');
                }
                const modelsData = await modelsResponse.json();
                setModels(modelsData.models);
                
                // Выбираем первую доступную модель
                if (modelsData.models.installed.length > 0) {
                    setSelectedModel(modelsData.models.installed[0].name);
                } else if (modelsData.models.available.openrouter.length > 0) {
                    const firstOpenRouterModel = modelsData.models.available.openrouter[0];
                    setSelectedModel(`openrouter/${firstOpenRouterModel.id}`);
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
            // Установленные модели Ollama
            ...models.installed.map(model => ({
                id: model.name,
                name: model.name,
                type: 'installed'
            })),
            // Модели OpenRouter
            ...models.available.openrouter.map(model => ({
                id: `openrouter/${model.id}`,
                name: model.name,
                type: 'openrouter'
            }))
        ];
    }, [models]);

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
                setSelectedModel(allModels[0].id);
            }
        }
    }, [selectedModel, allModels]);

    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();

        if (!messageText.trim() || isLoading) return;

        const userMessage = messageText.trim();
        setMessageText('');
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
                    useReranker: useReranker
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('Server error:', errorData);
                throw new Error(errorData.error || 'Failed to get answer');
            }

            const data = await response.json();
            
            // Добавляем только ответ ассистента, т.к. сообщение пользователя уже добавлено
            setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
        } catch (error) {
            console.error('Error:', error);
            setError(error.message);
            // В случае ошибки удаляем сообщение пользователя
            setMessages(prev => prev.slice(0, -1));
        } finally {
            setIsLoading(false);
        }
    }, [messageText, isLoading, selectedProject, selectedModel, useReranker]);

    if (isLoadingProjects || isLoadingModels) {
        return (
            <Box sx={{ 
                position: 'fixed',
                top: '64px',
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                justifyContent: 'center',
                bgcolor: 'background.default'
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
            justifyContent: 'center',
            bgcolor: 'background.default'
        }}>
            <Container maxWidth="md" sx={{ height: '100%', p: 0 }}>
                <Box sx={{ 
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    px: 3,
                    py: 2
                }}>
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
                    </Box>

                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
                    )}

                    {/* Chat Area */}
                    <Paper 
                        elevation={1} 
                        sx={{ 
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            bgcolor: 'background.default'
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
                                        <Card
                                            elevation={0}
                                            sx={{
                                                maxWidth: '70%',
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
                                        disabled={isLoading || !selectedProject}
                                    />
                                    <IconButton 
                                        type="submit" 
                                        color="primary" 
                                        disabled={isLoading || !messageText.trim() || !selectedProject}
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
