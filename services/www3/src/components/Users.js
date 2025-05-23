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
    Avatar,
    Chip,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    alpha
} = window.MaterialUI;

const { useState, useEffect } = window.React;

function Users() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedUser, setSelectedUser] = useState(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [apiKeysDialogOpen, setApiKeysDialogOpen] = useState(false);
    const [apiKeys, setApiKeys] = useState([]);
    const [newKeyName, setNewKeyName] = useState('');
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        role: 'user'
    });

    const fetchUsers = async () => {
        try {
            setLoading(true);
            const response = await window.api.fetch('/api/users');
            if (!response) return;
            
            if (!response.ok) throw new Error('Failed to fetch users');
            const data = await response.json();
            setUsers(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching users:', err);
            setError(err.message);
            setUsers([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchApiKeys = async (userId) => {
        try {
            setLoading(true);
            const response = await window.api.fetch(`/api/users/${userId}/api-keys`);
            if (!response) return;
            
            if (!response.ok) throw new Error('Failed to fetch API keys');
            const data = await response.json();
            setApiKeys(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching API keys:', err);
            setError(err.message);
            setApiKeys([]);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateApiKey = async () => {
        if (!selectedUser || !newKeyName.trim()) return;
        
        try {
            setLoading(true);
            const response = await window.api.fetch(`/api/users/${selectedUser.id}/api-keys`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: newKeyName.trim() }),
            });

            if (!response) return;
            if (!response.ok) throw new Error('Failed to create API key');

            const newKey = await response.json();
            setApiKeys([...apiKeys, newKey]);
            setNewKeyName('');
        } catch (err) {
            console.error('Error creating API key:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteApiKey = async (keyId) => {
        if (!selectedUser || !window.confirm('Are you sure you want to delete this API key?')) return;
        
        try {
            setLoading(true);
            const response = await window.api.fetch(`/api/users/${selectedUser.id}/api-keys/${keyId}`, {
                method: 'DELETE',
            });

            if (!response) return;
            if (!response.ok) throw new Error('Failed to delete API key');

            setApiKeys(apiKeys.filter(key => key.id !== keyId));
        } catch (err) {
            console.error('Error deleting API key:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setLoading(true);
            const method = selectedUser ? 'PUT' : 'POST';
            const url = selectedUser 
                ? `/api/users/${selectedUser.id}`
                : '/api/users';

            const response = await window.api.fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData),
            });

            if (!response) return;
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save user');
            }

            await fetchUsers();
            handleCloseDialog();
        } catch (err) {
            console.error('Error saving user:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this user?')) return;
        
        try {
            setLoading(true);
            const response = await window.api.fetch(`/api/users/${id}`, {
                method: 'DELETE',
            });

            if (!response) return;
            if (!response.ok) throw new Error('Failed to delete user');

            await fetchUsers();
        } catch (err) {
            console.error('Error deleting user:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenDialog = (user = null) => {
        if (user) {
            setSelectedUser(user);
            setFormData({
                email: user.email,
                password: '',
                role: user.role || 'user'
            });
        } else {
            setSelectedUser(null);
            setFormData({
                email: '',
                password: '',
                role: 'user'
            });
        }
        setDialogOpen(true);
    };

    const handleCloseDialog = () => {
        setDialogOpen(false);
        setSelectedUser(null);
        setFormData({
            email: '',
            password: '',
            role: 'user'
        });
        setError(null);
    };

    const handleOpenApiKeysDialog = async (user) => {
        setSelectedUser(user);
        await fetchApiKeys(user.id);
        setApiKeysDialogOpen(true);
    };

    const handleCloseApiKeysDialog = () => {
        setApiKeysDialogOpen(false);
        setSelectedUser(null);
        setApiKeys([]);
        setNewKeyName('');
        setError(null);
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
                        Users
                    </Typography>
                    <Button
                        variant="contained"
                        onClick={() => handleOpenDialog()}
                        sx={{
                            background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                            color: 'white',
                            boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)',
                            transition: 'transform 0.2s',
                            '&:hover': {
                                transform: 'scale(1.05)'
                            }
                        }}
                        startIcon={<Icon>person_add</Icon>}
                    >
                        Add User
                    </Button>
                </Box>

                {error && (
                    <Fade in={true}>
                        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
                    </Fade>
                )}

                <TableContainer component={Paper} sx={{ 
                    borderRadius: 2,
                    background: theme => theme.palette.mode === 'light' 
                        ? 'rgba(255, 255, 255, 0.7)'
                        : 'rgba(50, 50, 50, 0.7)',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                }}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Email</TableCell>
                                <TableCell>Role</TableCell>
                                <TableCell>Created At</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {users.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell>{user.email}</TableCell>
                                    <TableCell>
                                        <Chip 
                                            label={user.is_admin ? 'Admin' : 'User'}
                                            color={user.is_admin ? 'primary' : 'default'}
                                            size="small"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {new Date(user.created_at).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="API Keys">
                                            <IconButton 
                                                onClick={() => handleOpenApiKeysDialog(user)}
                                                size="small"
                                            >
                                                <Icon>key</Icon>
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Edit">
                                            <IconButton 
                                                onClick={() => handleOpenDialog(user)}
                                                size="small"
                                            >
                                                <Icon>edit</Icon>
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <IconButton 
                                                onClick={() => handleDelete(user.id)}
                                                size="small"
                                                color="error"
                                            >
                                                <Icon>delete</Icon>
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>

                {/* User Dialog */}
                <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
                    <DialogTitle>
                        {selectedUser ? 'Edit User' : 'Add User'}
                    </DialogTitle>
                    <DialogContent>
                        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
                            <TextField
                                fullWidth
                                label="Email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                margin="normal"
                                required
                            />
                            <TextField
                                fullWidth
                                label="Password"
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                margin="normal"
                                required={!selectedUser}
                                helperText={selectedUser ? 'Leave blank to keep current password' : ''}
                            />
                            <FormControl fullWidth margin="normal">
                                <InputLabel>Role</InputLabel>
                                <Select
                                    value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                    label="Role"
                                >
                                    <MenuItem value="user">User</MenuItem>
                                    <MenuItem value="admin">Admin</MenuItem>
                                </Select>
                            </FormControl>
                        </Box>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseDialog}>Cancel</Button>
                        <Button 
                            onClick={handleSubmit}
                            variant="contained"
                            disabled={loading}
                        >
                            {loading ? <CircularProgress size={24} /> : 'Save'}
                        </Button>
                    </DialogActions>
                </Dialog>

                {/* API Keys Dialog */}
                <Dialog 
                    open={apiKeysDialogOpen} 
                    onClose={handleCloseApiKeysDialog}
                    maxWidth="sm"
                    fullWidth
                >
                    <DialogTitle>
                        API Keys - {selectedUser?.email}
                    </DialogTitle>
                    <DialogContent>
                        <Box sx={{ mt: 2 }}>
                            <Box sx={{ mb: 3, display: 'flex', gap: 1 }}>
                                <TextField
                                    fullWidth
                                    label="New Key Name"
                                    value={newKeyName}
                                    onChange={(e) => setNewKeyName(e.target.value)}
                                    size="small"
                                />
                                <Button
                                    variant="contained"
                                    onClick={handleCreateApiKey}
                                    disabled={loading || !newKeyName.trim()}
                                >
                                    Create
                                </Button>
                            </Box>

                            <List>
                                {apiKeys.map((key) => (
                                    <ListItem 
                                        key={key.id}
                                        sx={{
                                            bgcolor: 'background.paper',
                                            borderRadius: 1,
                                            mb: 1,
                                            border: '1px solid',
                                            borderColor: 'divider'
                                        }}
                                    >
                                        <ListItemText
                                            primary={
                                                <Typography variant="subtitle1" component="div">
                                                    {key.name}
                                                </Typography>
                                            }
                                            secondary={
                                                <Box sx={{ mt: 1 }}>
                                                    <Box sx={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center',
                                                        bgcolor: 'action.hover',
                                                        borderRadius: 1,
                                                        p: 1,
                                                        maxWidth: '100%',
                                                        overflow: 'hidden'
                                                    }}>
                                                        <Typography 
                                                            variant="body2" 
                                                            sx={{ 
                                                                fontFamily: 'monospace',
                                                                flexGrow: 1,
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis'
                                                            }}
                                                        >
                                                            {key.key_value}
                                                        </Typography>
                                                        <Tooltip title="Copy API Key">
                                                            <IconButton
                                                                size="small"
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(key.key_value);
                                                                    // Можно добавить уведомление о копировании
                                                                }}
                                                                sx={{ ml: 1 }}
                                                            >
                                                                <Icon>content_copy</Icon>
                                                            </IconButton>
                                                        </Tooltip>
                                                    </Box>
                                                    <Typography 
                                                        variant="caption" 
                                                        color="text.secondary"
                                                        sx={{ display: 'block', mt: 0.5 }}
                                                    >
                                                        Created: {new Date(key.created_at).toLocaleDateString()}
                                                    </Typography>
                                                </Box>
                                            }
                                        />
                                        <ListItemSecondaryAction>
                                            <Tooltip title="Delete Key">
                                                <IconButton
                                                    edge="end"
                                                    onClick={() => handleDeleteApiKey(key.id)}
                                                    color="error"
                                                    size="small"
                                                    sx={{ ml: 1 }}
                                                >
                                                    <Icon>delete</Icon>
                                                </IconButton>
                                            </Tooltip>
                                        </ListItemSecondaryAction>
                                    </ListItem>
                                ))}
                                {apiKeys.length === 0 && (
                                    <Typography 
                                        color="text.secondary" 
                                        align="center"
                                        sx={{ py: 4 }}
                                    >
                                        No API keys found. Create one using the form above.
                                    </Typography>
                                )}
                            </List>
                        </Box>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseApiKeysDialog}>Close</Button>
                    </DialogActions>
                </Dialog>
            </Box>
        </Container>
    );
}

// Export for browser environment
window.Users = Users;
