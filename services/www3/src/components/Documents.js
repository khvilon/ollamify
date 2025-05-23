// Get dependencies from global scope
const {
    Container,
    Box,
    Typography,
    Button,
    Grid,
    TextField,
    Alert,
    CircularProgress,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    IconButton,
    Icon,
    Paper,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Fade,
    Tooltip,
    Divider,
    Card,
    CardContent,
    Stack,
    useTheme,
    alpha,
    LinearProgress,
    TableContainer,
    Table,
    TableHead,
    TableRow,
    TableCell,
    TableSortLabel,
    TableBody,
    TablePagination,
    Autocomplete
} = window.MaterialUI;

const { useState, useEffect, useRef, useCallback } = window.React;
const { useNavigate } = window.ReactRouterDOM;

function Documents() {
    const navigate = useNavigate();
    const [documents, setDocuments] = useState([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [orderBy, setOrderBy] = useState('created_at');
    const [order, setOrder] = useState('desc');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [projects, setProjects] = useState([]);
    const [project, setProject] = useState('');
    const [projectFilter, setProjectFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [uploadType, setUploadType] = useState('file');
    const [textContent, setTextContent] = useState('');
    const [customName, setCustomName] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const fileInputRef = useRef(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [documentToDelete, setDocumentToDelete] = useState(null);
    
    // Ссылка на WebSocket соединение
    const socketRef = useRef(null);

    const theme = useTheme();

    // Функция для подключения к WebSocket
    const connectWebSocket = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const socket = new WebSocket(`${protocol}//${host}/ws/documents`);
        
        socket.addEventListener('open', () => {
            console.log('WebSocket connected for documents');
        });
        
        socket.addEventListener('message', (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket message:', data);
                
                if (data.type === 'document_update' && data.document) {
                    const updatedDoc = data.document;
                    
                    // Обновляем документ в списке, если он там есть
                    setDocuments(prevDocs => {
                        // Если документ уже есть, обновляем его
                        const docIndex = prevDocs.findIndex(d => 
                            d.id === updatedDoc.id && d.project === updatedDoc.project
                        );
                        
                        if (docIndex >= 0) {
                            const newDocs = [...prevDocs];
                            newDocs[docIndex] = {
                                ...newDocs[docIndex],
                                ...updatedDoc
                            };
                            return newDocs;
                        } 
                        
                        // Если документа нет и он соответствует текущему проекту, добавляем его
                        if (!project || updatedDoc.project === project) {
                            if (prevDocs.length < rowsPerPage) {
                                return [...prevDocs, updatedDoc];
                            }
                        }
                        
                        return prevDocs;
                    });
                    
                    // Если документ был завершен, обновляем список для актуальности
                    if (updatedDoc.loaded_chunks === updatedDoc.total_chunks) {
                        // Задержка, чтобы пользователь видел 100%
                        setTimeout(() => {
                            fetchDocuments(project);
                        }, 1000);
                    }
                }
            } catch (err) {
                console.error('Error parsing WebSocket message:', err);
            }
        });
        
        socket.addEventListener('close', () => {
            console.log('WebSocket connection closed for documents');
            // Попытка переподключения через 2 секунды
            setTimeout(() => {
                connectWebSocket();
            }, 2000);
        });
        
        socket.addEventListener('error', (error) => {
            console.error('WebSocket error:', error);
        });
        
        socketRef.current = socket;
    }, [project, rowsPerPage]);

    useEffect(() => {
        // Загрузка списка проектов
        const fetchProjects = async () => {
            try {
                const response = await window.api.fetch('/api/projects');
                if (!response.ok) throw new Error('Failed to fetch projects');
                const data = await response.json();
                setProjects(Array.isArray(data) ? data : []);
            } catch (err) {
                console.error('Error fetching projects:', err);
                setError(err.message);
            }
        };

        fetchProjects();
        
        // Устанавливаем WebSocket соединение
        connectWebSocket();
        
        // Очистка при размонтировании
        return () => {
            if (socketRef.current) {
                socketRef.current.close();
            }
        };
    }, [connectWebSocket]);

    const handleDelete = async (docId, docProject) => {
        try {
            setLoading(true);
            const response = await window.api.fetch(
                `/api/documents/${docId}?project=${encodeURIComponent(docProject)}`,
                { method: 'DELETE' }
            );
            
            if (!response) return; // Был редирект на логин
            if (!response.ok) throw new Error('Failed to delete document');
            
            // Обновляем список документов
            await fetchDocuments(project);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Проверяем аутентификацию при монтировании
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) {
            navigate('/login');
        }
    }, [navigate]);

    const handleProjectCreate = async (projectName) => {
        try {
            const response = await window.api.fetch('/api/projects', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: projectName,
                })
            });
            
            if (!response.ok) throw new Error('Failed to create project');
            const data = await response.json();
            setProjects(prev => [...prev, data.project]);
            setProject(data.project.name);
            return data.project;
        } catch (err) {
            console.error('Error creating project:', err);
            throw err;
        }
    };

    const fetchDocuments = async (selectedProject = '') => {
        try {
                setLoading(true);
            
            const timestamp = Date.now();
            const params = new URLSearchParams({
                page: page + 1,
                limit: rowsPerPage,
                order_by: orderBy,
                order: order,
                t: timestamp
            });
            
            if (selectedProject) {
                params.append('project', selectedProject);
            }
            
            // Добавляем параметры поиска и фильтрации
            if (searchQuery) {
                params.append('search', searchQuery);
            }
            if (projectFilter) {
                params.append('project_filter', projectFilter);
            }
            
            const url = `/api/documents?${params.toString()}`;
            const response = await window.api.fetch(url);
            
            if (!response) return; // Был редирект на логин
            
            if (!response.ok) throw new Error('Failed to fetch documents');
            const data = await response.json();

            setDocuments(data.documents);
            setTotal(data.total);
            setTotalPages(data.total_pages);
            setError('');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Обновляем эффект для обновления при изменении фильтров
    useEffect(() => {
        fetchDocuments(project);
    }, [project, page, rowsPerPage, orderBy, order, searchQuery, projectFilter]);

    const handleUpload = async (e) => {
        e.preventDefault();
        
        if (!project) {
            setError('Please select a project first');
            return;
        }

        try {
            setLoading(true);
            setError('');

            let data;
            if (uploadType === 'file' && selectedFile) {
                const formData = new FormData();
                formData.append('file', selectedFile);
                formData.append('project', project);
                
                const uploadResponse = await window.api.fetch('/api/documents', {
                    method: 'POST',
                    body: formData
                });
                
                if (!uploadResponse.ok) {
                    const error = await uploadResponse.json();
                    throw new Error(error.message || 'Failed to upload document');
                }
                
                data = await uploadResponse.json();
            } else if (uploadType === 'text' && textContent) {
                const response = await window.api.fetch('/api/documents', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        content: textContent,
                        project
                    })
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.message || 'Failed to upload document');
                }
                
                data = await response.json();
            } else {
                throw new Error('No content to upload');
            }
            
            // Очищаем форму
            setSelectedFile(null);
            setTextContent('');
            
            // Обновляем список документов
            await fetchDocuments(project);
        } catch (err) {
            console.error('Upload error:', err);
            setError(err.message || 'Failed to upload document');
        } finally {
            setLoading(false);
        }
    };

    const handleSort = (property) => {
        const isAsc = orderBy === property && order === 'asc';
        setOrder(isAsc ? 'desc' : 'asc');
        setOrderBy(property);
        setPage(0);
    };

    const filteredDocuments = documents
        .filter(doc => !projectFilter || doc.project === projectFilter)
        .filter(doc => !searchQuery || doc.name.toLowerCase().includes(searchQuery.toLowerCase()));

    const sortedDocuments = [...filteredDocuments].sort((a, b) => {
        if (orderBy === 'created_at') {
            return order === 'asc' 
                ? new Date(a.created_at) - new Date(b.created_at)
                : new Date(b.created_at) - new Date(a.created_at);
        }
        if (orderBy === 'name') {
            return order === 'asc'
                ? a.name.localeCompare(b.name)
                : b.name.localeCompare(a.name);
        }
        if (orderBy === 'project') {
            return order === 'asc'
                ? a.project.localeCompare(b.project)
                : b.project.localeCompare(a.project);
        }
        return 0;
    });

    const handleChangePage = (event, newPage) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
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
                        Documents
                    </Typography>
                </Box>

                {error && (
                    <Fade in={true}>
                        <Alert 
                            severity="error" 
                            sx={{ mb: 4 }}
                            onClose={() => setError(null)}
                        >
                            {error}
                        </Alert>
                    </Fade>
                )}

                <Grid container spacing={4}>
                    {/* Left side - Upload Form */}
                    <Grid item xs={12} md={4}>
                        <Box sx={{ 
                            height: '100%',
                            position: 'relative',
                            zIndex: 1
                        }}>
                            <Paper sx={{ 
                                p: 4,
                                borderRadius: 2,
                                background: theme => theme.palette.mode === 'light' 
                                    ? 'rgba(255, 255, 255, 0.7)'
                                    : 'rgba(50, 50, 50, 0.7)',
                                backdropFilter: 'blur(10px)',
                                boxShadow: theme => theme.palette.mode === 'light'
                                    ? '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                    : '0 6px 20px 0 rgba(8, 8, 15, 0.35)'
                            }}>
                                <Typography variant="h6" sx={{ 
                                    fontWeight: 600,
                                    height: 32,
                                    display: 'flex',
                                    alignItems: 'center',
                                    mb: 3
                                }}>
                                    Upload Document
                                </Typography>
                                <form onSubmit={handleUpload}>
                                    <Stack spacing={3}>
                                        <Autocomplete
                                            fullWidth
                                            value={project ? projects.find(p => p.name === project) : null}
                                            onChange={(event, newValue) => {
                                                setProject(newValue?.name || null);
                                            }}
                                            options={projects}
                                            getOptionLabel={(option) => option?.name || ''}
                                            isOptionEqualToValue={(option, value) => option?.name === value?.name}
                                            renderInput={(params) => (
                                                <TextField
                                                    {...params}
                                                    label="Project"
                                                    required
                                                    error={!project}
                                                    helperText={!project ? "Please select a project" : ""}
                                                />
                                            )}
                                            renderOption={(props, option) => (
                                                <li {...props}>
                                                    <Stack>
                                                        <Typography variant="body1">
                                                            {option.name}
                                                        </Typography>
                                                        {option.embedding_model && (
                                                            <Typography variant="caption" color="textSecondary">
                                                                Model: {option.embedding_model}
                                                            </Typography>
                                                        )}
                                                    </Stack>
                                                </li>
                                            )}
                                        />

                                        {/* Отображение модели выбранного проекта */}
                                        {project && (
                                            <TextField
                                                fullWidth
                                                label="Embedding Model"
                                                value={projects.find(p => p.name === project)?.embedding_model || ''}
                                                InputProps={{
                                                    readOnly: true,
                                                    startAdornment: (
                                                        <Icon sx={{ color: 'action.active', mr: 1 }}>
                                                            model_training
                                                        </Icon>
                                                    )
                                                }}
                                                variant="outlined"
                                                helperText="Model is determined by project settings"
                                            />
                                        )}

                                        <FormControl fullWidth variant="outlined">
                                            <InputLabel>Upload Type</InputLabel>
                                            <Select
                                                value={uploadType}
                                                onChange={(e) => setUploadType(e.target.value)}
                                                label="Upload Type"
                                            >
                                                <MenuItem value="file">File Upload</MenuItem>
                                                <MenuItem value="text">Text Input</MenuItem>
                                            </Select>
                                        </FormControl>

                                        {uploadType === 'file' ? (
                                            <Box
                                                sx={{
                                                    border: '2px dashed',
                                                    borderColor: 'divider',
                                                    borderRadius: 1,
                                                    p: 3,
                                                    textAlign: 'center',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s ease-in-out',
                                                    '&:hover': {
                                                        borderColor: 'primary.main',
                                                        bgcolor: 'action.hover'
                                                    }
                                                }}
                                                onClick={() => fileInputRef.current?.click()}
                                            >
                                                <input
                                                    type="file"
                                                    ref={fileInputRef}
                                                    style={{ display: 'none' }}
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            // Проверяем тип файла
                                                            const fileType = file.name.split('.').pop()?.toLowerCase();
                                                            const allowedTypes = ['txt', 'pdf', 'doc', 'docx'];
                                                            
                                                            if (!allowedTypes.includes(fileType)) {
                                                                setError(`Unsupported file type. Allowed types: ${allowedTypes.join(', ')}`);
                                                                return;
                                                            }
                                                            
                                                            setSelectedFile(file);
                                                            setError('');
                                                        }
                                                    }}
                                                    accept=".txt,.pdf,.doc,.docx"
                                                />
                                                <Icon sx={{ fontSize: 40, color: 'action.active', mb: 1 }}>upload_file</Icon>
                                                <Typography variant="body1" gutterBottom>
                                                    {selectedFile ? selectedFile.name : 'Click to select a file'}
                                                </Typography>
                                                <Typography variant="caption" color="textSecondary">
                                                    {selectedFile 
                                                        ? 'Click to change file'
                                                        : 'Supported formats: TXT, PDF, DOC, DOCX'}
                                                </Typography>
                                                {selectedFile && (
                                                    <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <Icon sx={{ color: 'success.main', mr: 0.5 }}>check_circle</Icon>
                                                        <Typography variant="caption" color="success.main">
                                                            File selected
                                                        </Typography>
                                                    </Box>
                                                )}
                                            </Box>
                                        ) : (
                                            <TextField
                                                fullWidth
                                                label="Content"
                                                multiline
                                                rows={4}
                                                value={textContent}
                                                onChange={(e) => setTextContent(e.target.value)}
                                                variant="outlined"
                                            />
                                        )}

                                        <Button
                                            type="submit"
                                            variant="contained"
                                            disabled={loading}
                                            sx={{
                                                background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                                                color: 'white',
                                                '&:hover': {
                                                    background: 'linear-gradient(45deg, #1976D2 30%, #1CA7D2 90%)'
                                                }
                                            }}
                                        >
                                            {loading ? <CircularProgress size={24} /> : 'Upload'}
                                        </Button>
                                    </Stack>
                                </form>
                            </Paper>
                        </Box>
                    </Grid>

                    {/* Right side - Documents List */}
                    <Grid item xs={12} md={8}>
                        <Box sx={{ 
                            height: '100%',
                            position: 'relative',
                            zIndex: 1
                        }}>
                            <Paper sx={{ 
                                p: 4,
                                borderRadius: 2,
                                background: theme => theme.palette.mode === 'light' 
                                    ? 'rgba(255, 255, 255, 0.7)'
                                    : 'rgba(50, 50, 50, 0.7)',
                                backdropFilter: 'blur(10px)',
                                boxShadow: theme => theme.palette.mode === 'light'
                                    ? '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                                    : '0 6px 20px 0 rgba(8, 8, 15, 0.35)'
                            }}>
                                <Typography variant="h6" sx={{ 
                                    fontWeight: 600,
                                    height: 32,
                                    display: 'flex',
                                    alignItems: 'center',
                                    mb: 3
                                }}>
                                    Documents List
                                </Typography>
                                <Box sx={{ mb: 2 }}>
                                    <Grid container spacing={2}>
                                        <Grid item xs={12} md={6}>
                                            <TextField
                                                fullWidth
                                                label="Search by name"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                size="small"
                                            />
                                        </Grid>
                                        <Grid item xs={12} md={6}>
                                            <FormControl fullWidth size="small">
                                                <InputLabel>Filter by project</InputLabel>
                                                <Select
                                                    value={projectFilter}
                                                    label="Filter by project"
                                                    onChange={(e) => setProjectFilter(e.target.value)}
                                                >
                                                    <MenuItem value="">
                                                        <em>All projects</em>
                                                    </MenuItem>
                                                    {[...new Set(documents.map(doc => doc.project))].map(proj => (
                                                        <MenuItem key={proj} value={proj}>{proj}</MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        </Grid>
                                    </Grid>
                                </Box>
                                    
                                {loading && documents.length === 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                                        <CircularProgress />
                                    </Box>
                                ) : documents.length === 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                                        <Typography color="text.secondary">
                                            No documents found
                                        </Typography>
                                    </Box>
                                ) : (
                                    <>
                                        <TableContainer>
                                            <Table>
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell>
                                                            <TableSortLabel
                                                                active={orderBy === 'name'}
                                                                direction={orderBy === 'name' ? order : 'asc'}
                                                                onClick={() => handleSort('name')}
                                                            >
                                                                Name
                                                            </TableSortLabel>
                                                        </TableCell>
                                                        <TableCell>Project</TableCell>
                                                        <TableCell>
                                                            <TableSortLabel
                                                                active={orderBy === 'total_chunks'}
                                                                direction={orderBy === 'total_chunks' ? order : 'asc'}
                                                                onClick={() => handleSort('total_chunks')}
                                                            >
                                                                Chunks
                                                            </TableSortLabel>
                                                        </TableCell>
                                                        <TableCell>
                                                            <TableSortLabel
                                                                active={orderBy === 'created_at'}
                                                                direction={orderBy === 'created_at' ? order : 'asc'}
                                                                onClick={() => handleSort('created_at')}
                                                            >
                                                                Created
                                                            </TableSortLabel>
                                                        </TableCell>
                                                        <TableCell align="right">Actions</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {documents.map((doc) => (
                                                            <TableRow 
                                                            key={`${doc.project}-${doc.id}`}
                                                                sx={{
                                                                    transition: 'all 0.2s ease-in-out',
                                                                    '&:hover': {
                                                                        backgroundColor: 'action.hover',
                                                                        transform: 'translateY(-2px)',
                                                                        boxShadow: 1
                                                                    }
                                                                }}
                                                            >
                                                                <TableCell>
                                                                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                                        <Icon sx={{ mr: 1 }}>description</Icon>
                                                                        <Typography variant="subtitle2">
                                                                            {doc.name || 'Untitled Document'}
                                                                        </Typography>
                                                                    </Box>
                                                                </TableCell>
                                                                <TableCell>{doc.project}</TableCell>
                                                                <TableCell>
                                                                    {doc.loaded_chunks < doc.total_chunks ? (
                                                                        <Box sx={{ width: '100%', maxWidth: 150 }}>
                                                                            <Typography variant="body2" color="text.secondary">
                                                                                {doc.loaded_chunks}/{doc.total_chunks}
                                                                            </Typography>
                                                                            <LinearProgress 
                                                                                variant="determinate" 
                                                                                value={(doc.loaded_chunks / doc.total_chunks) * 100}
                                                                                sx={{ 
                                                                                    mt: 0.5,
                                                                                    height: 6,
                                                                                    borderRadius: 1
                                                                                }}
                                                                            />
                                                                        </Box>
                                                                    ) : doc.total_chunks}
                                                                </TableCell>
                                                                <TableCell>
                                                                    {new Date(doc.created_at).toLocaleString()}
                                                                </TableCell>
                                                                <TableCell align="right">
                                                                    <IconButton
                                                                        onClick={() => handleDelete(doc.id, doc.project)}
                                                                        size="small"
                                                                        sx={{
                                                                            color: theme.palette.error.main,
                                                                            '&:hover': {
                                                                                backgroundColor: alpha(theme.palette.error.main, 0.1),
                                                                            }
                                                                        }}
                                                                    >
                                                                        <Icon>delete</Icon>
                                                                    </IconButton>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                        <TablePagination
                                            rowsPerPageOptions={[5, 10, 25, 50, 100]}
                                            component="div"
                                            count={total}
                                            rowsPerPage={rowsPerPage}
                                            page={page}
                                            onPageChange={handleChangePage}
                                            onRowsPerPageChange={handleChangeRowsPerPage}
                                            sx={{
                                                borderTop: `1px solid ${theme.palette.divider}`,
                                                mt: 2
                                            }}
                                        />
                                    </>
                                )}
                            </Paper>
                        </Box>
                    </Grid>
                </Grid>
            </Box>
        </Container>
    );
}

// Export for browser environment
window.Documents = Documents;



