import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, useMediaQuery } from '@material-ui/core';

import Login from './components/Login';
import Documents from './components/Documents';
import Models from './components/Models';
import Users from './components/Users';
import Projects from './components/Projects';
import Profile from './components/Profile';
import Layout from './components/Layout';
import Chat from './components/Chat';

// Initialize React dependencies
const { useState, useEffect, useMemo } = window.React;
const { ThemeProvider, createTheme, useMediaQuery } = window.MaterialUI;

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(
        !!localStorage.getItem('token')
    );
    const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
    const [mode, setMode] = useState(localStorage.getItem('theme') || 'system');

    // Update mode when localStorage changes
    useEffect(() => {
        const handleStorageChange = () => {
            const newMode = localStorage.getItem('theme') || 'system';
            setMode(newMode);
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const theme = useMemo(
        () =>
            createTheme({
                palette: {
                    mode: mode === 'system' ? (prefersDarkMode ? 'dark' : 'light') : mode,
                },
            }),
        [mode, prefersDarkMode],
    );

    const handleLogin = () => {
        setIsAuthenticated(true);
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        setIsAuthenticated(false);
        window.location.href = '/login';
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
                {!isAuthenticated ? (
                    <Routes>
                        <Route path="/login" element={<Login onLogin={handleLogin} />} />
                        <Route path="*" element={<Navigate to="/login" replace />} />
                    </Routes>
                ) : (
                    <Routes>
                        <Route path="/" element={<Layout onLogout={handleLogout} mode={mode} setMode={setMode} />}>
                            <Route index element={<Navigate to="/documents" />} />
                            <Route path="documents" element={<Documents />} />
                            <Route path="projects" element={<Projects />} />
                            <Route path="models" element={<Models />} />
                            <Route path="chat" element={<Chat />} />
                            <Route path="users" element={<Users />} />
                            <Route path="profile" element={<Profile />} />
                        </Route>
                    </Routes>
                )}
            </BrowserRouter>
        </ThemeProvider>
    );
}

export default App;
