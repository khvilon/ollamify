// Get dependencies from global scope
const {
    Container,
    Box,
    Typography,
    Button,
    TextField,
    Alert,
    CircularProgress,
    Paper,
    Grid,
    Card,
    CardContent,
    Icon,
    Fade,
    Avatar,
    Divider,
    Tooltip,
    ToggleButton,
    ToggleButtonGroup,
    useTheme,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    LinearProgress
} = window.MaterialUI;

const { useState, useEffect } = window.React;

function Profile() {
    const theme = useTheme();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentTheme, setCurrentTheme] = useState(localStorage.getItem('theme') || 'system');
    const [profile, setProfile] = useState(null);

    const fetchProfile = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/users/profile', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            setProfile(data);
        } catch (err) {
            console.error('Error fetching profile:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProfile();
    }, []);

    const handleThemeChange = (event, newMode) => {
        if (newMode !== null) {
            localStorage.setItem('theme', newMode);
            setCurrentTheme(newMode);
            window.location.reload();
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Never';
        return new Date(dateString).toLocaleString('ru-RU');
    };

    const formatRelativeTime = (dateString) => {
        if (!dateString) return 'Never';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 30) return `${diffDays}d ago`;
        return formatDate(dateString);
    };

    const getMethodColor = (method) => {
        switch (method?.toUpperCase()) {
            case 'GET': return 'info';
            case 'POST': return 'success';
            case 'PUT': return 'warning';
            case 'DELETE': return 'error';
            default: return 'default';
        }
    };

    if (loading) {
        return (
            <Container maxWidth="lg">
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                    <CircularProgress sx={{ color: '#2196F3' }} />
                </Box>
            </Container>
        );
    }

    if (error) {
        return (
            <Container maxWidth="lg">
                <Box sx={{ mt: 4 }}>
                    <Alert severity="error" action={
                        <Button color="inherit" size="small" onClick={fetchProfile}>
                            Retry
                        </Button>
                    }>
                        Error loading profile: {error}
                    </Alert>
                </Box>
            </Container>
        );
    }

    if (!profile) {
        return (
            <Container maxWidth="lg">
                <Box sx={{ mt: 4 }}>
                    <Alert severity="warning">No profile data available</Alert>
                </Box>
            </Container>
        );
    }

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
                        Profile
                    </Typography>
                    <Button 
                        variant="outlined" 
                        startIcon={<Icon>refresh</Icon>}
                        onClick={fetchProfile}
                        sx={{ borderColor: '#2196F3', color: '#2196F3' }}
                    >
                        Refresh
                    </Button>
                </Box>

                <Grid container spacing={4}>
                    {/* Left Column - User Info & Settings */}
                    <Grid item xs={12} md={4}>
                        <Stack spacing={3}>
                            {/* Profile Overview */}
                            <Paper elevation={3} sx={{ 
                                p: 3,
                                borderRadius: 2,
                                backgroundColor: theme.palette.background.paper,
                                color: theme.palette.text.primary
                            }}>
                                <Box sx={{ 
                                    display: 'flex', 
                                    flexDirection: 'column', 
                                    alignItems: 'center',
                                    mb: 3
                                }}>
                                    <Avatar 
                                        sx={{ 
                                            width: 100, 
                                            height: 100,
                                            mb: 2,
                                            background: profile.is_admin 
                                                ? 'linear-gradient(45deg, #FF6B6B 30%, #FF8E53 90%)'
                                                : 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                                            boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)',
                                            fontSize: '2rem'
                                        }}
                                    >
                                        {profile.username ? profile.username[0].toUpperCase() : profile.email[0].toUpperCase()}
                                    </Avatar>
                                    <Typography variant="h6" sx={{ fontWeight: 600, textAlign: 'center' }}>
                                        {profile.username || profile.email}
                                    </Typography>
                                    <Chip 
                                        label={profile.is_admin ? 'Administrator' : 'User'}
                                        color={profile.is_admin ? 'secondary' : 'primary'}
                                        variant="outlined"
                                        sx={{ mt: 1 }}
                                    />
                                </Box>

                                <Divider sx={{ my: 2 }} />

                                <Grid container spacing={2}>
                                    <Grid item xs={12}>
                                        <Typography variant="subtitle2" color="textSecondary">
                                            Email
                                        </Typography>
                                        <Typography variant="body1" sx={{ wordBreak: 'break-word' }}>
                                            {profile.email}
                                        </Typography>
                                    </Grid>
                                    <Grid item xs={12}>
                                        <Typography variant="subtitle2" color="textSecondary">
                                            Member Since
                                        </Typography>
                                        <Typography variant="body1">
                                            {formatDate(profile.created_at)}
                                        </Typography>
                                    </Grid>
                                    <Grid item xs={12}>
                                        <Typography variant="subtitle2" color="textSecondary">
                                            Last Activity
                                        </Typography>
                                        <Typography variant="body1">
                                            {formatRelativeTime(profile.statistics.last_activity)}
                                        </Typography>
                                    </Grid>
                                </Grid>
                            </Paper>

                            {/* Theme Settings */}
                            <Paper elevation={3} sx={{ 
                                p: 3,
                                borderRadius: 2,
                                backgroundColor: theme.palette.background.paper,
                                color: theme.palette.text.primary
                            }}>
                                <Typography variant="h6" gutterBottom sx={{ 
                                    fontWeight: 600,
                                    color: '#1976D2'
                                }}>
                                    Appearance
                                </Typography>
                                <Box sx={{ mt: 2 }}>
                                    <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                                        Theme Mode
                                    </Typography>
                                    <ToggleButtonGroup
                                        value={currentTheme}
                                        exclusive
                                        onChange={handleThemeChange}
                                        aria-label="theme mode"
                                        fullWidth
                                        sx={{
                                            '.MuiToggleButton-root': {
                                                textTransform: 'capitalize',
                                                py: 1
                                            }
                                        }}
                                    >
                                        <ToggleButton value="light" aria-label="light mode">
                                            <Icon sx={{ mr: 1 }}>light_mode</Icon>
                                            Light
                                        </ToggleButton>
                                        <ToggleButton value="system" aria-label="system mode">
                                            <Icon sx={{ mr: 1 }}>computer</Icon>
                                            System
                                        </ToggleButton>
                                        <ToggleButton value="dark" aria-label="dark mode">
                                            <Icon sx={{ mr: 1 }}>dark_mode</Icon>
                                            Dark
                                        </ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                            </Paper>
                        </Stack>
                    </Grid>

                    {/* Right Column - Statistics & Activity */}
                    <Grid item xs={12} md={8}>
                        <Stack spacing={3}>
                            {/* Usage Statistics */}
                            <Paper elevation={3} sx={{ 
                                p: 3,
                                borderRadius: 2,
                                backgroundColor: theme.palette.background.paper,
                                color: theme.palette.text.primary
                            }}>
                                <Typography variant="h6" gutterBottom sx={{ 
                                    fontWeight: 600,
                                    color: '#1976D2'
                                }}>
                                    Usage Statistics
                                </Typography>

                                <Grid container spacing={3}>
                                    <Grid item xs={6} sm={3}>
                                        <Card elevation={2} sx={{
                                            backgroundColor: theme.palette.background.paper,
                                            color: theme.palette.text.primary,
                                            transition: 'transform 0.2s',
                                            '&:hover': { transform: 'translateY(-4px)' }
                                        }}>
                                            <CardContent sx={{ textAlign: 'center', py: 2 }}>
                                                <Icon sx={{ color: '#2196F3', fontSize: '2rem', mb: 1 }}>folder</Icon>
                                                <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
                                                    {profile.statistics.projects_count}
                                                </Typography>
                                                <Typography variant="body2" color="textSecondary">
                                                    Projects
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>

                                    <Grid item xs={6} sm={3}>
                                        <Card elevation={2} sx={{
                                            backgroundColor: theme.palette.background.paper,
                                            color: theme.palette.text.primary,
                                            transition: 'transform 0.2s',
                                            '&:hover': { transform: 'translateY(-4px)' }
                                        }}>
                                            <CardContent sx={{ textAlign: 'center', py: 2 }}>
                                                <Icon sx={{ color: '#4CAF50', fontSize: '2rem', mb: 1 }}>vpn_key</Icon>
                                                <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
                                                    {profile.statistics.api_keys_count}
                                                </Typography>
                                                <Typography variant="body2" color="textSecondary">
                                                    API Keys
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>

                                    <Grid item xs={6} sm={3}>
                                        <Card elevation={2} sx={{
                                            backgroundColor: theme.palette.background.paper,
                                            color: theme.palette.text.primary,
                                            transition: 'transform 0.2s',
                                            '&:hover': { transform: 'translateY(-4px)' }
                                        }}>
                                            <CardContent sx={{ textAlign: 'center', py: 2 }}>
                                                <Icon sx={{ color: '#FF9800', fontSize: '2rem', mb: 1 }}>trending_up</Icon>
                                                <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
                                                    {profile.statistics.requests_last_month}
                                                </Typography>
                                                <Typography variant="body2" color="textSecondary">
                                                    Requests/Month
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>

                                    <Grid item xs={6} sm={3}>
                                        <Card elevation={2} sx={{
                                            backgroundColor: theme.palette.background.paper,
                                            color: theme.palette.text.primary,
                                            transition: 'transform 0.2s',
                                            '&:hover': { transform: 'translateY(-4px)' }
                                        }}>
                                            <CardContent sx={{ textAlign: 'center', py: 2 }}>
                                                <Icon sx={{ color: '#9C27B0', fontSize: '2rem', mb: 1 }}>storage</Icon>
                                                <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
                                                    {profile.statistics.storage_used_mb}
                                                </Typography>
                                                <Typography variant="body2" color="textSecondary">
                                                    MB Used
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                </Grid>

                                <Box sx={{ mt: 3 }}>
                                    <Typography variant="body2" color="textSecondary" gutterBottom>
                                        Total Requests: {profile.statistics.total_requests}
                                    </Typography>
                                    <LinearProgress 
                                        variant="determinate" 
                                        value={Math.min((profile.statistics.requests_last_month / 1000) * 100, 100)}
                                        sx={{ 
                                            height: 8, 
                                            borderRadius: 4,
                                            backgroundColor: theme.palette.grey[200],
                                            '& .MuiLinearProgress-bar': {
                                                backgroundColor: '#2196F3'
                                            }
                                        }}
                                    />
                                    <Typography variant="caption" color="textSecondary">
                                        {profile.statistics.requests_last_month}/1000 requests this month
                                    </Typography>
                                </Box>
                            </Paper>

                            {/* Recent Activity */}
                            <Paper elevation={3} sx={{ 
                                p: 3,
                                borderRadius: 2,
                                backgroundColor: theme.palette.background.paper,
                                color: theme.palette.text.primary
                            }}>
                                <Typography variant="h6" gutterBottom sx={{ 
                                    fontWeight: 600,
                                    color: '#1976D2'
                                }}>
                                    Recent Activity
                                </Typography>

                                {profile.recent_activity && profile.recent_activity.length > 0 ? (
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>Method</TableCell>
                                                    <TableCell>Path</TableCell>
                                                    <TableCell align="right">Response Time</TableCell>
                                                    <TableCell align="right">When</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {profile.recent_activity.map((activity, index) => (
                                                    <TableRow key={index} hover>
                                                        <TableCell>
                                                            <Chip 
                                                                label={activity.request_method} 
                                                                color={getMethodColor(activity.request_method)}
                                                                size="small"
                                                                variant="outlined"
                                                            />
                                                        </TableCell>
                                                        <TableCell sx={{ 
                                                            fontFamily: 'monospace', 
                                                            fontSize: '0.875rem',
                                                            maxWidth: '300px',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis'
                                                        }}>
                                                            {activity.request_path}
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            <Typography variant="body2" color={
                                                                activity.response_time > 1000 ? 'error' :
                                                                activity.response_time > 500 ? 'warning' : 'success'
                                                            }>
                                                                {activity.response_time ? `${activity.response_time}ms` : '-'}
                                                            </Typography>
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            <Typography variant="body2" color="textSecondary">
                                                                {formatRelativeTime(activity.created_at)}
                                                            </Typography>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                ) : (
                                    <Box sx={{ textAlign: 'center', py: 4 }}>
                                        <Icon sx={{ fontSize: '3rem', color: 'grey.400', mb: 2 }}>history</Icon>
                                        <Typography variant="body1" color="textSecondary">
                                            No recent activity found
                                        </Typography>
                                    </Box>
                                )}
                            </Paper>
                        </Stack>
                    </Grid>
                </Grid>
            </Box>
        </Container>
    );
}

// Export for browser environment
window.Profile = Profile;
