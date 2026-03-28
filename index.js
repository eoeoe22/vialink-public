import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import QRCode from 'qrcode';

const app = new Hono();

// Reserved keywords that cannot be used as keys to prevent conflicts with system routes
const RESERVED_KEYWORDS = [
  'api', 'admin', 'admin-post', 'utils', 'static', 'assets', 'public', 'dashboard', 'login', 'logout',
  'favicon.jpg', 'index.html', 'index.css', '404.css', '404.js', 'robots.txt', 'sitemap.xml', 'ads.txt',
  'utils.html', 'health', 'status', 'home'
];

// CORS Middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// API Routes
app.post('/api/v1/short/', async (c) => {
  return await handleCreateShortUrl(c);
});

app.post('/api/v1/paste/', async (c) => {
  return await handleCreatePaste(c);
});

app.get('/api/v1/qr/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  return await handleQrCode(c, key);
});

app.post('/api/v1/lookup', async (c) => {
  return await handleLookup(c);
});

// Admin Routes
app.get('/admin', async (c) => {
  return await handleAdminPage(c);
});

app.post('/api/v1/admin/login', async (c) => {
  return await handleAdminLogin(c);
});

app.post('/api/v1/admin/logout', async (c) => {
  return await handleAdminLogout(c);
});

app.post('/api/v1/admin/link/:key/expire', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  return await handleAdminExpireLink(c, key);
});

app.delete('/api/v1/admin/link/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  return await handleAdminDeleteLink(c, key);
});

app.delete('/api/v1/admin/expired-link/:id', async (c) => {
  const id = c.req.param('id');
  return await handleAdminDeleteExpiredLink(c, id);
});

app.post('/api/v1/admin/page', async (c) => {
  return await handleAdminCreatePage(c);
});

app.post('/api/v1/admin/image', async (c) => {
  return await handleAdminCreateImage(c);
});

app.get('/admin/post', async (c) => {
  return await handleAdminPostPage(c);
});

app.put('/api/v1/admin/link/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  return await handleAdminUpdateLink(c, key);
});

app.post('/api/v1/admin/link/:key/extend', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  return await handleAdminExtendLink(c, key);
});

app.post('/api/v1/admin/page/:key/deactivate', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  return await handleAdminExpireLink(c, key);
});

app.post('/api/v1/admin/page/:id/activate', async (c) => {
  const id = c.req.param('id');
  return await handleAdminActivatePage(c, id);
});

app.get('/api/v1/admin/link/:key/raw', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  return await handleAdminRawContent(c, key);
});

app.get('/api/v1/admin/expired-link/:id/raw', async (c) => {
  const id = c.req.param('id');
  return await handleAdminRawExpiredContent(c, id);
});

app.get('/api/v1/admin/dashboard-data', async (c) => {
  return await handleAdminDashboardData(c);
});

// Main Pages
app.get('/', async (c) => {
  return await serveMainPage(c);
});

app.get('/index.html', async (c) => {
  return await serveMainPage(c);
});

// Redirect /utils to /utils.html (which is served by Assets)
app.get('/utils', (c) => {
  return c.redirect('/utils.html');
});

// Short URL redirection (Catch-all for paths longer than 1 character)
app.get('/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));

  // Basic check for static-like paths if not caught by Assets
  if (RESERVED_KEYWORDS.includes(key.toLowerCase()) || key.includes('.')) {
    return c.notFound();
  }

  return await handleRedirect(c, key);
});

// Fallback for Assets and 404
app.notFound(async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;

  // Try to serve from Assets if it looks like a static file or is a reserved keyword
  if (path.includes('.') || RESERVED_KEYWORDS.includes(path.slice(1).toLowerCase())) {
    if (c.env.ASSETS) {
      return await c.env.ASSETS.fetch(c.req.raw);
    }
  }

  return await serveErrorPage(c, '페이지를 찾을 수 없습니다');
});

// --- Helper Functions ---

// Fetch asset content from Cloudflare Workers Assets
async function getAsset(c, path) {
  const env = c.env;
  if (!env.ASSETS) {
    throw new Error('ASSETS binding not found');
  }
  const url = new URL(path, c.req.url);
  const response = await env.ASSETS.fetch(new Request(url.toString()));
  if (!response.ok) {
    throw new Error(`Failed to fetch asset ${path}: ${response.statusText}`);
  }
  return await response.text();
}

// Serve the main HTML page with template variables replaced
async function serveMainPage(c) {
  const env = c.env;
  const domain = env.DOMAIN || 'vialinks.xyz';
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY || '0x4AAAAAAA-example-site-key';

  let htmlContent = '';
  try {
    htmlContent = await getAsset(c, '/assets/templates/index.html');
  } catch (e) {
    console.error('Failed to load index.html from assets:', e);
    return c.text('Critical Error: Failed to load main page assets.', 500);
  }

  let processedHtml = htmlContent
    .replace(/\{\{DOMAIN\}\}/g, domain)
    .replace(/\{\{TURNSTILE_SITE_KEY\}\}/g, turnstileSiteKey);

  return c.html(processedHtml, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Set-Cookie': 'dummy=dummy; path=/;'
    }
  });
}

// Normalize URL by adding https:// if no protocol is present
function normalizeUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (url.includes('://')) return url;
  return 'https://' + url;
}

// Handle creating short URLs
async function handleCreateShortUrl(c) {
  const env = c.env;
  try {
    const body = await c.req.json();
    let { key, url, turnstile_token, expires_in, is_encrypted, enc_data } = body;

    if (!key || !url) {
      return c.json({ status: false, reason: '키와 URL이 필요합니다' }, 400);
    }

    url = normalizeUrl(url);

    try {
      new URL(url);
    } catch {
      return c.json({ status: false, reason: '유효하지 않은 URL 형식입니다' }, 400);
    }

    if (!/^[a-zA-Z0-9\-_ㄱ-ㅎ가-힣]+$/.test(key)) {
      return c.json({ status: false, reason: '키는 한글, 영문, 숫자, 하이픈, 언더스코어만 사용 가능합니다' }, 400);
    }

    if (RESERVED_KEYWORDS.includes(key.toLowerCase())) {
      return c.json({ status: false, reason: '사용할 수 없는 키입니다 (예약어)' }, 400);
    }

    if (env.TURNSTILE_SECRET_KEY && turnstile_token) {
      const turnstileResponse = await verifyTurnstile(turnstile_token, env.TURNSTILE_SECRET_KEY);
      if (!turnstileResponse.success) {
        return c.json({ status: false, reason: '보안 확인에 실패했습니다' }, 400);
      }
    }

    const existing = await env.vialinks.get(key);
    if (existing) {
      return c.json({ status: false, reason: '이미 사용중인 키입니다' }, 409);
    }

    const uid = crypto.randomUUID();
    const linkData = {
      uid: uid,
      type: 'url',
      url: url,
      created_at: new Date().toISOString()
    };

    // Enforce max 7 days for public creation
    const maxExpiresIn = 604800; // 7 days
    let effectiveExpiresIn = maxExpiresIn;

    if (expires_in && expires_in !== 'permanent') {
      const expiresInSeconds = parseInt(expires_in, 10);
      if (!isNaN(expiresInSeconds)) {
        effectiveExpiresIn = Math.min(expiresInSeconds, maxExpiresIn);
      }
    }
    const expirationDate = new Date(Date.now() + effectiveExpiresIn * 1000);
    linkData.expires_at = expirationDate.toISOString();

    if (is_encrypted && enc_data) {
      linkData.is_encrypted = true;
      linkData.enc_data = enc_data;
    }

    await env.vialinks.put(key, JSON.stringify(linkData));
    return c.json({ status: true, key: key });

  } catch (error) {
    console.error('Error creating short URL:', error);
    return c.json({ status: false, reason: '서버 오류가 발생했습니다' }, 500);
  }
}

// Handle creating pastes
async function handleCreatePaste(c) {
  const env = c.env;
  try {
    const body = await c.req.json();
    let { key, content, turnstile_token, expires_in, is_encrypted, enc_data } = body;

    if (!content) {
      return c.json({ status: false, reason: '내용이 필요합니다' }, 400);
    }

    if (env.TURNSTILE_SECRET_KEY && turnstile_token) {
      const turnstileResponse = await verifyTurnstile(turnstile_token, env.TURNSTILE_SECRET_KEY);
      if (!turnstileResponse.success) {
        return c.json({ status: false, reason: '보안 확인에 실패했습니다' }, 400);
      }
    }

    if (key) {
      if (!/^[a-zA-Z0-9\-_ㄱ-ㅎ가-힣]+$/.test(key)) {
        return c.json({ status: false, reason: '키는 한글, 영문, 숫자, 하이픈, 언더스코어만 사용 가능합니다' }, 400);
      }
      if (RESERVED_KEYWORDS.includes(key.toLowerCase())) {
        return c.json({ status: false, reason: '사용할 수 없는 키입니다 (예약어)' }, 400);
      }
      const existing = await env.vialinks.get(key);
      if (existing) {
        return c.json({ status: false, reason: '이미 사용중인 키입니다' }, 409);
      }
    } else {
      do {
        key = Math.random().toString(36).substring(2, 8);
      } while (await env.vialinks.get(key) || RESERVED_KEYWORDS.includes(key.toLowerCase()));
    }

    const uid = crypto.randomUUID();
    const pasteData = {
      uid: uid,
      type: 'paste',
      content: content,
      created_at: new Date().toISOString()
    };

    // Enforce max 7 days for public creation
    const maxExpiresIn = 604800; // 7 days
    let effectiveExpiresIn = maxExpiresIn;

    if (expires_in && expires_in !== 'permanent') {
      const expiresInSeconds = parseInt(expires_in, 10);
      if (!isNaN(expiresInSeconds)) {
        effectiveExpiresIn = Math.min(expiresInSeconds, maxExpiresIn);
      }
    }
    const expirationDate = new Date(Date.now() + effectiveExpiresIn * 1000);
    pasteData.expires_at = expirationDate.toISOString();

    if (is_encrypted && enc_data) {
      pasteData.is_encrypted = true;
      pasteData.enc_data = enc_data;
    }

    await env.vialinks.put(key, JSON.stringify(pasteData));
    return c.json({ status: true, key: key });

  } catch (error) {
    console.error('Error creating paste:', error);
    return c.json({ status: false, reason: '서버 오류가 발생했습니다' }, 500);
  }
}

// Handle QR Code Generation
async function handleQrCode(c, key) {
  const env = c.env;
  try {
    const linkDataString = await env.vialinks.get(key);
    if (!linkDataString) {
      return c.text('존재하지 않는 링크입니다', 404);
    }

    const url = new URL(c.req.url);
    const targetUrl = `${url.origin}/${key}`;

    const qrBuffer = await QRCode.toBuffer(targetUrl, {
      type: 'png',
      margin: 1,
      width: 200,
      errorCorrectionLevel: 'H'
    });

    return new Response(qrBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600'
      },
    });

  } catch (error) {
    console.error('Error handling QR Code:', error);
    return c.text('Internal Server Error', 500);
  }
}

// Handle URL redirection
async function handleRedirect(c, key) {
  const env = c.env;
  try {
    const linkDataString = await env.vialinks.get(key);

    if (!linkDataString) {
      return await serveErrorPage(c, '존재하지 않는 단축 URL입니다');
    }

    const linkData = JSON.parse(linkDataString);

    if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
      return await serveErrorPage(c, '만료된 링크입니다');
    }

    if (env.STATS) {
      env.STATS.writeDataPoint({
        blobs: [key, linkData.uid || 'legacy'],
        doubles: [1],
        indexes: [linkData.uid || 'legacy'],
      });
    }

    if (linkData.is_encrypted) {
      return await servePasswordPage(c, key, linkData.type, linkData.enc_data);
    }

    if (linkData.type === 'paste') {
      return await servePastePage(c, linkData.content, key);
    }

    if (linkData.type === 'page') {
      const r2Key = linkData.r2_key || `pages/${linkData.uid || key}.html`;
      const object = await env.R2.get(r2Key);
      if (!object) {
        return await serveErrorPage(c, '페이지 콘텐츠를 찾을 수 없습니다');
      }
      return new Response(await object.text(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=60'
        }
      });
    }

    if (linkData.type === 'image') {
      const object = await env.R2.get(linkData.r2_key);
      if (!object) {
        return await serveErrorPage(c, '이미지를 찾을 수 없습니다');
      }
      return new Response(object.body, {
        headers: {
          'Content-Type': linkData.content_type || 'image/png',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    if (linkData.type === 'file') {
      const raw = c.req.query('raw');
      if (raw === '1') {
        const object = await env.R2.get(linkData.r2_key);
        if (!object) {
          return await serveErrorPage(c, '파일을 찾을 수 없습니다');
        }
        return new Response(object.body, {
          headers: {
            'Content-Type': linkData.content_type || 'application/octet-stream',
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }
      const download = c.req.query('download');
      if (download === '1') {
        const object = await env.R2.get(linkData.r2_key);
        if (!object) {
          return await serveErrorPage(c, '파일을 찾을 수 없습니다');
        }
        const fileName = linkData.original_name || key;
        return new Response(object.body, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }
      const isPdf = (linkData.content_type || '').toLowerCase() === 'application/pdf';
      return await serveFilePage(c, key, linkData, isPdf);
    }

    const userAgent = c.req.header('User-Agent') || '';
    if (isCrawler(userAgent)) {
      const targetUrl = linkData.url;
      let displayDomain = 'VIALinks';
      try {
        displayDomain = new URL(targetUrl).hostname;
      } catch (e) { }

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>VIALinks</title>
  <meta property="og:title" content="${displayDomain}">
  <meta property="og:description" content="${targetUrl}">
  <meta property="og:image" content="https://sekaich.at/images/etc/viapreview.png">
  <meta name="theme-color" content="#87CEEB">
  <meta http-equiv="refresh" content="0;url=${targetUrl}">
</head>
<body>
  <p>Redirecting to <a href="${targetUrl}">${targetUrl}</a>...</p>
</body>
</html>`;
      return c.html(html);
    }

    return c.redirect(linkData.url, 302);

  } catch (error) {
    console.error('Error handling redirect:', error);
    return c.text('Internal Server Error', 500);
  }
}

function isCrawler(userAgent) {
  const crawlers = ['Twitterbot', 'facebookexternalhit', 'Facebot', 'TelegramBot', 'Slackbot', 'Discordbot', 'WhatsApp', 'bingbot', 'Googlebot', 'Baiduspider', 'YandexBot', 'LinkedInBot'];
  return crawlers.some(crawler => userAgent.includes(crawler));
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
    return await response.json();
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return { success: false };
  }
}

// Admin Logic Functions
function isAdmin(c) {
  const env = c.env;
  if (!env.ADMIN_PW) return false;
  return getCookie(c, 'admin_session') === env.ADMIN_PW;
}

async function handleAdminPage(c) {
  if (isAdmin(c)) {
    return await serveAdminDashboard(c);
  }
  return await serveAdminLoginPage(c);
}

async function serveAdminLoginPage(c) {
  const env = c.env;
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY || '0x4AAAAAAA-example-site-key';
  let adminLoginHtml = '';
  try {
    adminLoginHtml = await getAsset(c, '/assets/templates/admin-login.html');
  } catch (e) {
    console.error('Failed to load admin-login.html:', e);
    return c.text('Critical Error: Failed to load admin login assets.', 500);
  }
  const html = adminLoginHtml.replace('{{TURNSTILE_SITE_KEY}}', turnstileSiteKey);
  return c.html(html);
}

function getRemainingTime(expiresAt) {
  if (!expiresAt) return '영구';
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diff = expiry - now;
  if (diff <= 0) return '만료됨';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

async function serveAdminDashboard(c) {
  let adminDashboardHtml = '';
  try {
    adminDashboardHtml = await getAsset(c, '/assets/templates/admin-dashboard.html');
  } catch (e) {
    console.error('Failed to load admin-dashboard.html:', e);
    return c.text('Critical Error: Failed to load admin dashboard assets.', 500);
  }
  return c.html(adminDashboardHtml);
}

async function handleAdminDashboardData(c) {
  if (!isAdmin(c)) return c.json({ success: false, reason: 'Unauthorized' }, 401);
  const env = c.env;

  // Read all KV pairs, collect active ones and expired ones separately
  let activeLinks = [];
  let expiredToArchive = [];
  let cursor = null;
  do {
    const list = await env.vialinks.list({ cursor });
    for (const kvKey of list.keys) {
      const dataStr = await env.vialinks.get(kvKey.name);
      if (!dataStr) continue;
      try {
        const data = JSON.parse(dataStr);
        if (data.expires_at && new Date(data.expires_at) < new Date()) {
          // Collect expired links for background archiving (non-blocking)
          expiredToArchive.push({ key: kvKey.name, data });
        } else {
          activeLinks.push({ key: kvKey.name, ...data, clicks: 0 });
        }
      } catch (e) { }
    }
    cursor = list.cursor;
  } while (cursor);

  activeLinks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Query analytics click counts
  if (env.STATS && activeLinks.length > 0) {
    const query = `SELECT sum(_sample_interval) as clicks, blob2 as uid, blob1 as link_key FROM vialinks_prod GROUP BY blob2, blob1`;
    try {
      const queryResult = await queryAnalytics(env, query);
      if (queryResult && queryResult.data) {
        const clicksMap = new Map();
        queryResult.data.forEach(row => {
          const count = Number(row.clicks) || 0;
          if (row.uid && row.uid !== 'legacy') clicksMap.set(row.uid, count);
          else if (row.link_key) clicksMap.set(row.link_key, count);
        });
        activeLinks.forEach(link => {
          link.clicks = (link.uid && link.uid !== 'legacy')
            ? (clicksMap.get(link.uid) || 0)
            : (clicksMap.get(link.key) || 0);
        });
      }
    } catch (e) { console.error("Failed to query Analytics Engine:", e); }
  }

  // Fetch archived links from D1
  let expiredLinks = [];
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare('SELECT * FROM expired_links ORDER BY expired_at DESC LIMIT 100').all();
      expiredLinks = results;
    } catch (e) { console.error("D1 Error", e); }
  }

  // Archive expired links in background without blocking the response
  if (expiredToArchive.length > 0) {
    c.executionCtx.waitUntil(
      (async () => {
        for (const { key, data } of expiredToArchive) {
          try {
            const archived = await archiveLinkToD1(env, key, data);
            if (archived) await env.vialinks.delete(key);
          } catch (e) { console.error('Background archive error:', e); }
        }
      })()
    );
  }

  return c.json({ success: true, activeLinks, expiredLinks });
}

async function handleAdminLogin(c) {
  const env = c.env;
  try {
    const body = await c.req.json();
    if (env.TURNSTILE_SECRET_KEY && body.turnstile_token) {
      const tr = await verifyTurnstile(body.turnstile_token, env.TURNSTILE_SECRET_KEY);
      if (!tr.success) return c.json({ success: false, reason: '보안 확인 실패' }, 400);
    } else if (env.TURNSTILE_SECRET_KEY && !body.turnstile_token) {
      return c.json({ success: false, reason: '보안 확인이 필요합니다' }, 400);
    }

    if (body.password === env.ADMIN_PW) {
      setCookie(c, 'admin_session', env.ADMIN_PW, {
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 604800 // 7 days
      });
      return c.json({ success: true });
    } else {
      return c.json({ success: false, reason: '비밀번호가 일치하지 않습니다' }, 401);
    }
  } catch (e) { return c.text('Bad Request', 400); }
}

async function handleAdminLogout(c) {
  deleteCookie(c, 'admin_session', { path: '/' });
  return c.json({ success: true });
}

async function handleAdminExpireLink(c, key) {
  const env = c.env;
  if (!isAdmin(c)) return c.text('Unauthorized', 401);

  const dataStr = await env.vialinks.get(key);
  if (dataStr) {
    let data;
    try {
      data = JSON.parse(dataStr);
    } catch (e) {
      console.error('JSON Parse Error:', e);
      return c.json({ success: false, reason: '데이터 파싱 오류' }, 500);
    }
    const archived = await archiveLinkToD1(env, key, data);
    if (archived) {
      await env.vialinks.delete(key);
      return c.json({ success: true });
    } else {
      return c.json({ success: false, reason: '아카이브 실패 (DB 연결 확인 필요)' }, 500);
    }
  }
  return c.text('Not Found', 404);
}

async function handleAdminDeleteLink(c, key) {
  const env = c.env;
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const dataStr = await env.vialinks.get(key);
  if (dataStr) {
    const data = JSON.parse(dataStr);
    if ((data.type === 'page' || data.type === 'image') && data.r2_key && env.R2) {
      await env.R2.delete(data.r2_key);
    }
  }
  await env.vialinks.delete(key);
  return c.json({ success: true });
}

async function handleAdminDeleteExpiredLink(c, id) {
  const env = c.env;
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  if (!env.DB) return c.json({ success: false, reason: 'DB not configured' }, 500);

  const idInt = parseInt(id, 10);
  const row = await env.DB.prepare('SELECT * FROM expired_links WHERE id = ?').bind(idInt).first();
  if ((row?.type === 'page' || row?.type === 'image') && row?.r2_key && env.R2) {
    await env.R2.delete(row.r2_key);
  }
  await env.DB.prepare('DELETE FROM expired_links WHERE id = ?').bind(idInt).run();
  return c.json({ success: true });
}

async function handleAdminCreatePage(c) {
  const env = c.env;
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  try {
    const { key, content } = await c.req.json();
    if (!key || !content) return c.json({ success: false, reason: '키와 페이지 내용이 필요합니다' }, 400);
    if (!/^[a-zA-Z0-9\-_ㄱ-ㅎ가-힣]+$/.test(key)) return c.json({ success: false, reason: '키 형식이 올바르지 않습니다' }, 400);
    if (RESERVED_KEYWORDS.includes(key.toLowerCase())) return c.json({ success: false, reason: '예약어는 사용할 수 없습니다' }, 400);
    if (await isKeyAlreadyUsed(env, key)) return c.json({ success: false, reason: '이미 사용중인 키입니다' }, 409);

    const uid = crypto.randomUUID();
    const r2Key = `pages/${uid}.html`;
    await env.R2.put(r2Key, content, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
    await env.vialinks.put(key, JSON.stringify({ uid, type: 'page', r2_key: r2Key, created_at: new Date().toISOString() }));
    return c.json({ success: true, key });
  } catch (e) {
    console.error('Error creating page:', e);
    return c.json({ success: false, reason: '서버 오류' }, 500);
  }
}

async function handleAdminUpdateLink(c, key) {
  const env = c.env;
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  try {
    const dataStr = await env.vialinks.get(key);
    if (!dataStr) return c.text('Not Found', 404);
    const data = JSON.parse(dataStr);
    const body = await c.req.json();

    if (data.type === 'page') {
      if (!body.content) return c.json({ success: false, reason: '페이지 내용이 필요합니다' }, 400);
      await env.R2.put(data.r2_key, body.content, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
    } else if (data.type === 'paste') {
      if (!body.content) return c.json({ success: false, reason: '내용이 필요합니다' }, 400);
      data.content = body.content;
    } else if (data.type === 'url') {
      if (!body.url) return c.json({ success: false, reason: 'URL이 필요합니다' }, 400);
      data.url = normalizeUrl(body.url);
    } else {
      return c.json({ success: false, reason: '수정할 수 없는 타입입니다' }, 400);
    }

    data.updated_at = new Date().toISOString();
    await env.vialinks.put(key, JSON.stringify(data));
    return c.json({ success: true });
  } catch (e) {
    console.error('Error updating link:', e);
    return c.json({ success: false, reason: '서버 오류' }, 500);
  }
}

async function handleAdminExtendLink(c, key) {
  const env = c.env;
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  try {
    const dataStr = await env.vialinks.get(key);
    if (!dataStr) return c.text('Not Found', 404);
    const data = JSON.parse(dataStr);
    const { expires_in } = await c.req.json();

    if (expires_in === 'permanent') {
      delete data.expires_at;
    } else {
      const seconds = parseInt(expires_in, 10);
      if (isNaN(seconds)) return c.json({ success: false, reason: '잘못된 만료 시간입니다' }, 400);
      data.expires_at = new Date(Date.now() + seconds * 1000).toISOString();
    }

    await env.vialinks.put(key, JSON.stringify(data));
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, reason: '서버 오류' }, 500);
  }
}

async function handleAdminCreateImage(c) {
  const env = c.env;
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  try {
    const formData = await c.req.formData();
    const key = formData.get('key');
    const file = formData.get('file');
    if (!key || !file) return c.json({ success: false, reason: '키와 파일이 필요합니다' }, 400);
    if (!/^[a-zA-Z0-9\-_ㄱ-ㅎ가-힣]+$/.test(key)) return c.json({ success: false, reason: '키 형식이 올바르지 않습니다' }, 400);
    if (RESERVED_KEYWORDS.includes(key.toLowerCase())) return c.json({ success: false, reason: '예약어는 사용할 수 없습니다' }, 400);
    if (await isKeyAlreadyUsed(env, key)) return c.json({ success: false, reason: '이미 사용중인 키입니다' }, 409);

    const uid = crypto.randomUUID();
    const ext = file.name.split('.').pop() || 'bin';
    const contentType = file.type || 'application/octet-stream';
    const isImage = contentType.startsWith('image/');
    const r2Key = `files/${uid}.${ext}`;
    const arrayBuffer = await file.arrayBuffer();
    await env.R2.put(r2Key, arrayBuffer, { httpMetadata: { contentType } });
    const type = isImage ? 'image' : 'file';
    await env.vialinks.put(key, JSON.stringify({ uid, type, r2_key: r2Key, content_type: contentType, original_name: file.name, created_at: new Date().toISOString() }));
    return c.json({ success: true, key });
  } catch (e) {
    console.error('Error creating image:', e);
    return c.json({ success: false, reason: '서버 오류' }, 500);
  }
}

async function handleAdminPostPage(c) {
  if (isAdmin(c)) {
    let html = '';
    try {
      html = await getAsset(c, '/assets/templates/admin-post.html');
    } catch (e) {
      console.error('Failed to load admin-post.html:', e);
      return c.text('Critical Error: Failed to load admin post assets.', 500);
    }
    return c.html(html);
  }
  return c.redirect('/admin');
}

async function handleAdminActivatePage(c, id) {
  const env = c.env;
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  if (!env.DB) return c.json({ success: false, reason: 'DB not configured' }, 500);

  const idInt = parseInt(id, 10);
  const row = await env.DB.prepare('SELECT * FROM expired_links WHERE id = ?').bind(idInt).first();
  if (!row || row.type !== 'page') return c.text('Not Found', 404);
  if (await env.vialinks.get(row.key)) return c.json({ success: false, reason: '활성 상태 키와 충돌합니다' }, 409);

  const uid = row.uid || crypto.randomUUID();
  const r2Key = row.r2_key || `pages/${uid}.html`;
  if (row.content) {
    await env.R2.put(r2Key, row.content, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
  } else {
    const object = await env.R2.get(r2Key);
    if (!object) return c.json({ success: false, reason: '복구할 페이지 HTML이 없습니다' }, 500);
  }
  await env.vialinks.put(row.key, JSON.stringify({ uid, type: 'page', r2_key: r2Key, created_at: row.created_at || new Date().toISOString(), updated_at: new Date().toISOString() }));
  await env.DB.prepare('DELETE FROM expired_links WHERE id = ?').bind(idInt).run();
  return c.json({ success: true });
}

async function handleAdminRawContent(c, key) {
  const env = c.env;
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const dataStr = await env.vialinks.get(key);
  if (!dataStr) return c.text('Not Found', 404);
  const data = JSON.parse(dataStr);
  if (data.type === 'paste') return c.text(data.content || '');
  if (data.type === 'page') {
    const object = await env.R2.get(data.r2_key);
    if (!object) return c.text('Not Found', 404);
    return c.text(await object.text());
  }
  return c.text(data.url || '');
}

async function handleAdminRawExpiredContent(c, id) {
  const env = c.env;
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  if (!env.DB) return c.json({ success: false, reason: 'DB not configured' }, 500);
  const idInt = parseInt(id, 10);
  const row = await env.DB.prepare('SELECT * FROM expired_links WHERE id = ?').bind(idInt).first();
  if (!row) return c.text('Not Found', 404);
  if (row.type === 'paste' || row.type === 'page') return c.text(row.content || '');
  return c.text(row.original_url || '');
}

async function isKeyAlreadyUsed(env, key) {
  const active = await env.vialinks.get(key);
  if (active) return true;
  if (!env.DB) return false;
  const inactive = await env.DB.prepare('SELECT id FROM expired_links WHERE key = ? LIMIT 1').bind(key).first();
  return !!inactive;
}

// Lookup Logic
async function handleLookup(c) {
  const env = c.env;
  try {
    const body = await c.req.json();
    let { query } = body;
    if (!query) return c.json({ status: false, reason: 'URL 또는 키를 입력해주세요' }, 400);

    let key = query;
    try {
      const urlObj = new URL(query);
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      if (pathParts.length > 0) key = decodeURIComponent(pathParts[pathParts.length - 1]);
    } catch (e) { key = query.trim(); }

    const dataStr = await env.vialinks.get(key);
    if (!dataStr) return c.json({ status: false, reason: '존재하지 않거나 만료된 URL입니다' }, 404);

    const data = JSON.parse(dataStr);
    const result = { status: true, key, type: data.type, url: data.url, created_at: data.created_at, expires_at: data.expires_at };
    if (data.is_encrypted) result.is_encrypted = true;
    if (data.content_type) result.content_type = data.content_type;
    return c.json(result);
  } catch (e) { return c.json({ status: false, reason: '서버 오류가 발생했습니다' }, 500); }
}

// Utility functions
function escapeHtml(text) {
  if (!text) return text;
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function servePastePage(c, content, key) {
  const escaped = escapeHtml(content);
  let preview = content.substring(0, 150).replace(/\r?\n|\r/g, " ");
  if (content.length > 150) preview += "....";
  let pasteHtml = '';
  try {
    pasteHtml = await getAsset(c, '/assets/templates/paste.html');
  } catch (e) {
    console.error('Failed to load paste.html:', e);
    return c.text('Critical Error: Failed to load paste assets.', 500);
  }
  const html = pasteHtml.replace(/\{\{PASTE_KEY\}\}/g, key).replace('{{PASTE_CONTENT}}', escaped).replace('{{PASTE_PREVIEW}}', escapeHtml(preview));
  return c.html(html);
}

async function serveFilePage(c, key, linkData, isPdf) {
  let fileHtml = '';
  try {
    fileHtml = await getAsset(c, '/assets/templates/file.html');
  } catch (e) {
    console.error('Failed to load file.html:', e);
    return c.text('Critical Error: Failed to load file assets.', 500);
  }
  const fileName = escapeHtml(linkData.original_name || key);
  const downloadUrl = `/${encodeURIComponent(key)}?download=1`;
  const rawUrl = `/${encodeURIComponent(key)}?raw=1`;
  const pdfSection = isPdf
    ? `<div class="pdf-preview"><iframe src="${rawUrl}" title="PDF 미리보기"></iframe></div>`
    : '';
  const html = fileHtml
    .replace(/\{\{FILE_KEY\}\}/g, escapeHtml(key))
    .replace(/\{\{FILE_NAME\}\}/g, fileName)
    .replace(/\{\{DOWNLOAD_URL\}\}/g, downloadUrl)
    .replace(/\{\{PDF_SECTION\}\}/g, pdfSection);
  return c.html(html);
}

async function serveErrorPage(c, reason) {
  let errorHtml = '';
  try {
    errorHtml = await getAsset(c, '/assets/templates/error.html');
  } catch (e) {
    console.error('Failed to load error.html from assets:', e);
    // Fallback error page
    return c.html(`<!DOCTYPE html><html><body><h1>Error</h1><p>${reason}</p></body></html>`, 404);
  }
  const html = errorHtml.replace('{{REASON}}', reason);
  return c.html(html, 404);
}

async function servePasswordPage(c, key, type, encData = null) {
  let passwordHtml = '';
  try {
    passwordHtml = await getAsset(c, '/assets/templates/password.html');
  } catch (e) {
    console.error('Failed to load password.html:', e);
    return c.text('Critical Error: Failed to load password page assets.', 500);
  }
  let html = passwordHtml.replace(/\{\{KEY\}\}/g, key).replace(/\{\{TYPE\}\}/g, type);
  if (encData) {
    html = html.replace('/*{{ENCRYPTED_DATA_JSON}}*/ null', JSON.stringify(encData)).replace('{{IS_ENCRYPTED}}', 'true');
  } else {
    html = html.replace('{{IS_ENCRYPTED}}', 'false').replace('/*{{ENCRYPTED_DATA_JSON}}*/ null', 'null');
  }
  return c.html(html);
}

async function queryAnalytics(env, query) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    console.error("Missing CF_ACCOUNT_ID or CF_API_TOKEN environment variables. Analytics query skipped.");
    return { data: [] };
  }
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_API_TOKEN}`
      },
      body: query,
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Analytics Engine error: ${response.status} - ${errorText}`);
      return { data: [] };
    }
    return await response.json();
  } catch (e) {
    console.error('Analytics Engine fetch failed:', e);
    return { data: [] };
  }
}


async function archiveLinkToD1(env, key, data) {
  if (!env.DB) return false;
  try {
    let archivedContent = data.content || null;
    if ((data.type === 'page') && data.r2_key && env.R2) {
      const object = await env.R2.get(data.r2_key);
      if (object) archivedContent = await object.text();
    }
    if (data.type === 'image' && data.r2_key && env.R2) {
      archivedContent = null;
    }
    let clicks = 0;
    if (env.STATS) {
      const query = (data.uid && data.uid !== 'legacy')
        ? `SELECT sum(_sample_interval) as clicks FROM vialinks_prod WHERE blob2 = '${data.uid}'`
        : `SELECT sum(_sample_interval) as clicks FROM vialinks_prod WHERE blob1 = '${key}'`;
      const res = await queryAnalytics(env, query);
      if (res?.data?.length > 0) clicks = Number(res.data[0].clicks) || 0;
    }

    // Detect available columns by attempting inserts, falling back gracefully
    // Known real schema: id, key, type, original_url, content, created_at, expired_at, clicks, uid
    // Optional columns (may not exist in older deployments): r2_key

    // Build insert dynamically based on what columns exist
    const tryInsert = async (includeUid, includeR2Key) => {
      const cols = ['key'];
      const placeholders = ['?'];
      const binds = [key];

      if (includeUid) { cols.push('uid'); placeholders.push('?'); binds.push(data.uid || null); }
      cols.push('type'); placeholders.push('?'); binds.push(data.type);
      cols.push('original_url'); placeholders.push('?'); binds.push(data.url || null);
      cols.push('content'); placeholders.push('?'); binds.push(archivedContent);
      if (includeR2Key) { cols.push('r2_key'); placeholders.push('?'); binds.push(data.r2_key || null); }
      cols.push('created_at'); placeholders.push('?'); binds.push(data.created_at || new Date().toISOString());
      cols.push('expired_at'); placeholders.push('?'); binds.push(data.expires_at || new Date().toISOString());
      cols.push('clicks'); placeholders.push('?'); binds.push(clicks);

      const sql = `INSERT INTO expired_links (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
      await env.DB.prepare(sql).bind(...binds).run();
    };

    // Try all combinations, removing optional columns one by one if they don't exist
    let inserted = false;
    for (const [uid, r2] of [[true, true], [true, false], [false, true], [false, false]]) {
      try {
        await tryInsert(uid, r2);
        inserted = true;
        if (!uid) console.warn('Inserted without uid column. Run: ALTER TABLE expired_links ADD COLUMN uid TEXT;');
        if (!r2) console.warn('Inserted without r2_key column. Run: ALTER TABLE expired_links ADD COLUMN r2_key TEXT;');
        break;
      } catch (e) {
        if (e.message && e.message.includes('no column named')) continue;
        throw e;
      }
    }
    if (!inserted) throw new Error('Could not insert into expired_links: no compatible schema found');

    return true;
  } catch (e) {
    console.error('Archive Error:', e);
    return false;
  }
}

export default {
  fetch: app.fetch,
};
