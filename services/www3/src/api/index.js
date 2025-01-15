class Api {
    async fetch(url, options = {}) {
        console.log('API Request:', { url, options });
        
        const token = localStorage.getItem('token');
        if (token) {
            options.headers = {
                ...options.headers,
                'Authorization': `Bearer ${token}`
            };
        }

        console.log('Final request config:', {
            url,
            method: options.method,
            headers: options.headers,
            body: options.body
        });

        try {
            const response = await fetch(url, options);
            console.log('API Response:', {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries())
            });
            
            if (response.status === 401) {
                console.log('Unauthorized, redirecting to login');
                localStorage.removeItem('token');
                window.location.href = '/login';
                return null;
            }
            return response;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }
}

export const api = new Api();
