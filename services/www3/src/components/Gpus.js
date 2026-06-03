// Get dependencies from global scope
const {
    Container,
    Box,
    Typography,
    Paper,
    Grid,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Alert,
    Fade,
    Icon,
    Button,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    LinearProgress
} = window.MaterialUI;

const { useEffect, useState } = window.React;

function Gpus() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [instances, setInstances] = useState([]);
    const [gpus, setGpus] = useState([]);
    const [metricsAvailable, setMetricsAvailable] = useState(false);
    const [metricsStale, setMetricsStale] = useState(false);
    const [vllm, setVllm] = useState(null);
    const [limits, setLimits] = useState(null);
    const [vllmModels, setVllmModels] = useState([]);
    const [vllmSelectedModel, setVllmSelectedModel] = useState('');
    const [vllmCustomModel, setVllmCustomModel] = useState('');
    const [vllmActionLoading, setVllmActionLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let timerId;
        let inFlight = false;

        const load = async () => {
            if (inFlight) return;
            inFlight = true;
            try {
                const response = await window.api.fetch('/api/gpus');
                if (!response) return;
                if (!response.ok) throw new Error('Failed to fetch GPU info');
                const data = await response.json();

                if (cancelled) return;
                setInstances(data.instances || []);
                setGpus(data.gpus || []);
                setMetricsAvailable(!!data.metricsAvailable);
                setMetricsStale(!!data.metricsStale);
                setVllm(data.vllm || null);
                setLimits(data.limits || null);
                setError('');
            } catch (e) {
                if (cancelled) return;
                setError(e.message || 'Failed to fetch GPU info');
            } finally {
                inFlight = false;
                if (!cancelled) setLoading(false);
            }
        };

        const loadVllmModels = async () => {
            try {
                const response = await window.api.fetch('/api/gpus/vllm/models');
                if (!response || !response.ok) return;
                const data = await response.json();
                if (cancelled) return;
                const models = data.models || [];
                setVllmModels(models);
                if (!vllmSelectedModel && models.length > 0) {
                    setVllmSelectedModel(models[0]);
                }
            } catch (e) {
                // The model list is optional UI data; status polling still works without it.
            }
        };

        load();
        loadVllmModels();
        // "Realtime" polling (best-effort). If metrics are not available, polling is harmless.
        timerId = setInterval(load, 2000);

        return () => {
            cancelled = true;
            if (timerId) clearInterval(timerId);
        };
    }, []);

    const handleLoadVllmModel = async () => {
        const model = (vllmCustomModel || vllmSelectedModel || '').trim();
        if (!model) {
            setError('vLLM model is required');
            return;
        }

        setVllmActionLoading(true);
        try {
            const response = await window.api.fetch('/api/gpus/vllm/load', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model })
            });
            if (!response) return;
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to load vLLM model');
            }
            const data = await response.json();
            setVllm(data);
            setError('');
        } catch (e) {
            setError(e.message || 'Failed to load vLLM model');
        } finally {
            setVllmActionLoading(false);
        }
    };

    const handleUnloadVllmModel = async () => {
        setVllmActionLoading(true);
        try {
            const response = await window.api.fetch('/api/gpus/vllm/unload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response) return;
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to unload vLLM model');
            }
            const data = await response.json();
            setVllm(data);
            setError('');
        } catch (e) {
            setError(e.message || 'Failed to unload vLLM model');
        } finally {
            setVllmActionLoading(false);
        }
    };

    const vllmState = vllm?.state || (vllm?.available === false ? 'unavailable' : 'unknown');
    const vllmStateColor =
        vllmState === 'running' ? 'success' :
        vllmState === 'loading' ? 'warning' :
        vllmState === 'error' || vllmState === 'unavailable' ? 'error' :
        'default';
    const selectedVllmModel = (vllmCustomModel || vllmSelectedModel || '').trim();
    const ollamaQueue = limits?.ollama || {};
    const ollamaQueued = Object.values(ollamaQueue).reduce((sum, item) => sum + (item?.queued || 0), 0);
    const ollamaActive = Object.values(ollamaQueue).reduce((sum, item) => sum + (item?.active || 0), 0);

    return (
        <Container maxWidth="lg">
            <Box sx={{ mt: 4 }}>
                <Typography variant="h4" component="h1" sx={{
                    fontWeight: 600,
                    background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    mb: 3
                }}>
                    GPUs
                </Typography>

                {error && (
                    <Fade in={true}>
                        <Alert severity="warning" sx={{ mb: 3 }} onClose={() => setError('')}>
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
                }}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Chip
                            icon={<Icon>dns</Icon>}
                            label={`Ollama instances: ${instances.length || 0}`}
                            color="primary"
                            variant="outlined"
                        />
                        <Chip
                            icon={<Icon>bolt</Icon>}
                            label={
                                metricsAvailable
                                    ? (metricsStale ? 'GPU metrics: stale' : 'GPU metrics: live')
                                    : 'GPU metrics: not available'
                            }
                            color={metricsAvailable ? (metricsStale ? 'warning' : 'success') : 'default'}
                            variant="outlined"
                        />
                        <Chip
                            icon={<Icon>memory</Icon>}
                            label={`vLLM: ${vllmState}`}
                            color={vllmStateColor}
                            variant="outlined"
                        />
                        {vllm?.current_model && (
                            <Chip
                                icon={<Icon>hub</Icon>}
                                label={`vLLM model: ${vllm.current_model}`}
                                color="info"
                                variant="outlined"
                            />
                        )}
                        <Chip
                            icon={<Icon>sync_alt</Icon>}
                            label={`Ollama queue: ${ollamaActive}/${ollamaQueued}`}
                            color={ollamaQueued > 0 ? 'warning' : 'default'}
                            variant="outlined"
                        />
                        <Chip
                            icon={<Icon>speed</Icon>}
                            label={`vLLM queue: ${limits?.vllm?.active || 0}/${limits?.vllm?.queued || 0}`}
                            color={(limits?.vllm?.queued || 0) > 0 ? 'warning' : 'default'}
                            variant="outlined"
                        />
                    </Box>
                </Paper>

                <Paper sx={{
                    p: 3,
                    mb: 3,
                    borderRadius: 2,
                    background: theme => theme.palette.mode === 'light'
                        ? 'rgba(255, 255, 255, 0.5)'
                        : 'rgba(50, 50, 50, 0.5)',
                    backdropFilter: 'blur(10px)',
                }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
                        vLLM
                    </Typography>
                    {(vllmState === 'loading' || vllmActionLoading) && (
                        <LinearProgress sx={{ mb: 2 }} />
                    )}
                    <Grid container spacing={2} alignItems="center">
                        <Grid item xs={12} md={5}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Model</InputLabel>
                                <Select
                                    value={vllmSelectedModel}
                                    label="Model"
                                    onChange={(event) => setVllmSelectedModel(event.target.value)}
                                >
                                    {vllmModels.map(model => (
                                        <MenuItem key={model} value={model}>{model}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} md={5}>
                            <TextField
                                fullWidth
                                size="small"
                                label="HuggingFace model or URL"
                                value={vllmCustomModel}
                                onChange={(event) => setVllmCustomModel(event.target.value)}
                            />
                        </Grid>
                        <Grid item xs={12} md={2}>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
                                <Button
                                    variant="contained"
                                    size="small"
                                    startIcon={<Icon>play_arrow</Icon>}
                                    disabled={vllmActionLoading || !selectedVllmModel}
                                    onClick={handleLoadVllmModel}
                                >
                                    Load
                                </Button>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    startIcon={<Icon>stop</Icon>}
                                    disabled={vllmActionLoading || !vllm?.current_model}
                                    onClick={handleUnloadVllmModel}
                                >
                                    Unload
                                </Button>
                            </Box>
                        </Grid>
                    </Grid>
                    {vllm?.served_models?.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2 }}>
                            {vllm.served_models.map(model => (
                                <Chip key={model} size="small" label={model} color="info" variant="outlined" />
                            ))}
                        </Box>
                    )}
                    {vllm?.error && (
                        <Typography variant="body2" color="error" sx={{ mt: 2, wordBreak: 'break-word' }}>
                            {vllm.error}
                        </Typography>
                    )}
                </Paper>

                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
                        <CircularProgress size={56} />
                    </Box>
                ) : (
                    <Grid container spacing={3}>
                        {gpus.length > 0 ? (
                            gpus.map(gpu => (
                                <Grid item xs={12} md={6} key={gpu.index}>
                                    <Card sx={{
                                        borderRadius: 2,
                                        background: theme => theme.palette.mode === 'light'
                                            ? 'rgba(255, 255, 255, 0.7)'
                                            : 'rgba(50, 50, 50, 0.7)',
                                        backdropFilter: 'blur(10px)',
                                    }}>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                                    GPU {gpu.index}
                                                </Typography>
                                                <Chip label={gpu.name} size="small" color="primary" variant="outlined" />
                                            </Box>

                                            <Grid container spacing={2}>
                                                <Grid item xs={12} sm={6}>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Utilization
                                                    </Typography>
                                                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                                        {gpu.utilization_gpu_percent ?? 0}% GPU / {gpu.utilization_mem_percent ?? 0}% MEM
                                                    </Typography>
                                                </Grid>
                                                <Grid item xs={12} sm={6}>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Temperature
                                                    </Typography>
                                                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                                        {gpu.temperature_c ?? '—'}°C
                                                    </Typography>
                                                </Grid>
                                                <Grid item xs={12} sm={6}>
                                                    <Typography variant="body2" color="text.secondary">
                                                        VRAM
                                                    </Typography>
                                                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                                        {gpu.memory_used_mb ?? 0} / {gpu.memory_total_mb ?? 0} MB
                                                    </Typography>
                                                </Grid>
                                                <Grid item xs={12} sm={6}>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Power
                                                    </Typography>
                                                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                                        {gpu.power_w != null ? `${gpu.power_w.toFixed(1)} W` : '—'}
                                                    </Typography>
                                                </Grid>
                                            </Grid>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))
                        ) : (
                            <Grid item xs={12}>
                                <Paper sx={{ p: 3, borderRadius: 2 }}>
                                    <Typography color="text.secondary">
                                        No GPU metrics available. If you run with GPU, ensure `docker compose` uses the GPU override files and NVIDIA runtime is configured.
                                    </Typography>
                                </Paper>
                            </Grid>
                        )}

                        <Grid item xs={12}>
                            <Paper sx={{ p: 3, borderRadius: 2 }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                                    Ollama instances
                                </Typography>
                                {instances.length > 0 ? (
                                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                        {instances.map(inst => (
                                            <Chip
                                                key={inst.id}
                                                label={`${inst.name} (${inst.baseUrl})`}
                                                color="info"
                                                variant="outlined"
                                            />
                                        ))}
                                    </Box>
                                ) : (
                                    <Typography color="text.secondary">
                                        No Ollama instances detected.
                                    </Typography>
                                )}
                            </Paper>
                        </Grid>
                    </Grid>
                )}
            </Box>
        </Container>
    );
}

// Export for browser environment
window.Gpus = Gpus;

