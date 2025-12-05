// Cloudflare Workers backend for VIA Link Shortener
import htmlContent from './index.html';
import cssContent from './index.css';
import adminLoginHtml from './admin-login.html';
import adminDashboardHtml from './admin-dashboard.html';
import pasteHtml from './paste.html';
import errorHtml from './error.html';
import error404Css from './404.css';
import error404Js from './404.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // API Routes
      if (path.startsWith('/api/v1/short/') && method === 'POST') {
        return await handleCreateShortUrl(request, env, corsHeaders);
      }

      if (path.startsWith('/api/v1/paste/') && method === 'POST') {
        return await handleCreatePaste(request, env, corsHeaders);
      }

      if (path.startsWith('/api/v1/qr/') && method === 'GET') {
        const key = path.substring('/api/v1/qr/'.length);
        return await handleQrCode(key, env, request);
      }


      if (path.startsWith('/api/v1/lookup') && method === 'POST') {
        return await handleLookup(request, env, corsHeaders);
      }

      // Admin Routes
      if (path.startsWith('/admin') || path.startsWith('/api/v1/admin/')) {
        return await handleAdmin(request, env);
      }

      // Serve favicon
      if (path === '/favicon.jpg' && method === 'GET') {
        return await serveFavicon(env);
      }

      // Serve CSS
      if (path === '/index.css' && method === 'GET') {
        return new Response(cssContent, {
          headers: {
            'Content-Type': 'text/css; charset=utf-8',
            'Cache-Control': 'public, max-age=86400'
          }
        });
      }

      // Serve 404 CSS
      if (path === '/404.css' && method === 'GET') {
        return new Response(error404Css, {
          headers: {
            'Content-Type': 'text/css; charset=utf-8',
            'Cache-Control': 'public, max-age=86400'
          }
        });
      }

      // Serve 404 JS
      if (path === '/404.js' && method === 'GET') {
        return new Response(error404Js, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400'
          }
        });
      }

      // Short URL redirection
      if (path.length > 1 && path !== '/index.html' && path !== '/index.css' && path !== '/404.css' && path !== '/404.js' && path !== '/favicon.jpg') {
        const key = path.substring(1); // Remove leading slash
        return await handleRedirect(key, env);
      }

      // Serve main page
      if (path === '/' || path === '/index.html') {
        return await serveMainPage(env);
      }

      // 404 for other routes
      return serveErrorPage('페이지를 찾을 수 없습니다');
    } catch (error) {
      console.error('Error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

// Reserved keywords that cannot be used as keys
const RESERVED_KEYWORDS = [
  'api', 'assets', 'favicon.jpg', 'index.html', 'index.css', '404.css', '404.js', 'robots.txt', 'sitemap.xml'
];

// Serve the main HTML page with template variables replaced
async function serveMainPage(env) {
  // Get domain from environment variables or use a default
  const domain = env.DOMAIN || 'vialinks.example.com';
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY || '0x4AAAAAAA-example-site-key';

  // Replace template variables
  // Note: {{MAIN_CSS}} is no longer in index.html as it links to /index.css directly,
  // but we keep the replacement logic just in case or for backward compatibility if index.html is reverted.
  let processedHtml = htmlContent
    .replace(/\{\{MAIN_CSS\}\}/g, cssContent)
    .replace(/\{\{DOMAIN\}\}/g, domain)
    .replace(/\{\{TURNSTILE_SITE_KEY\}\}/g, turnstileSiteKey);

  return new Response(processedHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Set-Cookie': 'dummy=dummy; path=/;'
    }
  });
}

// Normalize URL by adding https:// if no protocol is present
function normalizeUrl(url) {
  if (!url) return url;

  // Trim whitespace
  url = url.trim();

  // If URL already has a protocol (any protocol), return as-is
  if (url.includes('://')) {
    return url;
  }

  // Add https:// prefix if no protocol is present
  return 'https://' + url;
}

// Handle creating short URLs
async function handleCreateShortUrl(request, env, corsHeaders) {
  try {
    const body = await request.json();
    let { key, url, turnstile_token, expires_in } = body;

    // Validate input
    if (!key || !url) {
      return new Response(JSON.stringify({
        status: false,
        reason: '키와 URL이 필요합니다'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Normalize URL by adding https:// if no protocol is present
    url = normalizeUrl(url);

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return new Response(JSON.stringify({
        status: false,
        reason: '유효하지 않은 URL 형식입니다'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Validate key format (alphanumeric and hyphens only)
    if (!/^[a-zA-Z0-9\-_]+$/.test(key)) {
      return new Response(JSON.stringify({
        status: false,
        reason: '키는 영문, 숫자, 하이픈, 언더스코어만 사용 가능합니다'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Check for reserved keywords
    if (RESERVED_KEYWORDS.includes(key.toLowerCase())) {
      return new Response(JSON.stringify({
        status: false,
        reason: '사용할 수 없는 키입니다 (예약어)'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Verify Turnstile token
    if (env.TURNSTILE_SECRET_KEY && turnstile_token) {
      const turnstileResponse = await verifyTurnstile(turnstile_token, env.TURNSTILE_SECRET_KEY);
      if (!turnstileResponse.success) {
        return new Response(JSON.stringify({
          status: false,
          reason: '보안 확인에 실패했습니다'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // Check if key already exists
    const existing = await env.vialinks.get(key);
    if (existing) {
      return new Response(JSON.stringify({
        status: false,
        reason: '이미 사용중인 키입니다'
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Store the URL
    const linkData = {
      type: 'url',
      url: url,
      created_at: new Date().toISOString(),
      clicks: 0
    };

    if (expires_in && expires_in !== 'permanent') {
      const expiresInSeconds = parseInt(expires_in, 10);
      if (!isNaN(expiresInSeconds)) {
        const expirationDate = new Date(Date.now() + expiresInSeconds * 1000);
        linkData.expires_at = expirationDate.toISOString();
      }
    }

    await env.vialinks.put(key, JSON.stringify(linkData));

    return new Response(JSON.stringify({
      status: true,
      key: key
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    console.error('Error creating short URL:', error);
    return new Response(JSON.stringify({
      status: false,
      reason: '서버 오류가 발생했습니다'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// Handle creating pastes
async function handleCreatePaste(request, env, corsHeaders) {
  try {
    const body = await request.json();
    let { key, content, turnstile_token, expires_in } = body;

    // Validate input
    if (!content) {
      return new Response(JSON.stringify({
        status: false,
        reason: '내용이 필요합니다'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Verify Turnstile token
    if (env.TURNSTILE_SECRET_KEY && turnstile_token) {
      const turnstileResponse = await verifyTurnstile(turnstile_token, env.TURNSTILE_SECRET_KEY);
      if (!turnstileResponse.success) {
        return new Response(JSON.stringify({
          status: false,
          reason: '보안 확인에 실패했습니다'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // Generate or Validate Key
    if (key) {
      if (!/^[a-zA-Z0-9\-_]+$/.test(key)) {
        return new Response(JSON.stringify({
          status: false,
          reason: '키는 영문, 숫자, 하이픈, 언더스코어만 사용 가능합니다'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Check for reserved keywords
      if (RESERVED_KEYWORDS.includes(key.toLowerCase())) {
        return new Response(JSON.stringify({
          status: false,
          reason: '사용할 수 없는 키입니다 (예약어)'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Check if key already exists
      const existing = await env.vialinks.get(key);
      if (existing) {
        return new Response(JSON.stringify({
          status: false,
          reason: '이미 사용중인 키입니다'
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    } else {
      // Generate random key
      do {
        key = Math.random().toString(36).substring(2, 8);
      } while (await env.vialinks.get(key) || RESERVED_KEYWORDS.includes(key.toLowerCase()));
    }

    // Store the Paste data
    const pasteData = {
      type: 'paste',
      content: content,
      created_at: new Date().toISOString(),
      clicks: 0 // View count
    };

    if (expires_in && expires_in !== 'permanent') {
      const expiresInSeconds = parseInt(expires_in, 10);
      if (!isNaN(expiresInSeconds)) {
        const expirationDate = new Date(Date.now() + expiresInSeconds * 1000);
        pasteData.expires_at = expirationDate.toISOString();
      }
    }

    await env.vialinks.put(key, JSON.stringify(pasteData));

    return new Response(JSON.stringify({
      status: true,
      key: key
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    console.error('Error creating paste:', error);
    return new Response(JSON.stringify({
      status: false,
      reason: '서버 오류가 발생했습니다'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// Handle QR Code Generation
async function handleQrCode(key, env, request) {
  try {
    const linkDataString = await env.vialinks.get(key);
    if (!linkDataString) {
      return new Response('존재하지 않는 링크입니다', { status: 404 });
    }

    const url = new URL(request.url);
    const targetUrl = `${url.origin}/${key}`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(targetUrl)}`;

    const qrResponse = await fetch(qrApiUrl);

    if (!qrResponse.ok) {
      return new Response('QR 코드 생성 실패', { status: 500 });
    }

    return new Response(qrResponse.body, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600'
      },
    });

  } catch (error) {
    console.error('Error handling QR Code:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// Serve favicon
async function serveFavicon(env) {
  try {
    // Try to serve from R2 if available
    if (env.R2) {
      const faviconObject = await env.R2.get('favicon.jpg');
      if (faviconObject) {
        return new Response(await faviconObject.arrayBuffer(), {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000'
          }
        });
      }
    }

    // Fallback: redirect to external favicon
    return Response.redirect('https://sekaich.at/images/etc/viafavicon.jpg', 302);
  } catch (error) {
    console.error('Error serving favicon:', error);
    // Fallback: redirect to external favicon
    return Response.redirect('https://sekaich.at/images/etc/viafavicon.jpg', 302);
  }
}

// Handle URL redirection
async function handleRedirect(key, env) {
  try {
    const linkDataString = await env.vialinks.get(key);

    if (!linkDataString) {
      if (!linkDataString) {
        return serveErrorPage('존재하지 않는 단축 URL입니다');
      }
    }

    const linkData = JSON.parse(linkDataString);

    // Increment click/view counter
    linkData.clicks = (linkData.clicks || 0) + 1;
    await env.vialinks.put(key, JSON.stringify(linkData));

    // Check for Pastebin type
    if (linkData.type === 'paste') {
      return servePastePage(linkData.content, key);
    }

    // Redirect to the original URL (Short URL)
    return Response.redirect(linkData.url, 302);

  } catch (error) {
    console.error('Error handling redirect:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// Verify Turnstile token
async function verifyTurnstile(token, secretKey) {
  const formData = new FormData();
  formData.append('secret', secretKey);
  formData.append('response', token);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return { success: false };
  }
}

async function handleScheduled(env) {
  let cursor = null;
  do {
    const { keys, list_complete, cursor: newCursor } = await env.vialinks.list({ cursor });
    for (const key of keys) {
      const linkDataString = await env.vialinks.get(key.name);
      if (linkDataString) {
        try {
          const linkData = JSON.parse(linkDataString);
          if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
            await deleteLink(env, key.name);
          }
        } catch (e) {
          console.error('Error parsing JSON for key ' + key.name + ':', e);
        }
      }
    }
    cursor = newCursor;
  } while (cursor);
}

// Helper to delete link and associated QR code
async function deleteLink(env, key) {
  // Delete from KV
  await env.vialinks.delete(key);
}



// Handle URL Lookup
async function handleLookup(request, env, corsHeaders) {
  try {
    const body = await request.json();
    let { query } = body;

    if (!query) {
      return new Response(JSON.stringify({
        status: false,
        reason: 'URL 또는 키를 입력해주세요'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Extract key from URL if full URL is provided
    let key = query;
    try {
      const urlObj = new URL(query);
      // Check if it matches our domain (optional, but good for safety if user pastes full short URL)
      // For now, just assume the last part of the path is the key if it looks like a URL
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      if (pathParts.length > 0) {
        key = pathParts[pathParts.length - 1];
      }
    } catch (e) {
      // Not a URL, assume it's a key
      key = query.trim();
    }

    const linkDataString = await env.vialinks.get(key);

    if (!linkDataString) {
      return new Response(JSON.stringify({
        status: false,
        reason: '존재하지 않거나 만료된 URL입니다'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const linkData = JSON.parse(linkDataString);

    return new Response(JSON.stringify({
      status: true,
      key: key,
      type: linkData.type,
      url: linkData.url, // For 'url' type
      // content: linkData.content, // For 'paste' type, we might not want to send full content here if it's large, but for now it's fine or we can just send metadata
      created_at: linkData.created_at,
      expires_at: linkData.expires_at
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    console.error('Error handling lookup:', error);
    return new Response(JSON.stringify({
      status: false,
      reason: '서버 오류가 발생했습니다'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// Handle Admin Routes
async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Login Page
  if (path === '/admin' && method === 'GET') {
    // Check for session cookie
    const cookie = request.headers.get('Cookie');
    if (cookie && cookie.includes(`admin_session=${env.ADMIN_PW}`)) {
      return await serveAdminPage(env);
    }
    return serveAdminLoginPage();
  }

  // Login API
  if (path === '/api/v1/admin/login' && method === 'POST') {
    try {
      const body = await request.json();
      if (body.password === env.ADMIN_PW) {
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `admin_session=${env.ADMIN_PW}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`
          }
        });
      } else {
        return new Response(JSON.stringify({ success: false, reason: 'Incorrect password' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (e) {
      return new Response('Bad Request', { status: 400 });
    }
  }

  // Delete Link API
  if (path.startsWith('/api/v1/admin/link/') && method === 'DELETE') {
    // Verify Auth
    const cookie = request.headers.get('Cookie');
    if (!cookie || !cookie.includes(`admin_session=${env.ADMIN_PW}`)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const key = path.substring('/api/v1/admin/link/'.length);
    await deleteLink(env, key);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response('Not Found', { status: 404 });
}

// Serve Admin Login Page
function serveAdminLoginPage() {
  return new Response(adminLoginHtml, { headers: { 'Content-Type': 'text/html' } });
}

// Serve Admin Dashboard
async function serveAdminPage(env) {
  // Fetch all links
  let links = [];
  let cursor = null;
  do {
    const list = await env.vialinks.list({ cursor });
    for (const key of list.keys) {
      const dataStr = await env.vialinks.get(key.name);
      if (dataStr) {
        try {
          const data = JSON.parse(dataStr);
          links.push({ key: key.name, ...data });
        } catch (e) { }
      }
    }
    cursor = list.cursor;
  } while (cursor);

  // Sort by created_at desc
  links.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const rows = links.map(link => {
    const typeIcon = link.type === 'paste' ? '<i class="bi bi-file-text"></i>' : '<i class="bi bi-link-45deg"></i>';
    const target = link.type === 'paste' ? 'Paste Content' : `<a href="${link.url}" target="_blank">${link.url}</a>`;
    return `
      <tr>
        <td>${typeIcon} ${link.key}</td>
        <td class="target-cell">${target}</td>
        <td>${link.clicks || 0}</td>
        <td>${new Date(link.created_at).toLocaleString()}</td>
        <td>
          <button class="btn-sm delete-btn" onclick="deleteLink('${link.key}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');

  const html = adminDashboardHtml.replace('{{LINKS_TABLE}}', rows);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function escapeHtml(text) {
  if (!text) return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function servePastePage(content, key) {
  const escapedContent = escapeHtml(content);
  const html = pasteHtml
    .replace(/{{PASTE_KEY}}/g, key)
    .replace('{{PASTE_CONTENT}}', escapedContent);

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function serveErrorPage(reason) {
  const html = errorHtml.replace('{{REASON}}', reason);
  return new Response(html, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
