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
    TextField
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

    const loadModels = useCallback(async () => {
        try {
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
    }, [loadModels]);

    useEffect(() => {
        const interval = setInterval(loadModels, 1000);
        return () => clearInterval(interval);
    }, [loadModels]);

    // Мемоизируем обогащенные модели
    const enrichedModels = useMemo(() => {
        const installedModels = models.map(installedModel => {
            const availableModel = availableModels.find(m => m.name === installedModel.name) || {};
            const progress = modelProgress[installedModel.name];
            
            return {
                ...availableModel,  
                ...installedModel,  
                progress: progress || installedModel.downloadStatus?.progress,
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

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(Boolean);

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line.replace('data: ', ''));
                        if (data.completed && data.total) {
                            setModelProgress(prev => ({
                                ...prev,
                                [modelName]: {
                                    percent: Math.round((data.completed / data.total) * 100),
                                    downloaded: data.completed,
                                    total: data.total
                                }
                            }));
                        }
                        if (data.status === 'success') {
                            setTimeout(() => {
                                loadModels(); // Обновляем список установленных моделей
                            }, 1000);
                        }
                    } catch (e) {
                        console.error('Error parsing stream data:', e);
                    }
                }
            }
        } catch (err) {
            console.error('Error pulling model:', err);
            setError(err.message || 'Failed to pull model');
            window.enqueueSnackbar(err.message || 'Failed to pull model', { variant: 'error' });
        }
    }, [selectedVersions, loadModels]);

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
                '&:hover': {
                    boxShadow: 3
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
                                label={`${model.downloadStatus.progress}%`}
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
                                value={model.downloadStatus.progress} 
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

                <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
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
