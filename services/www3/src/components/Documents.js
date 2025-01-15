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

const { useState, useEffect, useRef } = window.React;
const { useNavigate } = window.ReactRouterDOM;

function Documents() {
    const navigate = useNavigate();
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [project, setProject] = useState(null);
    const [projects, setProjects] = useState([]);
    const [isLoadingProjects, setIsLoadingProjects] = useState(true);
    const [uploadType, setUploadType] = useState('file');
    const [content, setContent] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [projectFilter, setProjectFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const fileInputRef = useRef(null);
    const theme = useTheme();

    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [orderBy, setOrderBy] = useState('created_at');
    const [order, setOrder] = useState('desc');

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

    useEffect(() => {
        // Load projects when component mounts
        const loadProjects = async () => {
            try {
                setIsLoadingProjects(true);
                const response = await window.api.fetch('/api/documents/projects');
                if (!response.ok) throw new Error('Failed to load projects');
                const data = await response.json();
                setProjects(data || []);
                setError('');
            } catch (err) {
                console.error('Error loading projects:', err);
                setError(err.message || 'Failed to load projects');
            } finally {
                setIsLoadingProjects(false);
            }
        };

        loadProjects();
    }, []);

    // Функция для обновления списка проектов
    const refreshProjects = async () => {
        try {
            setIsLoadingProjects(true);
            const response = await window.api.fetch('/api/documents/projects');
            if (!response.ok) throw new Error('Failed to load projects');
            const data = await response.json();
            setProjects(data || []);
            setError('');
        } catch (err) {
            console.error('Error loading projects:', err);
            setError(err.message || 'Failed to load projects');
        } finally {
            setIsLoadingProjects(false);
        }
    };

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
            // Don't set loading on regular updates
            const isInitialLoad = documents.length === 0;
            if (isInitialLoad) {
                setLoading(true);
            }
            
            const timestamp = Date.now();
            const url = selectedProject 
                ? `/api/documents?project=${encodeURIComponent(selectedProject)}&t=${timestamp}`
                : `/api/documents?t=${timestamp}`;
            const response = await window.api.fetch(url);
            
            if (!response) return; // Был редирект на логин
            
            if (!response.ok) throw new Error('Failed to fetch documents');
            const data = await response.json();

            setDocuments(prevDocs => {
                const updatedDocs = [...prevDocs];
                let hasChanges = false;
                
                data.forEach(newDoc => {
                    const index = updatedDocs.findIndex(doc => 
                        doc.id === newDoc.id && doc.project === newDoc.project
                    );
                    if (index === -1) {
                        updatedDocs.push(newDoc);
                        hasChanges = true;
                    } else if (JSON.stringify(updatedDocs[index]) !== JSON.stringify(newDoc)) {
                        updatedDocs[index] = newDoc;
                        hasChanges = true;
                    }
                });
                
                // Remove deleted documents
                const beforeLength = updatedDocs.length;
                const filteredDocs = updatedDocs.filter(doc => 
                    data.some(newDoc => 
                        doc.id === newDoc.id && doc.project === newDoc.project
                    )
                );
                if (beforeLength !== filteredDocs.length) {
                    hasChanges = true;
                }
                
                // Only update state if there are actual changes
                return hasChanges ? filteredDocs : prevDocs;
            });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDocuments(project);
    }, [project]);

    // Добавляем интервал обновления для незагруженных документов
    useEffect(() => {
        const hasIncompleteDocuments = documents.some(doc => doc.loaded_chunks < doc.total_chunks);
        
        if (hasIncompleteDocuments) {
            const interval = setInterval(() => {
                fetchDocuments(project);
            }, 1000);
            
            return () => clearInterval(interval);
        }
    }, [documents, project]);

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
            } else if (uploadType === 'text' && content) {
                const response = await window.api.fetch('/api/documents', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        content,
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
            setContent('');
            
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
        <Container maxWidth="xl">
            <Box sx={{ 
                mt: 4,
                height: '100%',
                pb: 4,
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
                            <Paper elevation={3} sx={{ 
                                p: 4,
                                borderRadius: 2,
                                background: theme.palette.mode === 'light' 
                                    ? 'rgba(255, 255, 255, 0.7)'
                                    : 'rgba(50, 50, 50, 0.7)',
                                backdropFilter: 'blur(10px)',
                                border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
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
                                                value={content}
                                                onChange={(e) => setContent(e.target.value)}
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
                            <Paper elevation={3} sx={{ 
                                p: 4,
                                borderRadius: 2,
                                background: theme.palette.mode === 'light' 
                                    ? 'rgba(255, 255, 255, 0.7)'
                                    : 'rgba(50, 50, 50, 0.7)',
                                backdropFilter: 'blur(10px)',
                                border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
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
                                    
                                {loading && documents.length === 0 && (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                                        <CircularProgress />
                                    </Box>
                                )}
                                
                                {sortedDocuments.length > 0 && (
                                    <Box>
                                        <TableContainer component={Paper}>
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
                                                        <TableCell>
                                                            <TableSortLabel
                                                                active={orderBy === 'project'}
                                                                direction={orderBy === 'project' ? order : 'asc'}
                                                                onClick={() => handleSort('project')}
                                                            >
                                                                Project
                                                            </TableSortLabel>
                                                        </TableCell>
                                                        <TableCell>Chunks</TableCell>
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
                                                    {sortedDocuments
                                                        .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                                                        .map((doc) => (
                                                            <TableRow 
                                                                key={doc.id}
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
                                            rowsPerPageOptions={[5, 10, 25]}
                                            component="div"
                                            count={filteredDocuments.length}
                                            rowsPerPage={rowsPerPage}
                                            page={page}
                                            onPageChange={handleChangePage}
                                            onRowsPerPageChange={handleChangeRowsPerPage}
                                            sx={{
                                                borderTop: `1px solid ${theme.palette.divider}`,
                                                mt: 2
                                            }}
                                        />
                                    </Box>
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
