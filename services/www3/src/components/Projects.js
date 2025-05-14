// Get dependencies from global scope
const {
    Container,
    Box,
    Typography,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Alert,
    CircularProgress,
    TableContainer,
    Table,
    TableHead,
    TableBody,
    TableRow,
    TableCell,
    Paper,
    IconButton,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Icon,
    Fade,
    Tooltip,
    Chip,
    Autocomplete
} = window.MaterialUI;

const { useState, useEffect, useRef, useCallback } = window.React;

function Projects() {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedProject, setSelectedProject] = useState(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [stats, setStats] = useState({});
    const [models, setModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState(null);
    const [modelInput, setModelInput] = useState('');
    const [isLoadingModels, setIsLoadingModels] = useState(true);
    const [formData, setFormData] = useState({
        name: ''
    });
    
    // Ссылка на WebSocket соединение
    const socketRef = useRef(null);

    // Функция для подключения к WebSocket
    const connectWebSocket = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const socket = new WebSocket(`${protocol}//${host}/ws/projects`);
        
        socket.addEventListener('open', () => {
            console.log('WebSocket connected for projects');
        });
        
        socket.addEventListener('message', (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket message:', data);
                
                if (data.type === 'project_update' && data.project) {
                    // Если проект удален
                    if (data.project.deleted) {
                        setProjects(prevProjects => 
                            prevProjects.filter(p => p.id !== data.project.id)
                        );
                        return;
                    }
                    
                    // Обновляем проект в списке или добавляем новый
                    setProjects(prevProjects => {
                        const projectIndex = prevProjects.findIndex(p => p.id === data.project.id);
                        
                        if (projectIndex >= 0) {
                            const newProjects = [...prevProjects];
                            newProjects[projectIndex] = data.project;
                            return newProjects;
                        } else {
                            return [...prevProjects, data.project];
                        }
                    });
                }
                
                if (data.type === 'project_stats_update' && data.projectId && data.stats) {
                    // Обновляем статистику проекта
                    setStats(prevStats => ({
                        ...prevStats,
                        [data.projectId]: data.stats
                    }));
                }
            } catch (err) {
                console.error('Error parsing WebSocket message:', err);
            }
        });
        
        socket.addEventListener('close', () => {
            console.log('WebSocket connection closed for projects');
            // Попытка переподключения через 2 секунды
            setTimeout(() => {
                connectWebSocket();
            }, 2000);
        });
        
        socket.addEventListener('error', (error) => {
            console.error('WebSocket error:', error);
        });
        
        socketRef.current = socket;
    }, []);

    const fetchModels = async () => {
        try {
            setIsLoadingModels(true);
            const response = await window.api.fetch('/api/models');
            if (!response) return;
            
            if (!response.ok) throw new Error('Failed to fetch models');
            const data = await response.json();
            // Filter models that are ready and have embedding capability
            const availableModels = data.models.filter(model => 
                model.downloadStatus?.status === 'ready' && 
                model.capabilities?.includes('embedding')
            );
            
            console.log("Adding FRIDA to models list");
            // Добавляем FRIDA как опцию эмбеддинговой модели
            availableModels.push({
                name: 'frida',
                displayName: 'FRIDA (Russian)',
                capabilities: ['embedding'],
                description: 'Best embedding model for Russian language, powered by AI-Forever',
                downloadStatus: { status: 'ready' },
                tags: ['russian', 'multilingual', 'embedding']
            });
            
            console.log("Available models:", availableModels);
            setModels(availableModels);
        } catch (err) {
            console.error('Error fetching models:', err);
            setError(err.message);
        } finally {
            setIsLoadingModels(false);
        }
    };

    const fetchProjects = async () => {
        try {
            setLoading(true);
            const response = await window.api.fetch('/api/projects');
            if (!response) return;
            
            if (!response.ok) throw new Error('Failed to fetch projects');
            const data = await response.json();
            setProjects(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching projects:', err);
            setError(err.message);
            setProjects([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProjects();
        fetchModels();
        
        // Устанавливаем WebSocket соединение
        connectWebSocket();
        
        // Очистка при размонтировании
        return () => {
            if (socketRef.current) {
                socketRef.current.close();
            }
        };
    }, [connectWebSocket]);

    useEffect(() => {
        // При первоначальной загрузке получаем статистику для каждого проекта
        projects.forEach(project => {
            if (!stats[project.id]) {
                fetchProjectStats(project.id);
            }
        });
    }, [projects, stats]);

    const fetchProjectStats = async (projectId) => {
        try {
            const response = await window.api.fetch(`/api/projects/${projectId}/stats`);
            if (!response) return;
            
            if (!response.ok) throw new Error('Failed to fetch project stats');
            const data = await response.json();
            setStats(prev => ({ ...prev, [projectId]: data }));
        } catch (err) {
            console.error('Error fetching project stats:', err);
            setStats(prev => ({ ...prev, [projectId]: { document_count: '?' } }));
        }
    };

    const handleCreateProject = async () => {
        if (!selectedModel) {
            setError('Please select an embedding model');
            return;
        }

        try {
            setLoading(true);
            console.log("Creating project with model:", selectedModel);
            const response = await window.api.fetch('/api/projects', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: formData.name,
                    embeddingModel: selectedModel.name
                }),
            });

            if (!response.ok) throw new Error('Failed to create project');
            
            setDialogOpen(false);
            setFormData({ name: '' });
            setSelectedModel(null);
            setModelInput('');
            await fetchProjects();
        } catch (err) {
            console.error('Error creating project:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateProject = async () => {
        if (!selectedProject) return;

        try {
            setLoading(true);
            const response = await window.api.fetch(`/api/projects/${selectedProject.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: formData.name }),
            });

            if (!response.ok) throw new Error('Failed to update project');
            
            setDialogOpen(false);
            setSelectedProject(null);
            setFormData({ name: '' });
            setSelectedModel(null);
            setModelInput('');
            await fetchProjects();
        } catch (err) {
            console.error('Error updating project:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteProject = async () => {
        if (!selectedProject) return;

        try {
            setLoading(true);
            const response = await window.api.fetch(`/api/projects/${selectedProject.id}`, {
                method: 'DELETE'
            });

            if (!response.ok) throw new Error('Failed to delete project');
            
            setDeleteDialogOpen(false);
            setSelectedProject(null);
            await fetchProjects();
        } catch (err) {
            console.error('Error deleting project:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleEditClick = (project) => {
        setSelectedProject(project);
        setFormData({ name: project.name });
        const modelData = models.find(m => m.name === project.embedding_model);
        setSelectedModel(modelData || null);
        setModelInput(project.embedding_model);
        setDialogOpen(true);
    };

    const handleDeleteClick = (project) => {
        setSelectedProject(project);
        setDeleteDialogOpen(true);
    };

    const handleDialogClose = () => {
        setDialogOpen(false);
        setSelectedProject(null);
        setFormData({ name: '' });
        setSelectedModel(null);
        setModelInput('');
    };

    return (
        <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" component="h1">
                    Projects
                </Typography>
                <Button
                    variant="contained"
                    color="primary"
                    startIcon={<Icon>add</Icon>}
                    onClick={() => setDialogOpen(true)}
                >
                    New Project
                </Button>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                </Alert>
            )}

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Embedding Model</TableCell>
                            <TableCell>Created By</TableCell>
                            <TableCell>Created At</TableCell>
                            <TableCell>Documents</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading && !projects.length ? (
                            <TableRow>
                                <TableCell colSpan={6} align="center">
                                    <CircularProgress />
                                </TableCell>
                            </TableRow>
                        ) : !projects.length ? (
                            <TableRow>
                                <TableCell colSpan={6} align="center">
                                    No projects found
                                </TableCell>
                            </TableRow>
                        ) : (
                            projects.map((project) => (
                                <TableRow key={project.id}>
                                    <TableCell>{project.name}</TableCell>
                                    <TableCell>
                                        <Chip 
                                            label={project.embedding_model}
                                            size="small"
                                            color="primary"
                                            variant="outlined"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {project.creator_username || project.creator_email || 'Unknown'}
                                    </TableCell>
                                    <TableCell>
                                        {new Date(project.created_at).toLocaleString()}
                                    </TableCell>
                                    <TableCell>
                                        {stats[project.id]?.document_count || '0'}
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Edit">
                                            <IconButton
                                                size="small"
                                                onClick={() => handleEditClick(project)}
                                            >
                                                <Icon>edit</Icon>
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <IconButton
                                                size="small"
                                                color="error"
                                                onClick={() => handleDeleteClick(project)}
                                            >
                                                <Icon>delete</Icon>
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Create/Edit Project Dialog */}
            <Dialog open={dialogOpen} onClose={handleDialogClose} maxWidth="sm" fullWidth>
                <DialogTitle>
                    {selectedProject ? 'Edit Project' : 'New Project'}
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ mt: 2 }}>
                        <TextField
                            fullWidth
                            label="Project Name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            margin="normal"
                            required
                        />
                        <Autocomplete
                            fullWidth
                            value={selectedModel}
                            onChange={(event, newValue) => setSelectedModel(newValue)}
                            inputValue={modelInput}
                            onInputChange={(event, newInputValue) => setModelInput(newInputValue)}
                            options={models}
                            getOptionLabel={(option) => option.displayName || option.name}
                            renderInput={(params) => (
                                <TextField
                                    {...params}
                                    label="Embedding Model"
                                    margin="normal"
                                    required
                                    error={!selectedModel && !isLoadingModels}
                                />
                            )}
                            disabled={!!selectedProject}
                            loading={isLoadingModels}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleDialogClose}>Cancel</Button>
                    <Button
                        onClick={selectedProject ? handleUpdateProject : handleCreateProject}
                        variant="contained"
                        color="primary"
                        disabled={!formData.name || (!selectedProject && !selectedModel) || loading}
                    >
                        {loading ? <CircularProgress size={24} /> : 'Save'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
                <DialogTitle>Delete Project</DialogTitle>
                <DialogContent>
                    <Typography>
                        Are you sure you want to delete project "{selectedProject?.name}"? 
                        This action cannot be undone.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
                    <Button
                        onClick={handleDeleteProject}
                        color="error"
                        variant="contained"
                        disabled={loading}
                    >
                        {loading ? <CircularProgress size={24} /> : 'Delete'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}

// Export for browser environment
window.Projects = Projects;
