// Get dependencies from global scope
const {
    Container,
    Box,
    Typography,
    Paper,
    Grid,
    Card,
    CardContent,
    CardActions,
    Button,
    TextField,
    Switch,
    FormControlLabel,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Icon,
    Chip,
    Alert,
    Fade,
    CircularProgress,
    Divider,
    Tooltip,
    alpha,
} = window.MaterialUI;

const { useEffect, useMemo, useState, useCallback } = window.React;

function FriendlyServers() {
    const [servers, setServers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({
        name: '',
        base_url: '',
        username: '',
        api_key: '',
        enabled: true,
    });

    const [localStatus, setLocalStatus] = useState(null);
    const [loadingLocalStatus, setLoadingLocalStatus] = useState(false);

    const [serverStatus, setServerStatus] = useState({});
    const [loadingStatusById, setLoadingStatusById] = useState({});

    const resetForm = useCallback(() => {
        setForm({
            name: '',
            base_url: '',
            username: '',
            api_key: '',
            enabled: true,
        });
        setEditing(null);
    }, []);

    const openCreate = useCallback(() => {
        resetForm();
        setDialogOpen(true);
    }, [resetForm]);

    const openEdit = useCallback((server) => {
        setEditing(server);
        setForm({
            name: server?.name || '',
            base_url: server?.base_url || '',
            username: server?.username || '',
            api_key: '',
            enabled: server?.enabled !== false,
        });
        setDialogOpen(true);
    }, []);

    const closeDialog = useCallback(() => {
        setDialogOpen(false);
        resetForm();
    }, [resetForm]);

    const loadServers = useCallback(async () => {
        try {
            setLoading(true);
            const resp = await window.api.fetch('/api/admin/friendly-servers');
            if (!resp) return;
            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                throw new Error(text || 'Failed to load friendly servers (admin only)');
            }
            const data = await resp.json();
            setServers(data.servers || []);
            setError('');
        } catch (e) {
            setError(e.message || 'Failed to load friendly servers');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadLocalStatus = useCallback(async () => {
        try {
            setLoadingLocalStatus(true);
            const resp = await window.api.fetch('/api/cluster/status');
            if (!resp) return;
            if (!resp.ok) throw new Error('Failed to load local status');
            const data = await resp.json();
            setLocalStatus(data);
        } catch (e) {
            // Non-fatal for this page
            console.warn('Failed to load local status:', e);
        } finally {
            setLoadingLocalStatus(false);
        }
    }, []);

    useEffect(() => {
        loadServers();
        loadLocalStatus();
    }, [loadServers, loadLocalStatus]);

    const submit = useCallback(async () => {
        try {
            const isEdit = !!editing?.id;
            const url = isEdit ? `/api/admin/friendly-servers/${editing.id}` : '/api/admin/friendly-servers';
            const method = isEdit ? 'PUT' : 'POST';

            if (!isEdit && (!form.api_key || !form.api_key.trim())) {
                window.enqueueSnackbar('API Key is required', { variant: 'warning' });
                return;
            }

            const payload = {
                name: form.name,
                base_url: form.base_url,
                username: form.username,
                enabled: !!form.enabled,
            };

            // Only send api_key when provided (so edits can keep existing)
            if (form.api_key && form.api_key.trim()) {
                payload.api_key = form.api_key;
            }

            const resp = await window.api.fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!resp) return;
            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                throw new Error(text || 'Failed to save server');
            }

            window.enqueueSnackbar(isEdit ? 'Server updated' : 'Server created', { variant: 'success' });
            closeDialog();
            await loadServers();
        } catch (e) {
            window.enqueueSnackbar(e.message || 'Failed to save server', { variant: 'error' });
        }
    }, [editing, form, closeDialog, loadServers]);

    const removeServer = useCallback(async (server) => {
        if (!server?.id) return;
        if (!window.confirm(`Delete friendly server "${server.name}"?`)) return;
        try {
            const resp = await window.api.fetch(`/api/admin/friendly-servers/${server.id}`, { method: 'DELETE' });
            if (!resp) return;
            if (!resp.ok) throw new Error('Failed to delete server');
            window.enqueueSnackbar('Server deleted', { variant: 'success' });
            await loadServers();
        } catch (e) {
            window.enqueueSnackbar(e.message || 'Failed to delete server', { variant: 'error' });
        }
    }, [loadServers]);

    const refreshStatus = useCallback(async (server) => {
        if (!server?.id) return;
        setLoadingStatusById(prev => ({ ...prev, [server.id]: true }));
        try {
            const resp = await window.api.fetch(`/api/admin/friendly-servers/${server.id}/status`);
            if (!resp) return;
            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                throw new Error(text || 'Status request failed');
            }
            const data = await resp.json();
            setServerStatus(prev => ({ ...prev, [server.id]: data.status }));
            window.enqueueSnackbar(`Status updated: ${server.name}`, { variant: 'info', autoHideDuration: 2000 });
        } catch (e) {
            window.enqueueSnackbar(e.message || 'Failed to fetch status', { variant: 'warning' });
        } finally {
            setLoadingStatusById(prev => ({ ...prev, [server.id]: false }));
        }
    }, []);

    const formatGpu = (gpu) => {
        if (!gpu) return '—';
        const util = gpu.utilization_gpu_percent ?? 0;
        const used = gpu.memory_used_mb ?? 0;
        const total = gpu.memory_total_mb ?? 0;
        return `${util}% · VRAM ${used}/${total} MB`;
    };

    const localSummary = useMemo(() => {
        if (!localStatus) return null;
        const g0 = (localStatus.gpus || []).find(g => String(g.index) === '0') || (localStatus.gpus || [])[0];
        const inFlight = localStatus.load?.in_flight_total ?? 0;
        const loadedCount = (localStatus.models?.loaded || []).length;
        return {
            inFlight,
            loadedCount,
            gpuText: g0 ? formatGpu(g0) : 'GPU metrics not available',
        };
    }, [localStatus]);

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
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <Typography variant="h4" component="h1" sx={{
                        fontWeight: 600,
                        background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent'
                    }}>
                        Friendly Servers
                    </Typography>
                    <Button
                        variant="contained"
                        startIcon={<Icon>add</Icon>}
                        onClick={openCreate}
                        sx={{
                            background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                            '&:hover': {
                                background: 'linear-gradient(45deg, #1976D2 30%, #1CA7D2 90%)'
                            }
                        }}
                    >
                        Add server
                    </Button>
                </Box>

                {error && (
                    <Fade in={true}>
                        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
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
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                            <Chip
                                icon={<Icon>dns</Icon>}
                                label={`Servers: ${servers.length}`}
                                color="primary"
                                variant="outlined"
                            />
                            <Chip
                                icon={<Icon>memory</Icon>}
                                label={
                                    loadingLocalStatus
                                        ? 'Local: loading…'
                                        : localSummary
                                            ? `Local: in-flight ${localSummary.inFlight} · loaded ${localSummary.loadedCount}`
                                            : 'Local: unavailable'
                                }
                                color={localSummary ? 'success' : 'default'}
                                variant="outlined"
                            />
                            <Chip
                                icon={<Icon>speed</Icon>}
                                label={localSummary ? localSummary.gpuText : 'GPU metrics: —'}
                                color={localStatus?.metricsAvailable ? (localStatus?.metricsStale ? 'warning' : 'info') : 'default'}
                                variant="outlined"
                            />
                        </Box>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Icon>refresh</Icon>}
                            onClick={() => { loadServers(); loadLocalStatus(); }}
                        >
                            Refresh
                        </Button>
                    </Box>
                </Paper>

                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 280 }}>
                        <CircularProgress size={60} thickness={4} />
                    </Box>
                ) : (
                    <Grid container spacing={3}>
                        {servers.length === 0 ? (
                            <Grid item xs={12}>
                                <Paper sx={{ p: 3, borderRadius: 2 }}>
                                    <Typography color="text.secondary">
                                        No friendly servers yet. Add one to enable smart forwarding for completions/embeddings.
                                    </Typography>
                                </Paper>
                            </Grid>
                        ) : (
                            servers.map((s) => {
                                const st = serverStatus[s.id];
                                const isBusy = !!loadingStatusById[s.id];
                                const g0 = st?.gpus ? (st.gpus.find(g => String(g.index) === '0') || st.gpus[0]) : null;
                                const inflight = st?.load?.in_flight_total ?? null;
                                const loadedCount = st?.models?.loaded?.length ?? null;
                                const installedCount = st?.models?.installed?.length ?? null;
                                const latencyMs = st?._remote?.latency_ms ?? null;

                                return (
                                    <Grid item xs={12} md={6} key={s.id}>
                                        <Card sx={{
                                            borderRadius: 2,
                                            height: '100%',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            background: theme => theme.palette.mode === 'light'
                                                ? 'rgba(255, 255, 255, 0.7)'
                                                : 'rgba(50, 50, 50, 0.7)',
                                            backdropFilter: 'blur(10px)',
                                            boxShadow: theme => theme.palette.mode === 'light'
                                                ? '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                                : '0 6px 20px 0 rgba(8, 8, 15, 0.35)',
                                            '&:hover': {
                                                transform: 'translateY(-3px)',
                                                boxShadow: theme => theme.palette.mode === 'light'
                                                    ? '0 12px 40px 0 rgba(31, 38, 135, 0.12)'
                                                    : '0 10px 28px 0 rgba(8, 8, 15, 0.45)'
                                            }
                                        }}>
                                            <CardContent sx={{ flexGrow: 1 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                                            {s.name}
                                                        </Typography>
                                                        {s.enabled ? (
                                                            <Chip size="small" color="success" label="Enabled" variant="outlined" />
                                                        ) : (
                                                            <Chip size="small" color="default" label="Disabled" variant="outlined" />
                                                        )}
                                                    </Box>
                                                    <Tooltip title="Fetch remote status">
                                                        <span>
                                                            <IconButton
                                                                size="small"
                                                                onClick={() => refreshStatus(s)}
                                                                disabled={isBusy}
                                                            >
                                                                <Icon>{isBusy ? 'hourglass_top' : 'sync'}</Icon>
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                </Box>

                                                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                                    {s.base_url}
                                                </Typography>
                                                {s.username && (
                                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                                        User: {s.username}
                                                    </Typography>
                                                )}

                                                <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                                    <Chip
                                                        size="small"
                                                        variant="outlined"
                                                        icon={<Icon>vpn_key</Icon>}
                                                        label={s.api_key_masked ? `Key: ${s.api_key_masked}` : 'Key: set'}
                                                    />
                                                    <Chip
                                                        size="small"
                                                        variant="outlined"
                                                        icon={<Icon>bolt</Icon>}
                                                        label={latencyMs != null ? `Latency: ${latencyMs}ms` : 'Latency: —'}
                                                    />
                                                    <Chip
                                                        size="small"
                                                        variant="outlined"
                                                        icon={<Icon>sync</Icon>}
                                                        label={inflight != null ? `In-flight: ${inflight}` : 'In-flight: —'}
                                                    />
                                                </Box>

                                                <Divider sx={{ my: 2, opacity: 0.25 }} />

                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                                    <Typography variant="body2" color="text.secondary">
                                                        GPU: {g0 ? formatGpu(g0) : '—'}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Models: {loadedCount != null ? `${loadedCount} loaded` : '—'} · {installedCount != null ? `${installedCount} installed` : '—'}
                                                    </Typography>
                                                </Box>
                                            </CardContent>
                                            <CardActions sx={{ justifyContent: 'flex-end', px: 2, pb: 2 }}>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    startIcon={<Icon>edit</Icon>}
                                                    onClick={() => openEdit(s)}
                                                >
                                                    Edit
                                                </Button>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    color="error"
                                                    startIcon={<Icon>delete</Icon>}
                                                    onClick={() => removeServer(s)}
                                                >
                                                    Delete
                                                </Button>
                                            </CardActions>
                                        </Card>
                                    </Grid>
                                );
                            })
                        )}
                    </Grid>
                )}

                <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="sm">
                    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Icon>{editing ? 'edit' : 'add_circle'}</Icon>
                        {editing ? 'Edit friendly server' : 'Add friendly server'}
                    </DialogTitle>
                    <DialogContent dividers>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                            <TextField
                                label="Name"
                                value={form.name}
                                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                required
                                fullWidth
                            />
                            <TextField
                                label="Host / Base URL"
                                value={form.base_url}
                                onChange={(e) => setForm(prev => ({ ...prev, base_url: e.target.value }))}
                                placeholder="http://10.0.0.10 or https://ollamify.my.lan"
                                required
                                fullWidth
                                helperText="You can enter host:port (scheme will default to http)."
                            />
                            <TextField
                                label="User (optional)"
                                value={form.username}
                                onChange={(e) => setForm(prev => ({ ...prev, username: e.target.value }))}
                                fullWidth
                            />
                            <TextField
                                label={editing ? 'API Key (leave empty to keep current)' : 'API Key'}
                                value={form.api_key}
                                onChange={(e) => setForm(prev => ({ ...prev, api_key: e.target.value }))}
                                fullWidth
                                type="password"
                                required={!editing}
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={!!form.enabled}
                                        onChange={(e) => setForm(prev => ({ ...prev, enabled: e.target.checked }))}
                                    />
                                }
                                label="Enabled"
                            />
                        </Box>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={closeDialog}>Cancel</Button>
                        <Button
                            variant="contained"
                            onClick={submit}
                            sx={{
                                background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                                '&:hover': {
                                    background: 'linear-gradient(45deg, #1976D2 30%, #1CA7D2 90%)'
                                }
                            }}
                        >
                            Save
                        </Button>
                    </DialogActions>
                </Dialog>
            </Box>
        </Container>
    );
}

// Export for browser environment
window.FriendlyServers = FriendlyServers;

