// Get dependencies from global scope
const {
    Container,
    Box,
    Typography,
    Button,
    Alert,
    CircularProgress,
    Card,
    CardContent,
    CardActions,
    Icon,
    LinearProgress,
    Paper,
    Chip,
    Tooltip,
    Fade,
    Grid,
    InputAdornment,
    ButtonGroup,
    TextField,
    alpha
} = window.MaterialUI;

const { useState, useEffect, useCallback, useMemo, useRef } = window.React;

function Models() {
    const [models, setModels] = useState([]);
    const [availableModels, setAvailableModels] = useState([]);
    const [loadingInstalled, setLoadingInstalled] = useState(false);
    const [loadingAvailable, setLoadingAvailable] = useState(false);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCapability, setSelectedCapability] = useState('all');
    const [selectedVersions, setSelectedVersions] = useState({});

    // Храним состояние прогресса отдельно
    const [modelProgress, setModelProgress] = useState({});
    // Ссылка на WebSocket соединение
    const socketRef = useRef(null);

    // Функция для подключения к WebSocket
    const connectWebSocket = useCallback(() => {
        try {
            // Закрываем предыдущее соединение, если оно существует
            if (socketRef.current && 
                (socketRef.current.readyState === WebSocket.OPEN || 
                 socketRef.current.readyState === WebSocket.CONNECTING)) {
                console.log('Closing existing WebSocket connection');
                socketRef.current.close();
            }
            
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            // Используем window.location.hostname вместо localhost
            const host = window.location.host;
            const wsUrl = `${protocol}//${host}/ws/models`;
            
            console.log(`Connecting to WebSocket: ${wsUrl}`);
            const socket = new WebSocket(wsUrl);
            
            socket.addEventListener('open', () => {
                console.log('WebSocket connected for models');
                // Отправляем пинг для проверки соединения
                socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            });
            
            socket.addEventListener('message', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('WebSocket message received:', data);
                    
                    if (data.type === 'model_update' && data.model) {
                        // Обновляем статус загрузки модели
                        if (data.model.downloadStatus) {
                            console.log('WebSocket progress update:', data.model.name, data.model.downloadStatus);
                            
                            setModelProgress(prev => ({
                                ...prev,
                                [data.model.name]: data.model.downloadStatus.progress || 0
                            }));
                            
                            // Перезагружаем список моделей при завершении
                            if (data.model.downloadStatus.status === 'ready') {
                                loadModels();
                            }
                        }
                    }
                } catch (err) {
                    console.error('Error parsing WebSocket message:', err);
                }
            });
            
            socket.addEventListener('close', (event) => {
                console.log(`WebSocket connection closed for models with code ${event.code}, reason: ${event.reason}`);
                // Попытка переподключения через 2 секунды
                setTimeout(() => {
                    connectWebSocket();
                }, 2000);
            });
            
            socket.addEventListener('error', (error) => {
                console.error('WebSocket error:', error);
                // Не нужно здесь закрывать соединение, так как 'close' будет вызван автоматически после 'error'
            });
            
            socketRef.current = socket;
            
            // Периодически отправляем пинг, чтобы поддерживать соединение активным
            const pingInterval = setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
                } else if (socket.readyState !== WebSocket.CONNECTING) {
                    clearInterval(pingInterval);
                }
            }, 30000);
            
            // Очистка интервала при размонтировании или переподключении
            return () => clearInterval(pingInterval);
        } catch (e) {
            console.error('Error setting up WebSocket:', e);
            // Попытка переподключения после ошибки
            setTimeout(() => {
                connectWebSocket();
            }, 3000);
        }
    }, [loadModels]);

    const loadModels = useCallback(async () => {
        try {
            setLoadingInstalled(true);
            const response = await window.api.fetch(`/api/models?timestamp=${Date.now()}`);
            if (!response.ok) {
                throw new Error('Failed to load models');
            }

            const data = await response.json();
            
            // Обновляем прогресс для загружающихся моделей
            data.models.forEach(model => {
                if (model.downloadStatus?.status === 'downloading') {
                    setModelProgress(prev => ({
                        ...prev,
                        [model.name]: model.downloadStatus.progress
                    }));
                } else {
                    setModelProgress(prev => {
                        const newProgress = { ...prev };
                        delete newProgress[model.name];
                        return newProgress;
                    });
                }
            });

            // Всегда обновляем список моделей
            setModels(data.models);
            setError('');
        } catch (err) {
            console.error('Error loading models:', err);
            setError(err.message || 'Failed to load models');
        } finally {
            setLoadingInstalled(false);
        }
    }, []);

    const loadAvailableModels = useCallback(async () => {
        try {
            setLoadingAvailable(true);
            const response = await window.api.fetch('/api/models/available');
            if (!response || !response.ok) throw new Error('Failed to load available models');
            const data = await response.json();
            setAvailableModels(data.models || []);
        } catch (err) {
            console.error('Error loading available models:', err);
            setError(err.message || 'Failed to load available models');
        } finally {
            setLoadingAvailable(false);
        }
    }, []);

    useEffect(() => {
        loadModels();
        loadAvailableModels();
        
        // Устанавливаем WebSocket соединение
        connectWebSocket();
        
        // Очистка при размонтировании
        return () => {
            if (socketRef.current) {
                socketRef.current.close();
            }
        };
    }, [loadModels, loadAvailableModels, connectWebSocket]);

    // Мемоизируем обогащенные модели
    const enrichedModels = useMemo(() => {
        const installedModels = models.map(installedModel => {
            const availableModel = availableModels.find(m => m.name === installedModel.name) || {};
            const progress = modelProgress[installedModel.name];
            
            // Обогащаем модель данными о прогрессе загрузки
            let downloadStatus = installedModel.downloadStatus || {};
            if (downloadStatus.status === 'downloading' && progress !== undefined) {
                downloadStatus = {
                    ...downloadStatus,
                    progress: progress
                };
            }
            
            return {
                ...availableModel,  
                ...installedModel,  
                downloadStatus,
                capabilities: installedModel.capabilities || availableModel.capabilities || [],
            };
        });

        const notInstalledModels = availableModels.filter(
            model => !models.some(m => m.name === model.name)
        ).map(model => ({
            ...model,
            downloadStatus: { status: 'not_installed' }
        }));

        return [...installedModels, ...notInstalledModels];
    }, [models, availableModels, modelProgress]);

    // Мемоизируем отфильтрованные модели
    const filteredModels = useMemo(() => {
        return enrichedModels.filter(model => {
            const matchesSearch = model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                model.description?.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCapability = selectedCapability === 'all' || 
                model.capabilities?.includes(selectedCapability);
            return matchesSearch && matchesCapability;
        });
    }, [enrichedModels, searchQuery, selectedCapability]);

    const handlePullModel = useCallback(async (modelName) => {
        const selectedSize = selectedVersions[modelName];
        if (!selectedSize) {
            window.enqueueSnackbar('Please select a model size first', { variant: 'warning' });
            return;
        }

        try {
            // Сразу устанавливаем начальный прогресс
            setModelProgress(prev => ({
                ...prev,
                [modelName]: 0
            }));
            
            // Немедленно обновляем модель в списке, чтобы показать прогресс загрузки
            const newModelName = selectedSize ? `${modelName}:${selectedSize}` : modelName;
            
            // Сначала добавляем модель в список моделей с начальным статусом
            setModels(prevModels => {
                // Проверяем, есть ли уже такая модель
                const existingModel = prevModels.find(m => m.name === newModelName);
                if (existingModel) {
                    // Обновляем статус существующей модели
                    return prevModels.map(model => 
                        model.name === newModelName
                            ? { 
                                ...model, 
                                downloadStatus: { 
                                    status: 'downloading', 
                                    progress: 0, 
                                    message: 'Starting download' 
                                } 
                              }
                            : model
                    );
                } else {
                    // Добавляем новую модель
                    const availableModel = availableModels.find(m => m.name === modelName) || {};
                    const newModel = {
                        name: newModelName,
                        description: availableModel.description || `Model ${newModelName}`,
                        capabilities: availableModel.capabilities || [],
                        downloadStatus: {
                            status: 'downloading',
                            progress: 0,
                            message: 'Starting download'
                        }
                    };
                    return [...prevModels, newModel];
                }
            });
            
            // Показываем уведомление о начале загрузки
            window.enqueueSnackbar(`Starting download of ${newModelName}`, { variant: 'info' });
            
            const response = await window.api.fetch('/api/models/pull', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    name: modelName,
                    size: selectedSize 
                })
            });

            if (!response || !response.ok) throw new Error('Failed to pull model');

            // Обрабатываем поток событий
            const reader = response.body.getReader 
                ? response.body.getReader() // Если доступен метод getReader (для браузеров)
                : null;
            
            if (reader) {
                // Обработка для современных браузеров
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(Boolean);

                for (const line of lines) {
                    try {
                            const text = line.replace('data: ', '');
                            // Пропускаем [DONE] или пустые строки
                            if (text === '[DONE]' || !text.trim()) continue;
                            
                            const data = JSON.parse(text);
                            console.log('Stream data:', data);
                            
                        if (data.completed && data.total) {
                                const progressPercent = Math.round((data.completed / data.total) * 100);
                                console.log('Setting progress:', modelName, progressPercent);
                                
                            setModelProgress(prev => ({
                                ...prev,
                                    [newModelName]: progressPercent
                            }));
                        }
                            
                            // Обрабатываем успешное завершение
                            if (data.status === 'done' || data.status === 'success') {
                            setTimeout(() => {
                                loadModels(); // Обновляем список установленных моделей
                            }, 1000);
                        }
                    } catch (e) {
                            console.error('Error parsing stream data:', e, 'Raw line:', line);
                    }
                }
                }
            } else {
                // Альтернативный подход для обработки потока, если getReader недоступен
                // Ожидаем завершения загрузки через WebSocket
                console.log("Using WebSocket for model progress tracking");
                
                // Показываем пользователю, что процесс начался
                window.enqueueSnackbar(`Started downloading ${newModelName}. Progress will be updated via WebSocket.`, {
                    variant: 'info',
                    autoHideDuration: 5000
                });
                
                setTimeout(() => {
                    loadModels(); // Обновляем список установленных моделей через некоторое время
                }, 5000);
            }
        } catch (err) {
            console.error('Error pulling model:', err);
            setError(err.message || 'Failed to pull model');
            window.enqueueSnackbar(err.message || 'Failed to pull model', { variant: 'error' });
        }
    }, [selectedVersions, loadModels, availableModels]);

    const handleVersionSelect = useCallback((modelName, size) => {
        setSelectedVersions(prev => ({
            ...prev,
            [modelName]: size
        }));
    }, []);

    const handleDelete = useCallback(async (name) => {
        if (!window.confirm('Are you sure you want to delete this model?')) return;

        try {
            const response = await window.api.fetch(`/api/models/${name}`, {
                method: 'DELETE'
            });

            if (!response || !response.ok) throw new Error('Failed to delete model');
            await loadModels();
        } catch (err) {
            console.error('Error deleting model:', err);
            setError(err.message || 'Failed to delete model');
        }
    }, [loadModels]);

    const formatModelSize = useCallback((size) => {
        // Для установленных моделей форматируем в байты
        if (typeof size === 'number') {
            if (size < 1024) return `${size} bytes`;
            if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
            if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
            return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        }
        // Для доступных моделей возвращаем как есть
        return size;
    }, []);

    const renderModelCard = useCallback((model) => {
        const isInstalled = model.downloadStatus?.status === 'ready';
        const isDownloading = model.downloadStatus?.status === 'downloading';
        const isAvailable = !model.downloadStatus || model.downloadStatus.status === 'not_installed';
        const progress = model.downloadStatus?.progress || 0;
        
        // Для доступных моделей используем sizes, для установленных - size
        const modelSizes = isAvailable ? model.sizes : [model.size];
        const sizes = modelSizes?.filter(s => s) || [];
        const selectedSize = selectedVersions[model.name];
        
        return (
            <Card sx={{ 
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                borderRadius: 2,
                background: theme => theme.palette.mode === 'light' 
                    ? 'rgba(255, 255, 255, 0.7)'
                    : 'rgba(50, 50, 50, 0.7)',
                backdropFilter: 'blur(10px)',
                boxShadow: theme => theme.palette.mode === 'light'
                    ? '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                    : '0 6px 20px 0 rgba(8, 8, 15, 0.35)',
                '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: '0 12px 40px 0 rgba(31, 38, 135, 0.12)'
                }
            }}>
                <CardContent sx={{ flexGrow: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography variant="h6" sx={{ flexGrow: 1 }}>
                            {model.name}
                        </Typography>
                        {isInstalled && (
                            <Chip 
                                label="Installed" 
                                color="success" 
                                size="small"
                                icon={<Icon>check_circle</Icon>}
                            />
                        )}
                        {isDownloading && (
                            <Chip 
                                label={`${progress}%`}
                                color="primary" 
                                size="small"
                                icon={<Icon>downloading</Icon>}
                            />
                        )}
                        {isAvailable && (
                            <Chip 
                                label="Available" 
                                color="default" 
                                size="small"
                                icon={<Icon>cloud_download</Icon>}
                            />
                        )}
                    </Box>
                    
                    {isDownloading && (
                        <Box sx={{ width: '100%', mb: 2 }}>
                            <LinearProgress 
                                variant="determinate" 
                                value={progress} 
                                sx={{ 
                                    height: 8, 
                                    borderRadius: 4,
                                    bgcolor: 'action.hover',
                                    '& .MuiLinearProgress-bar': {
                                        borderRadius: 4,
                                        background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)'
                                    }
                                }}
                            />
                        </Box>
                    )}

                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {model.description}
                    </Typography>

                    {sizes.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            {isAvailable && <Typography variant="subtitle2" sx={{ mb: 1 }}>Available Sizes:</Typography>}
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {sizes.map(size => (
                                    <Chip
                                        key={size}
                                        label={isAvailable ? size : formatModelSize(size)}
                                        onClick={isAvailable ? () => handleVersionSelect(model.name, size) : undefined}
                                        color={isAvailable ? (selectedSize === size ? "primary" : "default") : "success"}
                                        variant="outlined"
                                        sx={{ 
                                            borderRadius: '16px',
                                            cursor: isAvailable ? 'pointer' : 'default',
                                            '&:hover': isAvailable ? {
                                                bgcolor: selectedSize === size ? 'primary.main' : 'action.hover'
                                            } : undefined
                                        }}
                                    />
                                ))}
                            </Box>
                        </Box>
                    )}

                    {model.capabilities?.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            {model.capabilities.map(cap => (
                                <Chip 
                                    key={cap}
                                    label={cap}
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    sx={{ mr: 0.5, mb: 0.5 }}
                                />
                            ))}
                        </Box>
                    )}

                    {model.tags?.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            {model.tags.map(tag => (
                                <Chip 
                                    key={tag}
                                    label={tag}
                                    size="small"
                                    color="info"
                                    variant="outlined"
                                    sx={{ mr: 0.5, mb: 0.5 }}
                                />
                            ))}
                        </Box>
                    )}
                </CardContent>
                
                <CardActions sx={{ justifyContent: 'flex-end', p: 2, pt: 0 }}>
                    {isAvailable && (
                        <Button 
                            size="small" 
                            onClick={() => handlePullModel(model.name)}
                            startIcon={<Icon>download</Icon>}
                            variant="contained"
                            color="primary"
                            disabled={!selectedSize}
                        >
                            Install
                        </Button>
                    )}
                    {isInstalled && (
                        <Button 
                            size="small" 
                            color="error"
                            onClick={() => handleDelete(model.name)}
                            startIcon={<Icon>delete</Icon>}
                            variant="outlined"
                        >
                            Delete
                        </Button>
                    )}
                </CardActions>
            </Card>
        );
    }, [handlePullModel, handleDelete, selectedVersions, handleVersionSelect]);

    return (
        <Container maxWidth="lg">
            <Box sx={{ 
                mt: 4,
                height: '100%',
                animation: 'fadeIn 0.5s ease-in-out',
                '@keyframes fadeIn': {
                    '0%': { opacity: 0, transform: 'translateY(20px)' },
                    '100%': { opacity: 1, transform: 'translateY(0)' }
                }
            }}>
                <Box sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 4
                }}>
                    <Typography variant="h4" component="h1" sx={{
                        fontWeight: 600,
                        background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent'
                    }}>
                        AI Models
                    </Typography>
                </Box>

                {error && (
                    <Fade in={true}>
                        <Alert
                            severity="error"
                            sx={{ mb: 3 }}
                            onClose={() => setError('')}
                        >
                            {error}
                        </Alert>
                    </Fade>
                )}

                <Paper sx={{ 
                    p: 3, 
                    mb: 3,
                    borderRadius: 2,
                    background: theme => theme.palette.mode === 'light' 
                        ? 'rgba(255, 255, 255, 0.5)'
                        : 'rgba(50, 50, 50, 0.5)',
                    backdropFilter: 'blur(10px)',
                    boxShadow: theme => theme.palette.mode === 'light'
                        ? '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                        : '0 6px 20px 0 rgba(8, 8, 15, 0.35)'
                }}>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <TextField
                            placeholder="Search models..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            sx={{ flexGrow: 1 }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Icon>search</Icon>
                                    </InputAdornment>
                                )
                            }}
                        />
                        <ButtonGroup>
                            <Button
                                variant={selectedCapability === 'all' ? 'contained' : 'outlined'}
                                onClick={() => setSelectedCapability('all')}
                            >
                                All
                            </Button>
                            <Button
                                variant={selectedCapability === 'embedding' ? 'contained' : 'outlined'}
                                onClick={() => setSelectedCapability('embedding')}
                            >
                                Embedding
                            </Button>
                            <Button
                                variant={selectedCapability === 'vision' ? 'contained' : 'outlined'}
                                onClick={() => setSelectedCapability('vision')}
                            >
                                Vision
                            </Button>
                            <Button
                                variant={selectedCapability === 'tools' ? 'contained' : 'outlined'}
                                onClick={() => setSelectedCapability('tools')}
                            >
                                Tools
                            </Button>
                        </ButtonGroup>
                    </Box>
                </Paper>

                {loadingInstalled || loadingAvailable || availableModels.length === 0 ? (
                    <Box sx={{ 
                        display: 'flex', 
                        justifyContent: 'center', 
                        alignItems: 'center', 
                        minHeight: 400,
                        width: '100%'
                    }}>
                        <CircularProgress 
                            size={60}
                            thickness={4}
                            sx={{
                                color: theme => theme.palette.primary.main
                            }}
                        />
                    </Box>
                ) : (
                    <Grid container spacing={3}>
                        {filteredModels.map(model => (
                            <Grid item xs={12} sm={6} md={4} key={model.name}>
                                {renderModelCard(model)}
                            </Grid>
                        ))}
                    </Grid>
                )}
            </Box>
        </Container>
    );
}

// Export for browser environment
window.Models = Models;
