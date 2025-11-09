import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { readFileSync } from 'fs';
import { join } from 'path';

const app = new Hono();

// Serve static assets
app.use('/dist/*', serveStatic({ root: './' }));
app.use('/styles/*', serveStatic({ root: './src' }));

// Serve the main HTML file with injected environment variables
app.get('/', (c) => {
  let html = readFileSync(join(process.cwd(), 'src/index.html'), 'utf-8');
  
  // Inject backend URL as a global variable
  // Use the environment variable from docker-compose, fallback to localhost
  const backendUrl = process.env.REMOTE_BACKEND_URL || 'http://localhost:3010';
  console.log('Injecting backend URL into frontend:', backendUrl);
  
  const envScript = `<script>window.__BACKEND_URL__ = '${backendUrl}';</script>`;
  
  // Insert before the main script tag
  html = html.replace(
    '<script type="module" src="/dist/main.js"></script>',
    `${envScript}\n    <script type="module" src="/dist/main.js"></script>`
  );
  
  return c.html(html);
});

// Health check
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    backendUrl: process.env.REMOTE_BACKEND_URL || 'not configured'
  });
});

const port = parseInt(process.env.PORT || '4442');

export default {
  port,
  fetch: app.fetch,
};

console.log(`Frontend server running on http://localhost:${port}`);