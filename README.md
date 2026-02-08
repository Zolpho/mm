# Docker Status Monitor

A real-time Docker monitoring dashboard with auto-refresh capabilities.

## Setup Instructions

### 1. Configuration

Create a `config.js` file based on `config.example.js`:

```bash
cp config.example.js config.js
```

Edit `config.js` with your API settings:

```javascript
const CONFIG = {
    apiUrl: 'https://your-api-url.com',
    username: 'your-username',  // Optional
    password: 'your-password',  // Optional
    refreshInterval: 10000
};
```

### 2. Security Options

#### Option A: Separate Config (Local Development)
- Keep `config.js` in `.gitignore`
- Manually upload to GitHub Pages (not recommended for production)

#### Option B: GitHub Actions with Secrets
Add this workflow (`.github/workflows/deploy.yml`):

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Create config.js
        run: |
          cat > config.js << EOF
          const CONFIG = {
              apiUrl: '${{ secrets.API_URL }}',
              username: '${{ secrets.API_USERNAME }}',
              password: '${{ secrets.API_PASSWORD }}',
              refreshInterval: 10000
          };
          EOF

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./
```

Then add secrets in GitHub: Settings → Secrets → Actions:
- `API_URL`
- `API_USERNAME`
- `API_PASSWORD`

#### Option C: Backend Proxy (Most Secure)
Create a serverless function or API proxy that:
1. Handles authentication server-side
2. Forwards requests to your Docker API
3. Returns data to the static page

Update `config.js` to use your proxy:
```javascript
const CONFIG = {
    apiUrl: 'https://your-proxy-api.com',
    // No credentials needed - handled by proxy
    refreshInterval: 10000
};
```

### 3. Deploy to GitHub Pages

1. Push files to your repository
2. Go to Settings → Pages
3. Select source branch and folder
4. Access at: `https://[username].github.io/[repo-name]/docker-status.html`

## Files Structure

```
.
├── docker-status.html      # Main application file
├── config.js              # Your credentials (gitignored)
├── config.example.js      # Template file (committed)
├── .gitignore            # Excludes config.js
└── README.md             # This file
```

## Features

- ✅ Auto-refresh every 10 seconds
- ✅ Docker running status indicator
- ✅ Active containers list with details
- ✅ Responsive design
- ✅ Error handling
- ✅ Timestamp tracking

## Local Testing

Simply open `docker-status.html` in a web browser (requires CORS to be enabled on your API).
