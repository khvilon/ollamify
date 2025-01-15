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
    Stack
} = window.MaterialUI;

const { useState, useEffect } = window.React;

function Profile() {
    const theme = useTheme();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentTheme, setCurrentTheme] = useState(localStorage.getItem('theme') || 'system');
    const [user, setUser] = useState({
        email: 'test@example.com',
        role: 'admin',
        created_at: '2023-12-15T21:00:00.000Z',
        last_login: '2023-12-16T00:30:00.000Z',
        usage: {
            documents_count: 42,
            models_count: 7,
            storage_used: '1.2GB'
        }
    });

    const fetchProfile = async () => {
        // В будущем здесь будет реальный API запрос
        setLoading(true);
        try {
            // Имитация задержки сети
            await new Promise(resolve => setTimeout(resolve, 500));
            // Данные уже замоканы в useState
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
            // Force a reload to apply the theme change
            window.location.reload();
        }
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleString();
    };

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
                </Box>

                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                        <CircularProgress sx={{ color: '#2196F3' }} />
                    </Box>
                ) : (
                    <Grid container spacing={4}>
                        {/* Left Column */}
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
                                                background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                                                boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)'
                                            }}
                                        >
                                            {user.email[0].toUpperCase()}
                                        </Avatar>
                                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                                            {user.email}
                                        </Typography>
                                        <Typography 
                                            variant="body2" 
                                            color="textSecondary"
                                            sx={{ 
                                                textTransform: 'capitalize',
                                                mt: 1
                                            }}
                                        >
                                            {user.role}
                                        </Typography>
                                    </Box>

                                    <Divider sx={{ my: 2 }} />

                                    <Grid container spacing={2}>
                                        <Grid item xs={12}>
                                            <Typography variant="subtitle2" color="textSecondary">
                                                Member Since
                                            </Typography>
                                            <Typography variant="body1">
                                                {formatDate(user.created_at)}
                                            </Typography>
                                        </Grid>
                                        <Grid item xs={12}>
                                            <Typography variant="subtitle2" color="textSecondary">
                                                Last Login
                                            </Typography>
                                            <Typography variant="body1">
                                                {formatDate(user.last_login)}
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

                        {/* Right Column - Usage Statistics */}
                        <Grid item xs={12} md={8}>
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
                                    <Grid item xs={12} sm={4}>
                                        <Card elevation={2} sx={{
                                            backgroundColor: theme.palette.background.paper,
                                            color: theme.palette.text.primary,
                                            transition: 'transform 0.2s',
                                            '&:hover': {
                                                transform: 'translateY(-4px)'
                                            }
                                        }}>
                                            <CardContent>
                                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                    <Icon sx={{ color: '#2196F3', mr: 1 }}>description</Icon>
                                                    <Typography color="textSecondary">
                                                        Documents
                                                    </Typography>
                                                </Box>
                                                <Typography variant="h4" sx={{ fontWeight: 600 }}>
                                                    {user.usage.documents_count}
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>

                                    <Grid item xs={12} sm={4}>
                                        <Card elevation={2} sx={{
                                            backgroundColor: theme.palette.background.paper,
                                            color: theme.palette.text.primary,
                                            transition: 'transform 0.2s',
                                            '&:hover': {
                                                transform: 'translateY(-4px)'
                                            }
                                        }}>
                                            <CardContent>
                                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                    <Icon sx={{ color: '#2196F3', mr: 1 }}>model_training</Icon>
                                                    <Typography color="textSecondary">
                                                        Models
                                                    </Typography>
                                                </Box>
                                                <Typography variant="h4" sx={{ fontWeight: 600 }}>
                                                    {user.usage.models_count}
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>

                                    <Grid item xs={12} sm={4}>
                                        <Card elevation={2} sx={{
                                            backgroundColor: theme.palette.background.paper,
                                            color: theme.palette.text.primary,
                                            transition: 'transform 0.2s',
                                            '&:hover': {
                                                transform: 'translateY(-4px)'
                                            }
                                        }}>
                                            <CardContent>
                                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                    <Icon sx={{ color: '#2196F3', mr: 1 }}>storage</Icon>
                                                    <Typography color="textSecondary">
                                                        Storage Used
                                                    </Typography>
                                                </Box>
                                                <Typography variant="h4" sx={{ fontWeight: 600 }}>
                                                    {user.usage.storage_used}
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                </Grid>
                            </Paper>
                        </Grid>
                    </Grid>
                )}

                {error && (
                    <Fade in={true}>
                        <Alert 
                            severity="error" 
                            sx={{ mt: 3 }}
                            onClose={() => setError(null)}
                        >
                            {error}
                        </Alert>
                    </Fade>
                )}
            </Box>
        </Container>
    );
}

// Export for browser environment
window.Profile = Profile;
