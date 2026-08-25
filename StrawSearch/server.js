const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const publicDir = fs.existsSync(path.join(__dirname, 'index.html')) ? __dirname : path.join(__dirname, 'public');
const dataFile = fs.existsSync(path.join(__dirname, 'results.json'))
  ? path.join(__dirname, 'results.json')
  : path.join(__dirname, 'data', 'results.json');
const sessionCookie = 'straw_session';
const sessionLifetime = 30 * 60;
const accounts = new Map();
const sessions = new Map();
const histories = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function loadResults() {
  if (!fs.existsSync(dataFile)) {
    return [];
  }

  const raw = fs.readFileSync(dataFile, 'utf8');
  return JSON.parse(raw);
}

function hasCookie(request, name) {
  return (request.headers.cookie || '').split(';').some((cookie) => cookie.trim().startsWith(`${name}=`));
}

function cookieValue(request, name) {
  const cookie = (request.headers.cookie || '').split(';').find((item) => item.trim().startsWith(`${name}=`));
  return cookie ? cookie.trim().slice(name.length + 1) : '';
}

function createSession(request, response) {
  const currentId = cookieValue(request, sessionCookie);
  const current = sessions.get(currentId);
  if (current && current.expiresAt > Date.now()) return current;

  const id = crypto.randomBytes(18).toString('hex');
  const session = { id, username: '', expiresAt: Date.now() + sessionLifetime * 1000 };
  sessions.set(id, session);
  response.sessionCookie = `${sessionCookie}=${id}; Max-Age=${sessionLifetime}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
  return session;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10000) reject(new Error('Request too large'));
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

async function passwordMatches(password, storedHash) {
  const [salt, expected] = storedHash.split(':');
  const actual = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actual.split(':')[1], 'hex'), Buffer.from(expected, 'hex'));
}

function currentUser(request, response) {
  return createSession(request, response).username;
}

function saveHistory(username, query) {
  const now = Date.now();
  const history = (histories.get(username) || []).filter((item) => item.expiresAt > now);
  history.unshift({ query, expiresAt: now + sessionLifetime * 1000 });
  histories.set(username, history.slice(0, 20));
}

function prepareResponse(request, response) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN'
  };

  if (!hasCookie(request, sessionCookie)) {
    if (!response.sessionCookie) createSession(request, response);
    headers['Set-Cookie'] = response.sessionCookie;
  }

  return headers;
}

async function searchDuckDuckGo(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`DuckDuckGo error: ${response.status}`);
    }

    const data = await response.json();
    const items = [];

    if (data.AbstractText && data.AbstractURL) {
      items.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        description: data.AbstractText
      });
    }

    const relatedTopics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];

    for (const topic of relatedTopics) {
      if (!topic) continue;

      if (topic.FirstURL && topic.Text) {
        items.push({
          title: topic.Text.replace(/\s*-\s*.*$/, '').trim() || query,
          url: topic.FirstURL,
          description: topic.Text
        });
      }

      if (Array.isArray(topic.Topics)) {
        for (const subTopic of topic.Topics) {
          if (subTopic.FirstURL && subTopic.Text) {
            items.push({
              title: subTopic.Text.replace(/\s*-\s*.*$/, '').trim() || query,
              url: subTopic.FirstURL,
              description: subTopic.Text
            });
          }
        }
      }
    }

    if (items.length > 0) {
      return items.slice(0, 8);
    }

    const fallback = loadResults();
    const searchTerm = query.toLowerCase();
    return fallback.filter((item) => {
      const haystack = [item.title, item.description, item.url, ...(item.tags || [])]
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchTerm);
    }).slice(0, 8);
  } catch (error) {
    const fallback = loadResults();
    const searchTerm = query.toLowerCase();
    return fallback.filter((item) => {
      const haystack = [item.title, item.description, item.url, ...(item.tags || [])]
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchTerm);
    }).slice(0, 8);
  }
}

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, { ...prepareResponse(req, res), 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveStaticFile(req, res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { ...prepareResponse(req, res), 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('File not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || 'application/octet-stream';

    res.writeHead(200, { ...prepareResponse(req, res), 'Content-Type': contentType });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  createSession(req, res);

  if (req.method === 'POST' && requestUrl.pathname === '/api/auth') {
    (async () => {
      const body = await readRequestBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!/^[a-z0-9_]{3,20}$/.test(username) || password.length < 8) {
        sendJson(req, res, 400, { error: 'Use a username with 3-20 letters, numbers or underscores and a password of at least 8 characters.' });
        return;
      }

      const account = accounts.get(username);
      if (body.action === 'register') {
        if (account) {
          sendJson(req, res, 409, { error: 'That username is already registered.' });
          return;
        }
        accounts.set(username, { passwordHash: await hashPassword(password) });
      } else if (body.action === 'login') {
        if (!account || !(await passwordMatches(password, account.passwordHash))) {
          sendJson(req, res, 401, { error: 'Invalid username or password.' });
          return;
        }
      } else {
        sendJson(req, res, 400, { error: 'Unsupported authentication action.' });
        return;
      }

      const session = createSession(req, res);
      session.username = username;
      session.expiresAt = Date.now() + sessionLifetime * 1000;
      sendJson(req, res, 200, { username, expiresIn: sessionLifetime });
    })().catch(() => sendJson(req, res, 400, { error: 'Invalid authentication request.' }));
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/logout') {
    const session = createSession(req, res);
    const username = session.username;
    session.username = '';
    histories.delete(username);
    sendJson(req, res, 200, { loggedOut: true });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/history') {
    const username = currentUser(req, res);
    const history = username
      ? (histories.get(username) || []).filter((item) => item.expiresAt > Date.now()).map((item) => ({ query: item.query, expiresAt: item.expiresAt }))
      : [];
    sendJson(req, res, 200, { username, history });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/status') {
    sendJson(req, res, 200, { connected: true, message: 'Hello from the StrawSearch server' });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/search') {
    (async () => {
      const query = (requestUrl.searchParams.get('q') || '').trim();
      const results = loadResults();

      if (!query) {
        sendJson(req, res, 200, { query: '', results: results.slice(0, 6) });
        return;
      }

      const apiResults = await searchDuckDuckGo(query);
      const username = currentUser(req, res);
      if (username) saveHistory(username, query);
      sendJson(req, res, 200, { query, results: apiResults.length ? apiResults : [] });
    })().catch((error) => {
      const query = (requestUrl.searchParams.get('q') || '').trim();
      const results = loadResults();
      sendJson(req, res, 200, {
        query,
        results: results.filter((item) => {
          const haystack = [item.title, item.description, item.url, ...(item.tags || [])]
            .join(' ')
            .toLowerCase();
          return haystack.includes(query.toLowerCase());
        }).slice(0, 8)
      });
    });
    return;
  }

  const safePath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { ...prepareResponse(req, res), 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Access denied');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveStaticFile(req, res, filePath);
  } else {
    serveStaticFile(req, res, path.join(publicDir, 'index.html'));
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
