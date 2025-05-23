// Get dependencies from global scope
const {
    Box,
    AppBar,
    Toolbar,
    Typography,
    IconButton,
    Drawer,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    useTheme,
    alpha,
    styled,
    Avatar,
    Menu,
    MenuItem,
    Divider,
    Fade
} = window.MaterialUI;

const { useNavigate, useLocation } = window.ReactRouterDOM;
const { useState, useEffect } = window.React;

// Стилизованный AppBar со стеклянным эффектом
const GlassAppBar = styled(AppBar)(({ theme }) => ({
    background: alpha(theme.palette.background.paper, 0.7),
    backdropFilter: 'blur(10px)',
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    boxShadow: 'none'
}));

// Стилизованный Drawer со стеклянным эффектом
const GlassDrawer = styled(Drawer)(({ theme }) => ({
    '& .MuiDrawer-paper': {
        background: alpha(theme.palette.background.paper, 0.7),
        backdropFilter: 'blur(10px)',
        borderRight: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
        width: 240
    }
}));

function Layout({ children }) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const theme = useTheme();
    const [anchorEl, setAnchorEl] = useState(null);

    const handleDrawerToggle = () => {
        setMobileOpen(!mobileOpen);
    };

    const handleProfileClick = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        window.location.href = '/login';
    };

    const menuItems = [
        { text: 'Documents', icon: 'description', path: '/documents' },
        { text: 'Projects', icon: 'folder', path: '/projects' },
        { text: 'Models', icon: 'model_training', path: '/models' },
        { text: 'Chat', icon: 'chat', path: '/chat' },
        { text: 'Voice', icon: 'record_voice_over', path: '/voice' },
        { text: 'API', icon: 'api', path: '/swagger' },
        { text: 'Users', icon: 'group', path: '/users' },
        { text: 'Request Logs', icon: 'analytics', path: '/request-logs' },
        { text: 'Profile', icon: 'person', path: '/profile' }
    ];

    const drawer = (
        <Box sx={{ height: '100%' }}>
            <Toolbar sx={{ 
                display: 'flex', 
                alignItems: 'center',
                justifyContent: 'flex-start',
                py: 2,
                px: 2
            }}>
                <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center',
                    gap: 3,
                    ml: 1,
                    mb: 1
                }}>
                    <Box
                        component="span"
                        sx={{
                            width: 24,
                            height: 24,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                            borderRadius: '8px',
                            color: 'white',
                            position: 'relative',
                            '&::before': {
                                content: '""',
                                position: 'absolute',
                                width: '6px',
                                height: '6px',
                                background: 'white',
                                borderRadius: '50%',
                                top: '6px',
                                left: '6px'
                            },
                            '&::after': {
                                content: '""',
                                position: 'absolute',
                                width: '9px',
                                height: '9px',
                                border: '1.5px solid white',
                                borderRadius: '50%',
                                bottom: '4px',
                                right: '4px'
                            }
                        }}
                    >
                        <Box
                            sx={{
                                width: '10px',
                                height: '1.5px',
                                background: 'white',
                                transform: 'rotate(45deg)',
                                position: 'absolute'
                            }}
                        />
                    </Box>
                    <Typography 
                        variant="h6"
                        sx={{
                            fontSize: '1.25rem',
                            fontWeight: 600,
                            background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            letterSpacing: '0.5px'
                        }}
                    >
                        Ollamify
                    </Typography>
                </Box>
            </Toolbar>
            <List>
                {menuItems.map((item) => (
                    <ListItem
                        button
                        key={item.text}
                        onClick={() => navigate(item.path)}
                        sx={{
                            mx: 1,
                            borderRadius: 1,
                            mb: 0.5,
                            backgroundColor: location.pathname === item.path 
                                ? alpha(theme.palette.primary.main, 0.1)
                                : 'transparent',
                            '&:hover': {
                                backgroundColor: alpha(theme.palette.primary.main, 0.05)
                            }
                        }}
                    >
                        <ListItemIcon>
                            <span className="material-icons" style={{
                                color: location.pathname === item.path 
                                    ? theme.palette.primary.main
                                    : theme.palette.text.secondary
                            }}>
                                {item.icon}
                            </span>
                        </ListItemIcon>
                        <ListItemText 
                            primary={item.text}
                            sx={{
                                '& .MuiTypography-root': {
                                    color: location.pathname === item.path 
                                        ? theme.palette.primary.main
                                        : theme.palette.text.primary,
                                    fontWeight: location.pathname === item.path ? 600 : 400
                                }
                            }}
                        />
                    </ListItem>
                ))}
            </List>
        </Box>
    );

    return (
        <Box sx={{ 
            display: 'flex',
            minHeight: '100vh',
            background: theme.palette.mode === 'light'
                ? 'linear-gradient(120deg, #f0f7ff 0%, #ffffff 100%)'
                : 'linear-gradient(120deg, #1a1a1a 0%, #2d2d2d 100%)',
            '&::before': {
                content: '""',
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundImage: theme.palette.mode === 'light'
                    ? 'radial-gradient(circle at 25% 25%, rgba(33, 150, 243, 0.1) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(33, 203, 243, 0.1) 0%, transparent 50%)'
                    : 'radial-gradient(circle at 25% 25%, rgba(33, 150, 243, 0.05) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(33, 203, 243, 0.05) 0%, transparent 50%)',
                pointerEvents: 'none',
                zIndex: 0
            }
        }}>
            <GlassAppBar position="fixed">
                <Toolbar>
                    <IconButton
                        color="inherit"
                        aria-label="open drawer"
                        edge="start"
                        onClick={handleDrawerToggle}
                        sx={{ mr: 2, display: { sm: 'none' } }}
                    >
                        <span className="material-icons">menu</span>
                    </IconButton>
                    <Box sx={{ flexGrow: 1 }} />
                    <IconButton
                        onClick={handleProfileClick}
                        sx={{
                            ml: 1,
                            '&:hover': {
                                transform: 'scale(1.1)',
                                transition: 'transform 0.2s'
                            }
                        }}
                    >
                        <Avatar sx={{ 
                            bgcolor: theme.palette.primary.main,
                            width: 32,
                            height: 32
                        }}>
                            <span className="material-icons" style={{ fontSize: 20 }}>person</span>
                        </Avatar>
                    </IconButton>
                    <Menu
                        anchorEl={anchorEl}
                        open={Boolean(anchorEl)}
                        onClose={handleClose}
                        TransitionComponent={Fade}
                        sx={{
                            '& .MuiPaper-root': {
                                borderRadius: 2,
                                minWidth: 180,
                                background: theme.palette.mode === 'light' 
                                    ? 'rgba(255, 255, 255, 0.9)'
                                    : 'rgba(50, 50, 50, 0.9)',
                                backdropFilter: 'blur(10px)',
                                border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
                            }
                        }}
                    >
                        <MenuItem onClick={() => {
                            navigate('/profile');
                            handleClose();
                        }}>
                            <ListItemIcon>
                                <span className="material-icons">account_circle</span>
                            </ListItemIcon>
                            <ListItemText>Profile</ListItemText>
                        </MenuItem>
                        <Divider />
                        <MenuItem onClick={() => {
                            handleClose();
                            handleLogout();
                        }}>
                            <ListItemIcon>
                                <span className="material-icons">logout</span>
                            </ListItemIcon>
                            <ListItemText>Logout</ListItemText>
                        </MenuItem>
                    </Menu>
                </Toolbar>
            </GlassAppBar>

            <Box
                component="nav"
                sx={{ 
                    width: { sm: 240 }, 
                    flexShrink: { sm: 0 }
                }}
            >
                <GlassDrawer
                    variant="temporary"
                    open={mobileOpen}
                    onClose={handleDrawerToggle}
                    ModalProps={{
                        keepMounted: true
                    }}
                    sx={{
                        display: { xs: 'block', sm: 'none' },
                        '& .MuiDrawer-paper': {
                            overflowX: 'hidden'
                        }
                    }}
                >
                    {drawer}
                </GlassDrawer>
                <GlassDrawer
                    variant="permanent"
                    sx={{
                        display: { xs: 'none', sm: 'block' },
                        '& .MuiDrawer-paper': {
                            overflowX: 'hidden'
                        }
                    }}
                    open
                >
                    {drawer}
                </GlassDrawer>
            </Box>

            <Box component="main" sx={{ flexGrow: 1, p: 3, width: { sm: `calc(100% - ${240}px)` }, mt: 8, position: 'relative', zIndex: 1 }}>
                {children}
            </Box>
        </Box>
    );
}

window.Layout = Layout;
