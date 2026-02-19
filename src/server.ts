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
  // Use runtime environment when available; otherwise fallback to public backend.
  const backendUrl = process.env.REMOTE_BACKEND_URL || 'https://faucetbackend.demos.sh';
  console.log('Injecting backend URL into frontend:', backendUrl);

  // SECURITY: Properly escape the URL to prevent XSS
  // Use JSON.stringify to safely encode the string for JavaScript context
  const safeBackendUrl = JSON.stringify(backendUrl);
  const envScript = `<script>window.__BACKEND_URL__ = ${safeBackendUrl};</script>`;

  // Insert before the app bundle script tag (supports optional attributes like defer)
  const bundleScriptRegex = /<script\s+type="module"\s+src="\/dist\/main\.js"[^>]*><\/script>/;
  if (bundleScriptRegex.test(html)) {
    html = html.replace(bundleScriptRegex, `${envScript}\n    $&`);
  } else if (html.includes('</head>')) {
    // Fallback injection point if markup changes again
    html = html.replace('</head>', `    ${envScript}\n  </head>`);
    console.warn('Bundle script tag not found; injected backend URL in <head> instead');
  } else {
    console.warn('No safe injection point found for backend URL script');
  }

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
