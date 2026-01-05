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
    Icon
} = window.MaterialUI;

const { useEffect, useState } = window.React;

function Gpus() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [instances, setInstances] = useState([]);
    const [gpus, setGpus] = useState([]);
    const [metricsAvailable, setMetricsAvailable] = useState(false);
    const [metricsStale, setMetricsStale] = useState(false);

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
                setError('');
            } catch (e) {
                if (cancelled) return;
                setError(e.message || 'Failed to fetch GPU info');
            } finally {
                inFlight = false;
                if (!cancelled) setLoading(false);
            }
        };

        load();
        // "Realtime" polling (best-effort). If metrics are not available, polling is harmless.
        timerId = setInterval(load, 2000);

        return () => {
            cancelled = true;
            if (timerId) clearInterval(timerId);
        };
    }, []);

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
                    </Box>
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

