// Get dependencies from global scope
const {
    Box,
    Typography,
    Button,
    Alert,
    CircularProgress,
    Paper,
    InputBase,
    styled,
    useTheme
} = window.MaterialUI;

const { useNavigate } = window.ReactRouterDOM;
const { useState, useEffect } = window.React;

const StyledInput = styled(InputBase)(({ theme }) => ({
    '& .MuiInputBase-input': {
        borderRadius: 4,
        backgroundColor: theme.palette.mode === 'light' ? '#fcfcfb' : '#2b2b2b',
        border: '1px solid',
        borderColor: theme.palette.mode === 'light' ? '#E0E3E7' : '#434343',
        fontSize: 16,
        width: '100%',
        padding: '10px 12px',
        transition: theme.transitions.create([
            'border-color',
            'background-color',
            'box-shadow',
        ]),
        '&:focus': {
            boxShadow: `${theme.palette.primary.main} 0 0 0 2px`,
            borderColor: theme.palette.primary.main,
        },
    },
}));

const InputLabel = styled('label')({
    display: 'block',
    marginBottom: 8,
    fontWeight: 500,
    fontSize: '0.875rem',
});

function Login({ onLogin }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [mounted, setMounted] = useState(false);
    const navigate = useNavigate();
    const theme = useTheme();

    useEffect(() => {
        // Если уже есть токен, перенаправляем на Documents
        const token = localStorage.getItem('token');
        if (token) {
            navigate('/documents');
        }
        setMounted(true);
    }, [navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            const response = await fetch('/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }

            // Сохраняем токен
            localStorage.setItem('token', data.token);
            
            // Перенаправляем на Documents
            onLogin(data.token);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (!mounted) {
        return null;
    }

    return (
        <Box sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 3,
            background: theme.palette.mode === 'light' 
                ? 'linear-gradient(45deg, #f3f4f6 30%, #fff 90%)'
                : 'linear-gradient(45deg, #1a1a1a 30%, #2d2d2d 90%)'
        }}>
            <Paper elevation={3} sx={{
                width: '100%',
                maxWidth: 400,
                p: 4,
                borderRadius: 2,
            }}>
                <Typography 
                    variant="h4" 
                    component="h1" 
                    align="center"
                    sx={{ 
                        mb: 1,
                        fontWeight: 700,
                        background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent'
                    }}
                >
                    Welcome Back
                </Typography>
                
                <Typography 
                    variant="body2" 
                    color="textSecondary" 
                    align="center" 
                    sx={{ mb: 4 }}
                >
                    Sign in to continue to Ollamify
                </Typography>

                {error && (
                    <Alert 
                        severity="error" 
                        sx={{ mb: 3 }}
                        onClose={() => setError(null)}
                    >
                        {error}
                    </Alert>
                )}

                <form onSubmit={handleSubmit}>
                    <Box sx={{ mb: 3 }}>
                        <InputLabel htmlFor="email">
                            Email Address
                        </InputLabel>
                        <StyledInput
                            id="email"
                            fullWidth
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                        />
                    </Box>

                    <Box sx={{ mb: 4 }}>
                        <InputLabel htmlFor="password">
                            Password
                        </InputLabel>
                        <StyledInput
                            id="password"
                            fullWidth
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                        />
                    </Box>

                    <Button
                        type="submit"
                        variant="contained"
                        fullWidth
                        disabled={loading}
                        sx={{
                            p: 1.5,
                            background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                            '&:hover': {
                                background: 'linear-gradient(45deg, #1976D2 30%, #1CA7D2 90%)'
                            }
                        }}
                    >
                        {loading ? <CircularProgress size={24} sx={{ color: 'white' }} /> : 'Sign In'}
                    </Button>
                </form>
            </Paper>
        </Box>
    );
}

// Export for browser environment
window.Login = Login;
