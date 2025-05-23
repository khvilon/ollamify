// Get dependencies from global scope
const {
    Box,
    Container,
    Typography,
    Paper,
    Grid,
    Card,
    CardContent,
    Button,
    Chip,
    Divider,
    Alert,
    CircularProgress,
    Tab,
    Tabs,
    IconButton,
    Tooltip,
    Snackbar,
    alpha
} = window.MaterialUI;

const { useState, useEffect } = window.React;
const { useTheme } = window.MaterialUI;

function TabPanel({ children, value, index, ...other }) {
    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`api-tabpanel-${index}`}
            aria-labelledby={`api-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ p: 3 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

function API() {
    const [tabValue, setTabValue] = useState(0);
    const [apiKeys, setApiKeys] = useState([]);
    const [loading, setLoading] = useState(true);
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [snackbarMessage, setSnackbarMessage] = useState('');
    const [iframeHeight, setIframeHeight] = useState('100vh');
    const theme = useTheme();

    useEffect(() => {
        fetchApiKeys();
        
        // Обработчик сообщений от iframe
        const handleMessage = (event) => {
            if (event.data && event.data.type === 'resize') {
                setIframeHeight(`${event.data.height}px`);
            }
        };
        
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Отдельный useEffect для смены темы
    useEffect(() => {
        // При смене темы сброс высоты для пересчета
        setIframeHeight('100vh');
    }, [theme.palette.mode]);

    const fetchApiKeys = async () => {
        try {
            setLoading(true);
            
            // Сначала попробуем получить пользователя из токена
            let user = null;
            const userStr = localStorage.getItem('user');
            const token = localStorage.getItem('token');
            
            if (userStr) {
                user = JSON.parse(userStr);
            } else if (token) {
                // Если пользователя нет, но есть токен, попробуем получить профиль
                try {
                    const profileResponse = await window.api.fetch('/api/users/profile');
                    if (profileResponse && profileResponse.ok) {
                        user = await profileResponse.json();
                        localStorage.setItem('user', JSON.stringify(user));
                    }
                } catch (profileErr) {
                    console.error('Error fetching user profile:', profileErr);
                }
            }
            
            if (!user || !user.id) {
                console.log('No user found, cannot load API keys');
                setApiKeys([]);
                return;
            }
            
            console.log('Loading API keys for user:', user.id);
            const response = await window.api.fetch(`/api/users/${user.id}/api-keys`);
            if (!response) return;
            
            if (!response.ok) {
                throw new Error(`Failed to fetch API keys: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('API keys response:', data);
            setApiKeys(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching API keys:', err);
            setApiKeys([]);
        } finally {
            setLoading(false);
        }
    };

    const handleTabChange = (event, newValue) => {
        setTabValue(newValue);
    };

    const copyToClipboard = (text) => {
        if (!text) {
            setSnackbarMessage('No data to copy');
            setSnackbarOpen(true);
            return;
        }
        
        navigator.clipboard.writeText(text).then(() => {
            setSnackbarMessage('Copied to clipboard');
            setSnackbarOpen(true);
        }).catch(err => {
            console.error('Copy error:', err);
            setSnackbarMessage('Copy error');
            setSnackbarOpen(true);
        });
    };

    const externalEndpoints = [
        {
            title: 'OpenAI Compatible',
            path: '/api/v1/chat/completions',
            method: 'POST',
            description: 'OpenAI compatible endpoint for chat completions',
            badge: 'Compatible',
            color: 'primary'
        },
        {
            title: 'AI & RAG',
            path: '/api/ai/*',
            method: 'POST',
            description: 'AI generation and document search',
            badge: 'RAG',
            color: 'secondary'
        },
        {
            title: 'Documents',
            path: '/api/documents/*',
            method: 'GET/POST/PUT/DELETE',
            description: 'Document management for RAG system',
            badge: 'CRUD',
            color: 'info'
        },
        {
            title: 'Text-to-Speech',
            path: '/api/tts/*',
            method: 'POST',
            description: 'Text-to-speech synthesis',
            badge: 'TTS',
            color: 'success'
        },
        {
            title: 'Speech-to-Text',
            path: '/api/stt/*',
            method: 'POST',
            description: 'Speech-to-text recognition',
            badge: 'STT',
            color: 'warning'
        }
    ];

    const codeExamples = {
        curl: `# RAG запрос (поиск по документам)
curl -X POST "http://localhost/api/ai/rag" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "question": "Что такое машинное обучение?",
    "project": "my-documents",
    "model": "llama3.1:8b",
    "temperature": 0.7
  }'

# OpenAI совместимый запрос
curl -X POST "http://localhost/api/v1/chat/completions" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "llama3.1:8b",
    "messages": [
      {"role": "user", "content": "Привет, как дела?"}
    ],
    "temperature": 0.7,
    "max_tokens": 1000
  }'

# TTS запрос (синтез речи)
curl -X POST "http://localhost/api/tts/synthesize" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "Привет, как дела?",
    "voice": "female_1",
    "language": "ru"
  }'`,
        python: `import requests
import json
import base64

# Настройка заголовков
headers = {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
}

# RAG запрос (поиск по документам)
def ask_question(question, project="my-documents"):
    response = requests.post(
        'http://localhost/api/ai/rag',
        headers=headers,
        json={
            'question': question,
            'project': project,
            'model': 'llama3.1:8b',
            'temperature': 0.7
        }
    )
    return response.json()

# OpenAI совместимый запрос
def chat_completion(messages):
    response = requests.post(
        'http://localhost/api/v1/chat/completions',
        headers=headers,
        json={
            'model': 'llama3.1:8b',
            'messages': messages,
            'temperature': 0.7,
            'max_tokens': 1000
        }
    )
    return response.json()

# TTS запрос (синтез речи)
def text_to_speech(text, voice="female_1"):
    response = requests.post(
        'http://localhost/api/tts/synthesize',
        headers=headers,
        json={
            'text': text,
            'voice': voice,
            'language': 'ru'
        }
    )
    
    if response.ok:
        data = response.json()
        # Декодируем base64 аудио
        audio_data = base64.b64decode(data['audio_base64'])
        with open('speech.wav', 'wb') as f:
            f.write(audio_data)
        return "Аудио сохранено как speech.wav"
    return response.json()

# Примеры использования
print(ask_question("Что такое нейронные сети?"))
print(chat_completion([{"role": "user", "content": "Привет!"}]))
print(text_to_speech("Это тестовое сообщение"))`,
        javascript: `// Настройка заголовков
const headers = {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
};

// RAG запрос (поиск по документам)
async function askQuestion(question, project = "my-documents") {
    const response = await fetch('http://localhost/api/ai/rag', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            question,
            project,
            model: 'llama3.1:8b',
            temperature: 0.7
        })
    });
    return await response.json();
}

// OpenAI совместимый запрос
async function chatCompletion(messages) {
    const response = await fetch('http://localhost/api/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: 'llama3.1:8b',
            messages,
            temperature: 0.7,
            max_tokens: 1000
        })
    });
    return await response.json();
}

// TTS запрос (синтез речи)
async function textToSpeech(text, voice = "female_1") {
    const response = await fetch('http://localhost/api/tts/synthesize', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            text,
            voice,
            language: 'ru'
        })
    });
    
    if (response.ok) {
        const data = await response.json();
        // Создаем аудио элемент для воспроизведения
        const audio = new Audio();
        audio.src = \`data:audio/wav;base64,\${data.audio_base64}\`;
        return audio; // Можно вызвать audio.play()
    }
    return await response.json();
}

// Примеры использования
(async () => {
    try {
        const ragResult = await askQuestion("Что такое нейронные сети?");
        console.log("RAG ответ:", ragResult);
        
        const chatResult = await chatCompletion([
            { role: "user", content: "Привет!" }
        ]);
        console.log("Chat ответ:", chatResult);
        
        const audioElement = await textToSpeech("Это тестовое сообщение");
        if (audioElement instanceof Audio) {
            audioElement.play(); // Воспроизводим синтезированную речь
        }
    } catch (error) {
        console.error("Ошибка:", error);
    }
})();`
    };

    return (
        <Container maxWidth="lg">
            <Box sx={{ py: 4 }}>
                {/* Заголовок */}
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
                        API Documentation
                    </Typography>
                </Box>

                {/* Вкладки */}
                <Paper sx={{ mb: 3 }}>
                    <Tabs 
                        value={tabValue} 
                        onChange={handleTabChange}
                        sx={{ borderBottom: 1, borderColor: 'divider' }}
                    >
                        <Tab label="API Overview" />
                        <Tab label="My API Keys" />
                        <Tab label="Code Examples" />
                        <Tab label="Swagger Docs" />
                    </Tabs>
                </Paper>

                {/* Вкладка: Обзор API */}
                <TabPanel value={tabValue} index={0}>
                    <Alert severity="info" sx={{ mb: 3 }}>
                        <strong>Note:</strong> All external API endpoints require authentication via API key.
                        Pass the key in header: <code>Authorization: Bearer YOUR_API_KEY</code>
                    </Alert>

                    <Typography variant="h5" gutterBottom sx={{ mb: 3 }}>
                        Available endpoints
                    </Typography>

                    <Grid container spacing={3}>
                        {externalEndpoints.map((endpoint, index) => (
                            <Grid item xs={12} md={6} key={index}>
                                <Card sx={{ 
                                    h: '100%',
                                    borderRadius: 2,
                                    background: theme => theme.palette.mode === 'light' 
                                        ? 'rgba(255, 255, 255, 0.7)'
                                        : 'rgba(50, 50, 50, 0.7)',
                                    backdropFilter: 'blur(10px)',
                                    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                }}>
                                    <CardContent>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                                            <Typography variant="h6" component="h3">
                                                {endpoint.title}
                                            </Typography>
                                            <Chip 
                                                label={endpoint.badge} 
                                                color={endpoint.color} 
                                                size="small" 
                                            />
                                        </Box>
                                        
                                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                            {endpoint.description}
                                        </Typography>

                                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                            <Chip 
                                                label={endpoint.method} 
                                                variant="outlined" 
                                                size="small" 
                                                sx={{ mr: 1 }}
                                            />
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {endpoint.path}
                                            </Typography>
                                        </Box>
                                    </CardContent>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>

                    <Box sx={{ mt: 4 }}>
                        <Typography variant="h6" gutterBottom>
                            General characteristics
                        </Typography>
                        <Grid container spacing={2}>
                            <Grid item xs={12} sm={6} md={3}>
                                <Paper sx={{ 
                                    p: 2, 
                                    textAlign: 'center',
                                    borderRadius: 2,
                                    background: theme => theme.palette.mode === 'light' 
                                        ? 'rgba(255, 255, 255, 0.7)'
                                        : 'rgba(50, 50, 50, 0.7)',
                                    backdropFilter: 'blur(10px)',
                                    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                }}>
                                    <Typography variant="h4" color="primary">50MB</Typography>
                                    <Typography variant="body2">Max file size</Typography>
                                </Paper>
                            </Grid>
                            <Grid item xs={12} sm={6} md={3}>
                                <Paper sx={{ 
                                    p: 2, 
                                    textAlign: 'center',
                                    borderRadius: 2,
                                    background: theme => theme.palette.mode === 'light' 
                                        ? 'rgba(255, 255, 255, 0.7)'
                                        : 'rgba(50, 50, 50, 0.7)',
                                    backdropFilter: 'blur(10px)',
                                    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                }}>
                                    <Typography variant="h4" color="primary">10 min</Typography>
                                    <Typography variant="body2">Request timeout</Typography>
                                </Paper>
                            </Grid>
                            <Grid item xs={12} sm={6} md={3}>
                                <Paper sx={{ 
                                    p: 2, 
                                    textAlign: 'center',
                                    borderRadius: 2,
                                    background: theme => theme.palette.mode === 'light' 
                                        ? 'rgba(255, 255, 255, 0.7)'
                                        : 'rgba(50, 50, 50, 0.7)',
                                    backdropFilter: 'blur(10px)',
                                    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                }}>
                                    <Typography variant="h4" color="primary">JSON</Typography>
                                    <Typography variant="body2">Data format</Typography>
                                </Paper>
                            </Grid>
                            <Grid item xs={12} sm={6} md={3}>
                                <Paper sx={{ 
                                    p: 2, 
                                    textAlign: 'center',
                                    borderRadius: 2,
                                    background: theme => theme.palette.mode === 'light' 
                                        ? 'rgba(255, 255, 255, 0.7)'
                                        : 'rgba(50, 50, 50, 0.7)',
                                    backdropFilter: 'blur(10px)',
                                    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                }}>
                                    <Typography variant="h4" color="primary">HTTPS</Typography>
                                    <Typography variant="body2">Security</Typography>
                                </Paper>
                            </Grid>
                        </Grid>
                    </Box>
                </TabPanel>

                {/* Вкладка: API ключи */}
                <TabPanel value={tabValue} index={1}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                        <Typography variant="h5">
                            My API Keys
                        </Typography>
                        <Button
                            variant="contained"
                            startIcon={<span className="material-icons">vpn_key</span>}
                            onClick={() => window.location.href = '/users'}
                        >
                            Manage Keys
                        </Button>
                    </Box>

                    {loading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    ) : apiKeys.length === 0 ? (
                        <Alert severity="warning">
                            You don't have any API keys yet. Go to "Users" section to create a key.
                        </Alert>
                    ) : (
                        <Grid container spacing={2}>
                            {apiKeys.map((key, index) => (
                                <Grid item xs={12} key={key.id}>
                                    <Card sx={{
                                        borderRadius: 2,
                                        background: theme => theme.palette.mode === 'light' 
                                            ? 'rgba(255, 255, 255, 0.7)'
                                            : 'rgba(50, 50, 50, 0.7)',
                                        backdropFilter: 'blur(10px)',
                                        boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                    }}>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Box>
                                                    <Typography variant="h6">
                                                        {key.name}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Created: {new Date(key.created_at).toLocaleDateString('ru-RU')}
                                                    </Typography>
                                                    <Box sx={{ mt: 1, display: 'flex', alignItems: 'center' }}>
                                                        <Typography 
                                                            variant="body2" 
                                                            sx={{ 
                                                                fontFamily: 'monospace', 
                                                                backgroundColor: (theme) => 
                                                                    theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                                                                color: (theme) => 
                                                                    theme.palette.mode === 'dark' ? 'grey.100' : 'grey.800',
                                                                p: 1.5,
                                                                borderRadius: 1,
                                                                mr: 1,
                                                                minWidth: '300px',
                                                                wordBreak: 'break-all',
                                                                border: '1px solid',
                                                                borderColor: (theme) => 
                                                                    theme.palette.mode === 'dark' ? 'grey.600' : 'grey.400'
                                                            }}
                                                        >
                                                            {key.key_value ? `${key.key_value.substring(0, 12)}...${key.key_value.slice(-12)}` : 'Hidden'}
                                                        </Typography>
                                                        <Tooltip title="Copy key">
                                                            <IconButton 
                                                                size="small" 
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    copyToClipboard(key.key_value);
                                                                }}
                                                                sx={{ 
                                                                    backgroundColor: 'primary.main',
                                                                    color: 'white',
                                                                    '&:hover': {
                                                                        backgroundColor: 'primary.dark'
                                                                    }
                                                                }}
                                                            >
                                                                <span className="material-icons">content_copy</span>
                                                            </IconButton>
                                                        </Tooltip>
                                                    </Box>
                                                </Box>
                                                <Chip 
                                                    icon={<span className="material-icons">check_circle</span>}
                                                    label="Active" 
                                                    color="success" 
                                                    variant="outlined" 
                                                />
                                            </Box>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                    )}
                </TabPanel>

                {/* Вкладка: Примеры кода */}
                <TabPanel value={tabValue} index={2}>
                    <Typography variant="h5" gutterBottom>
                        Usage Examples
                    </Typography>

                    <Grid container spacing={3}>
                        <Grid item xs={12} md={4}>
                            <Card sx={{
                                borderRadius: 2,
                                background: theme => theme.palette.mode === 'light' 
                                    ? 'rgba(255, 255, 255, 0.7)'
                                    : 'rgba(50, 50, 50, 0.7)',
                                backdropFilter: 'blur(10px)',
                                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                            }}>
                                <CardContent>
                                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                        <span className="material-icons" style={{ fontSize: 20, marginRight: 10 }}>code</span>
                                        <Typography variant="h6">cURL</Typography>
                                        <IconButton 
                                            size="small" 
                                            sx={{ ml: 'auto' }}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                copyToClipboard(codeExamples.curl);
                                            }}
                                        >
                                            <span className="material-icons">content_copy</span>
                                        </IconButton>
                                    </Box>
                                    <Paper sx={{ 
                                        p: 2, 
                                        borderRadius: 2,
                                        backgroundColor: (theme) => 
                                            theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                                        border: (theme) => 
                                            theme.palette.mode === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)'
                                    }}>
                                        <Typography 
                                            variant="body2" 
                                            component="pre" 
                                            sx={{ 
                                                fontSize: '0.75rem',
                                                whiteSpace: 'pre-wrap',
                                                fontFamily: 'monospace',
                                                color: (theme) => 
                                                    theme.palette.mode === 'dark' ? 'grey.100' : 'grey.800',
                                                margin: 0,
                                                lineHeight: 1.4
                                            }}
                                        >
                                            {codeExamples.curl}
                                        </Typography>
                                    </Paper>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid item xs={12} md={4}>
                            <Card sx={{
                                borderRadius: 2,
                                background: theme => theme.palette.mode === 'light' 
                                    ? 'rgba(255, 255, 255, 0.7)'
                                    : 'rgba(50, 50, 50, 0.7)',
                                backdropFilter: 'blur(10px)',
                                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                            }}>
                                <CardContent>
                                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                        <span className="material-icons" style={{ fontSize: 20, marginRight: 10 }}>code</span>
                                        <Typography variant="h6">Python</Typography>
                                        <IconButton 
                                            size="small" 
                                            sx={{ ml: 'auto' }}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                copyToClipboard(codeExamples.python);
                                            }}
                                        >
                                            <span className="material-icons">content_copy</span>
                                        </IconButton>
                                    </Box>
                                    <Paper sx={{ 
                                        p: 2, 
                                        borderRadius: 2,
                                        backgroundColor: (theme) => 
                                            theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                                        border: (theme) => 
                                            theme.palette.mode === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)'
                                    }}>
                                        <Typography 
                                            variant="body2" 
                                            component="pre" 
                                            sx={{ 
                                                fontSize: '0.75rem',
                                                whiteSpace: 'pre-wrap',
                                                fontFamily: 'monospace',
                                                color: (theme) => 
                                                    theme.palette.mode === 'dark' ? 'grey.100' : 'grey.800',
                                                margin: 0,
                                                lineHeight: 1.4
                                            }}
                                        >
                                            {codeExamples.python}
                                        </Typography>
                                    </Paper>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid item xs={12} md={4}>
                            <Card sx={{
                                borderRadius: 2,
                                background: theme => theme.palette.mode === 'light' 
                                    ? 'rgba(255, 255, 255, 0.7)'
                                    : 'rgba(50, 50, 50, 0.7)',
                                backdropFilter: 'blur(10px)',
                                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                            }}>
                                <CardContent>
                                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                        <span className="material-icons" style={{ fontSize: 20, marginRight: 10 }}>code</span>
                                        <Typography variant="h6">JavaScript</Typography>
                                        <IconButton 
                                            size="small" 
                                            sx={{ ml: 'auto' }}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                copyToClipboard(codeExamples.javascript);
                                            }}
                                        >
                                            <span className="material-icons">content_copy</span>
                                        </IconButton>
                                    </Box>
                                    <Paper sx={{ 
                                        p: 2, 
                                        borderRadius: 2,
                                        backgroundColor: (theme) => 
                                            theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                                        border: (theme) => 
                                            theme.palette.mode === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)'
                                    }}>
                                        <Typography 
                                            variant="body2" 
                                            component="pre" 
                                            sx={{ 
                                                fontSize: '0.75rem',
                                                whiteSpace: 'pre-wrap',
                                                fontFamily: 'monospace',
                                                color: (theme) => 
                                                    theme.palette.mode === 'dark' ? 'grey.100' : 'grey.800',
                                                margin: 0,
                                                lineHeight: 1.4
                                            }}
                                        >
                                            {codeExamples.javascript}
                                        </Typography>
                                    </Paper>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>
                </TabPanel>

                {/* Вкладка: Swagger Docs */}
                <TabPanel value={tabValue} index={3}>
                    <Typography variant="h5" gutterBottom sx={{ mb: 2 }}>
                        Interactive API Documentation
                    </Typography>
                    
                    <Alert severity="info" sx={{ mb: 3 }}>
                        <strong>Swagger UI</strong> allows you to test API endpoints directly in the browser.
                        Use the "Authorize" button and insert your API key for testing.
                    </Alert>

                    <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
                        <Button
                            variant="outlined"
                            onClick={() => window.open(`/api/docs?theme=${theme.palette.mode}`, '_blank')}
                            startIcon={<span className="material-icons">open_in_new</span>}
                        >
                            Open in new tab
                        </Button>
                    </Box>

                    {/* Встроенный Swagger UI */}
                    <Paper sx={{ 
                        minHeight: iframeHeight,
                        overflow: 'hidden',
                        borderRadius: 2,
                        background: theme => theme.palette.mode === 'light' 
                            ? 'rgba(255, 255, 255, 0.7)'
                            : 'rgba(50, 50, 50, 0.7)',
                        backdropFilter: 'blur(10px)',
                        boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                    }}>
                        <iframe
                            src={`/api/docs?theme=${theme.palette.mode}`}
                            style={{
                                width: '100%',
                                height: iframeHeight,
                                border: 'none',
                                display: 'block'
                            }}
                            title="Swagger API Documentation"
                            scrolling="no"
                        />
                    </Paper>
                </TabPanel>
            </Box>

            {/* Snackbar для уведомлений */}
            <Snackbar
                open={snackbarOpen}
                autoHideDuration={3000}
                onClose={() => setSnackbarOpen(false)}
                message={snackbarMessage}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                sx={{
                    position: 'fixed',
                    zIndex: 9999,
                    '& .MuiSnackbarContent-root': {
                        backgroundColor: 'success.main',
                        color: 'white'
                    }
                }}
            />
        </Container>
    );
}

// Export for browser environment
window.API = API; 