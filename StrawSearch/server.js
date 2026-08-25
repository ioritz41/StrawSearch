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

function prepareResponse(request, response) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN'
  };

  if (!hasCookie(request, sessionCookie)) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    headers['Set-Cookie'] = `${sessionCookie}=${crypto.randomBytes(18).toString('hex')}; Max-Age=${sessionLifetime}; Path=/; HttpOnly; SameSite=Lax${secure}`;
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
