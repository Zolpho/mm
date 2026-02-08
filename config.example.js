// Configuration file for Docker Status Monitor
// Copy this file to config.js and add your actual credentials

const CONFIG = {
    // API base URL (required)
    apiUrl: 'YOUR_API_URL_HERE',

    // Authentication credentials (optional if using GitHub Pages auth or proxy)
    // Leave empty if authentication is handled at GitHub Pages/proxy level
    username: 'YOUR_USERNAME_HERE',
    password: 'YOUR_PASSWORD_HERE',

    // Refresh interval in milliseconds (optional, default: 10000)
    refreshInterval: 10000
};
