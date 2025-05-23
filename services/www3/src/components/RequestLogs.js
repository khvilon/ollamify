// Get dependencies from global scope
const {
    Container,
    Box,
    Typography,
    Card,
    CardContent,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Chip,
    TextField,
    Button,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Grid,
    CircularProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Pagination,
    Alert,
    Icon,
    useTheme,
    alpha
} = window.MaterialUI;

const {
    useState,
    useEffect,
    useCallback
} = window.React;

function RequestLogs() {
    // Состояние
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(null);
    const [userStats, setUserStats] = useState([]);
    const [isAdmin, setIsAdmin] = useState(false);
    
    // Пагинация
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [limit] = useState(50);
    
    // Фильтры
    const [filters, setFilters] = useState({
        user_name: '',
        method: '',
        path: '',
        start_date: '',
        end_date: ''
    });
    
    // Диалог деталей
    const [selectedLog, setSelectedLog] = useState(null);
    const [detailsOpen, setDetailsOpen] = useState(false);
    
    const theme = useTheme();

    // Загрузка логов
    const fetchLogs = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                ...Object.fromEntries(
                    Object.entries(filters).filter(([_, value]) => value)
                )
            });
            
            const response = await window.api.fetch(`/api/admin/logs?${params}`);
            
            if (!response.ok) {
                throw new Error('Ошибка загрузки логов');
            }
            
            const data = await response.json();
            setLogs(data.logs);
            setStats(data.stats);
            setTotalPages(data.pagination.pages);
            setIsAdmin(data.isAdmin || false);
            
        } catch (err) {
            console.error('Error fetching logs:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, limit, filters]);

    // Загрузка статистики пользователей
    const fetchUserStats = useCallback(async () => {
        try {
            // Загружаем статистику только если пользователь админ
            if (!isAdmin) {
                setUserStats([]);
                return;
            }
            
            const params = new URLSearchParams();
            if (filters.start_date) params.append('start_date', filters.start_date);
            if (filters.end_date) params.append('end_date', filters.end_date);
            
            const response = await window.api.fetch(`/api/admin/stats/users?${params}`);
            
            if (response.ok) {
                const data = await response.json();
                setUserStats(data.users);
            } else {
                // Если нет доступа, просто очищаем статистику
                setUserStats([]);
            }
        } catch (err) {
            console.error('Error fetching user stats:', err);
            setUserStats([]);
        }
    }, [filters.start_date, filters.end_date, isAdmin]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    // Загружаем статистику пользователей только после получения информации о правах
    useEffect(() => {
        if (isAdmin) {
            fetchUserStats();
        }
    }, [fetchUserStats, isAdmin]);

    // Обработчики
    const handleFilterChange = (field, value) => {
        setFilters(prev => ({ ...prev, [field]: value }));
        setPage(1); // Сбрасываем на первую страницу при изменении фильтров
    };

    const handleApplyFilters = () => {
        fetchLogs();
        if (isAdmin) {
            fetchUserStats();
        }
    };

    const handleClearFilters = () => {
        setFilters({
            user_name: '',
            method: '',
            path: '',
            start_date: '',
            end_date: ''
        });
        setPage(1);
    };

    const handleViewDetails = (log) => {
        setSelectedLog(log);
        setDetailsOpen(true);
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleString('ru-RU');
    };

    const getMethodColor = (method) => {
        const colors = {
            'GET': 'success',
            'POST': 'primary',
            'PUT': 'warning',
            'DELETE': 'error',
            'PATCH': 'info'
        };
        return colors[method] || 'default';
    };

    const getResponseTimeColor = (time) => {
        if (time < 100) return 'success';
        if (time < 500) return 'warning';
        return 'error';
    };

    const getCategoryColor = (category) => {
        const colors = {
            'AI': 'primary',
            'TTS': 'secondary',
            'STT': 'info',
            'Documents': 'success',
            'Models': 'warning',
            'Admin': 'error',
            'Health': 'default'
        };
        return colors[category] || 'default';
    };

    if (loading && logs.length === 0) {
        return (
            <Container maxWidth="lg" sx={{ py: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            <Box sx={{ 
                animation: 'fadeIn 0.5s ease-in-out',
                '@keyframes fadeIn': {
                    '0%': { opacity: 0, transform: 'translateY(20px)' },
                    '100%': { opacity: 1, transform: 'translateY(0)' }
                }
            }}>
            {/* Заголовок */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" component="h1" sx={{
                    fontWeight: 600,
                    background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                }}>
                    Request Logs
                </Typography>
                <Typography variant="subtitle1" color="text.secondary">
                    Monitor and analyze user activity
                </Typography>
            </Box>

            {/* Ошибка */}
            {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {error}
                </Alert>
            )}

            {/* Статистика */}
            {stats && (
                <Grid container spacing={3} sx={{ mb: 3 }}>
                    {(() => {
                        // Динамически рассчитываем количество плашек
                        const statsCount = 3 + (isAdmin && stats.unique_users ? 1 : 0);
                        const gridSize = statsCount === 4 ? 3 : 12 / statsCount;
                        
                        return (
                            <>
                                <Grid item xs={12} sm={6} md={gridSize}>
                                    <Card sx={{ 
                                        height: '100%',
                                        borderRadius: 2,
                                        background: theme => theme.palette.mode === 'light' 
                                            ? 'rgba(255, 255, 255, 0.7)'
                                            : 'rgba(50, 50, 50, 0.7)',
                                        backdropFilter: 'blur(10px)',
                                        boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                    }}>
                                        <CardContent sx={{ textAlign: 'center', py: 3 }}>
                                            <Icon sx={{ fontSize: 40, color: 'primary.main', mb: 1 }}>trending_up</Icon>
                                            <Typography variant="h6" gutterBottom>
                                                {parseInt(stats.total_requests).toLocaleString()}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                Total Requests
                                            </Typography>
                                        </CardContent>
                                    </Card>
                                </Grid>
                                {isAdmin && stats.unique_users && (
                                    <Grid item xs={12} sm={6} md={gridSize}>
                                        <Card sx={{ 
                                            height: '100%',
                                            borderRadius: 2,
                                            background: theme => theme.palette.mode === 'light' 
                                                ? 'rgba(255, 255, 255, 0.7)'
                                                : 'rgba(50, 50, 50, 0.7)',
                                            backdropFilter: 'blur(10px)',
                                            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                        }}>
                                            <CardContent sx={{ textAlign: 'center', py: 3 }}>
                                                <Icon sx={{ fontSize: 40, color: 'success.main', mb: 1 }}>people</Icon>
                                                <Typography variant="h6" gutterBottom>
                                                    {parseInt(stats.unique_users).toLocaleString()}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    Unique Users
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                )}
                                <Grid item xs={12} sm={6} md={gridSize}>
                                    <Card sx={{ 
                                        height: '100%',
                                        borderRadius: 2,
                                        background: theme => theme.palette.mode === 'light' 
                                            ? 'rgba(255, 255, 255, 0.7)'
                                            : 'rgba(50, 50, 50, 0.7)',
                                        backdropFilter: 'blur(10px)',
                                        boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                    }}>
                                        <CardContent sx={{ textAlign: 'center', py: 3 }}>
                                            <Icon sx={{ fontSize: 40, color: 'info.main', mb: 1 }}>speed</Icon>
                                            <Typography variant="h6" gutterBottom>
                                                {Math.round(parseFloat(stats.avg_response_time))} ms
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                Avg Response Time
                                            </Typography>
                                        </CardContent>
                                    </Card>
                                </Grid>
                                <Grid item xs={12} sm={6} md={gridSize}>
                                    <Card sx={{ 
                                        height: '100%',
                                        borderRadius: 2,
                                        background: theme => theme.palette.mode === 'light' 
                                            ? 'rgba(255, 255, 255, 0.7)'
                                            : 'rgba(50, 50, 50, 0.7)',
                                        backdropFilter: 'blur(10px)',
                                        boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                    }}>
                                        <CardContent sx={{ textAlign: 'center', py: 3 }}>
                                            <Icon sx={{ fontSize: 40, color: 'warning.main', mb: 1 }}>slow_motion_video</Icon>
                                            <Typography variant="h6" gutterBottom>
                                                {parseInt(stats.slow_requests).toLocaleString()}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                Slow Requests (&gt;1s)
                                            </Typography>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            </>
                        );
                    })()}
                </Grid>
            )}

            {/* Фильтры */}
            <Card sx={{ 
                mb: 3,
                borderRadius: 2,
                background: theme => theme.palette.mode === 'light' 
                    ? 'rgba(255, 255, 255, 0.7)'
                    : 'rgba(50, 50, 50, 0.7)',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
            }}>
                <CardContent>
                    <Typography variant="h6" gutterBottom>
                        <Icon sx={{ mr: 1, verticalAlign: 'middle' }}>filter_list</Icon>
                        Filters
                    </Typography>
                    
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        {isAdmin && (
                            <Grid item xs={12} sm={6} md={4} lg={2}>
                                <TextField
                                    fullWidth
                                    label="User"
                                    value={filters.user_name}
                                    onChange={(e) => handleFilterChange('user_name', e.target.value)}
                                    size="small"
                                />
                            </Grid>
                        )}
                        <Grid item xs={12} sm={6} md={4} lg={2}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Method</InputLabel>
                                <Select
                                    value={filters.method}
                                    label="Method"
                                    onChange={(e) => handleFilterChange('method', e.target.value)}
                                >
                                    <MenuItem value="">All</MenuItem>
                                    <MenuItem value="GET">GET</MenuItem>
                                    <MenuItem value="POST">POST</MenuItem>
                                    <MenuItem value="PUT">PUT</MenuItem>
                                    <MenuItem value="DELETE">DELETE</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6} md={4} lg={2}>
                            <TextField
                                fullWidth
                                label="Path"
                                value={filters.path}
                                onChange={(e) => handleFilterChange('path', e.target.value)}
                                size="small"
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={6} lg={2}>
                            <TextField
                                fullWidth
                                type="datetime-local"
                                label="Start Date"
                                value={filters.start_date}
                                onChange={(e) => handleFilterChange('start_date', e.target.value)}
                                size="small"
                                InputLabelProps={{ shrink: true }}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={6} lg={2}>
                            <TextField
                                fullWidth
                                type="datetime-local"
                                label="End Date"
                                value={filters.end_date}
                                onChange={(e) => handleFilterChange('end_date', e.target.value)}
                                size="small"
                                InputLabelProps={{ shrink: true }}
                            />
                        </Grid>
                        <Grid item xs={12} sm={12} md={12} lg={2}>
                            <Box sx={{ display: 'flex', gap: 1, height: '100%', alignItems: 'flex-start' }}>
                                <Button
                                    variant="contained"
                                    onClick={handleApplyFilters}
                                    startIcon={<Icon>search</Icon>}
                                    size="small"
                                    sx={{ minWidth: 'auto', flex: 1 }}
                                >
                                    Apply
                                </Button>
                                <Button
                                    variant="outlined"
                                    onClick={handleClearFilters}
                                    startIcon={<Icon>clear</Icon>}
                                    size="small"
                                    sx={{ minWidth: 'auto', flex: 1 }}
                                >
                                    Clear
                                </Button>
                            </Box>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            {/* Статистика пользователей */}
            {isAdmin && userStats.length > 0 && (
                <Card sx={{ 
                    mb: 3,
                    borderRadius: 2,
                    background: theme => theme.palette.mode === 'light' 
                        ? 'rgba(255, 255, 255, 0.7)'
                        : 'rgba(50, 50, 50, 0.7)',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                }}>
                    <CardContent>
                        <Accordion>
                            <AccordionSummary expandIcon={<Icon>expand_more</Icon>}>
                                <Typography variant="h6">
                                    <Icon sx={{ mr: 1, verticalAlign: 'middle' }}>person</Icon>
                                    User Stats ({userStats.length})
                                </Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <TableContainer>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>User</TableCell>
                                                <TableCell align="right">Requests</TableCell>
                                                <TableCell align="right">Avg Time</TableCell>
                                                <TableCell align="right">Max Time</TableCell>
                                                <TableCell align="right">Active Days</TableCell>
                                                <TableCell>Favorite Category</TableCell>
                                                <TableCell>Favorite Model</TableCell>
                                                <TableCell>First Request</TableCell>
                                                <TableCell>Last Request</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {userStats.slice(0, 10).map((user) => (
                                                <TableRow key={user.user_name}>
                                                    <TableCell>
                                                        <Chip
                                                            label={user.user_name || 'Anonymous'}
                                                            size="small"
                                                            variant="outlined"
                                                        />
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        {parseInt(user.request_count).toLocaleString()}
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        <Chip
                                                            label={`${Math.round(parseFloat(user.avg_response_time))} ms`}
                                                            size="small"
                                                            color={getResponseTimeColor(parseFloat(user.avg_response_time))}
                                                        />
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        {Math.round(parseFloat(user.max_response_time))} ms
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        {user.active_days}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Chip
                                                            label={user.most_used_category || '-'}
                                                            size="small"
                                                            color={getCategoryColor(user.most_used_category)}
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <Typography variant="body2">
                                                            {user.most_used_model || '-'}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        {formatDate(user.first_request)}
                                                    </TableCell>
                                                    <TableCell>
                                                        {formatDate(user.last_request)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </AccordionDetails>
                        </Accordion>
                    </CardContent>
                </Card>
            )}

            {/* Таблица логов */}
            <Card sx={{
                borderRadius: 2,
                background: theme => theme.palette.mode === 'light' 
                    ? 'rgba(255, 255, 255, 0.7)'
                    : 'rgba(50, 50, 50, 0.7)',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
            }}>
                <CardContent>
                    <Typography variant="h6" gutterBottom>
                        <Icon sx={{ mr: 1, verticalAlign: 'middle' }}>list</Icon>
                        Request Logs
                    </Typography>
                    
                    {loading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        <>
                            <TableContainer>
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Time</TableCell>
                                            <TableCell>User</TableCell>
                                            <TableCell>Category</TableCell>
                                            <TableCell>Method</TableCell>
                                            <TableCell>Model</TableCell>
                                            <TableCell>Description</TableCell>
                                            {isAdmin && (
                                                <TableCell>IP Address</TableCell>
                                            )}
                                            <TableCell align="right">Response Time</TableCell>
                                            <TableCell>Actions</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {logs.map((log) => (
                                            <TableRow key={log.id} hover>
                                                <TableCell>
                                                    {formatDate(log.created_at)}
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={log.user_name || 'Anonymous'}
                                                        size="small"
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={log.endpoint_category || 'Other'}
                                                        size="small"
                                                        color={getCategoryColor(log.endpoint_category)}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={log.request_method}
                                                        size="small"
                                                        color={getMethodColor(log.request_method)}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2">
                                                        {log.model_name || '-'}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {log.request_summary || log.request_path}
                                                    </Typography>
                                                </TableCell>
                                                {isAdmin && (
                                                    <TableCell>
                                                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                            {JSON.parse(log.ip_address || '""')}
                                                        </Typography>
                                                    </TableCell>
                                                )}
                                                <TableCell align="right">
                                                    <Chip
                                                        label={`${log.response_time} ms`}
                                                        size="small"
                                                        color={getResponseTimeColor(log.response_time)}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        size="small"
                                                        onClick={() => handleViewDetails(log)}
                                                        startIcon={<Icon>visibility</Icon>}
                                                    >
                                                        Details
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                            
                            {/* Пагинация */}
                            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                                <Pagination
                                    count={totalPages}
                                    page={page}
                                    onChange={(_, newPage) => setPage(newPage)}
                                    color="primary"
                                />
                            </Box>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Диалог деталей */}
            <Dialog
                open={detailsOpen}
                onClose={() => setDetailsOpen(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>
                    Request Details
                </DialogTitle>
                <DialogContent>
                    {selectedLog && (
                        <Grid container spacing={2}>
                            <Grid item xs={12} sm={6}>
                                <Typography variant="subtitle2" gutterBottom>
                                    Main Information
                                </Typography>
                                <Typography variant="body2"><strong>ID:</strong> {selectedLog.id}</Typography>
                                <Typography variant="body2"><strong>Time:</strong> {formatDate(selectedLog.created_at)}</Typography>
                                <Typography variant="body2"><strong>User:</strong> {selectedLog.user_name || 'Anonymous'}</Typography>
                                {isAdmin && selectedLog.api_key_name && (
                                    <Typography variant="body2"><strong>API Key:</strong> {selectedLog.api_key_name}</Typography>
                                )}
                                <Typography variant="body2"><strong>Category:</strong> {selectedLog.endpoint_category || 'Other'}</Typography>
                                <Typography variant="body2"><strong>Method:</strong> {selectedLog.request_method}</Typography>
                                <Typography variant="body2"><strong>Path:</strong> {selectedLog.request_path}</Typography>
                                {selectedLog.model_name && (
                                    <Typography variant="body2"><strong>Model:</strong> {selectedLog.model_name}</Typography>
                                )}
                                <Typography variant="body2"><strong>Description:</strong> {selectedLog.request_summary || 'No description'}</Typography>
                                {selectedLog.user_text && (
                                    <Typography variant="body2"><strong>User Text:</strong> {selectedLog.user_text}</Typography>
                                )}
                                {isAdmin && (
                                    <Typography variant="body2"><strong>IP:</strong> {JSON.parse(selectedLog.ip_address || '""')}</Typography>
                                )}
                                <Typography variant="body2"><strong>Response Time:</strong> {selectedLog.response_time} ms</Typography>
                            </Grid>
                            {isAdmin && selectedLog.request_body && (
                                <Grid item xs={12}>
                                    <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
                                        Request Body
                                    </Typography>
                                    <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                                            {JSON.stringify(selectedLog.request_body, null, 2)}
                                        </Typography>
                                    </Paper>
                                </Grid>
                            )}
                            {isAdmin && selectedLog.response_body && (
                                <Grid item xs={12}>
                                    <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
                                        Response Body
                                    </Typography>
                                    <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.success.main, 0.1) }}>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                                            {JSON.stringify(selectedLog.response_body, null, 2)}
                                        </Typography>
                                    </Paper>
                                </Grid>
                            )}
                        </Grid>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDetailsOpen(false)}>
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
            </Box>
        </Container>
    );
}

// Export component
window.RequestLogs = RequestLogs; 