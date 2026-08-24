const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const publicDir = fs.existsSync(path.join(__dirname, 'index.html')) ? __dirname : path.join(__dirname, 'public');
const dataFile = fs.existsSync(path.join(__dirname, 'results.json'))
  ? path.join(__dirname, 'results.json')
  : path.join(__dirname, 'data', 'results.json');

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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('File not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && requestUrl.pathname === '/api/search') {
    (async () => {
      const query = (requestUrl.searchParams.get('q') || '').trim();
      const results = loadResults();

      if (!query) {
        sendJson(res, 200, { query: '', results: results.slice(0, 6) });
        return;
      }

      const apiResults = await searchDuckDuckGo(query);
      sendJson(res, 200, { query, results: apiResults.length ? apiResults : [] });
    })().catch((error) => {
      const query = (requestUrl.searchParams.get('q') || '').trim();
      const results = loadResults();
      sendJson(res, 200, {
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
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Access denied');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveStaticFile(res, filePath);
  } else {
    serveStaticFile(res, path.join(publicDir, 'index.html'));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
