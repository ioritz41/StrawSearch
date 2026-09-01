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

const searchService = {
  maxResults: 8,
  
  extractResult(text, query = "") {
    return {
      title: text.replace(/\s*-\s*.*$/, '').trim() || query,
      description: text
    };
  },

  filterByQuery(items, query) {
    const searchTerm = query.toLowerCase();
    return items.filter((item) => {
      const haystack = [
        item.title,
        item.description,
        item.url,
        ...(item.tags || [])
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchTerm);
    }).slice(0, this.maxResults);
  },

  parseDuckDuckGoResponse(data, query) {
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
          url: topic.FirstURL,
          ...this.extractResult(topic.Text, query)
        });
      }

      if (Array.isArray(topic.Topics)) {
        for (const subTopic of topic.Topics) {
          if (subTopic.FirstURL && subTopic.Text) {
            items.push({
              url: subTopic.FirstURL,
              ...this.extractResult(subTopic.Text, query)
            });
          }
        }
      }
    }

    return items.slice(0, this.maxResults);
  },

  async search(query) {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`DuckDuckGo error: ${response.status}`);
      }

      const data = await response.json();
      const items = this.parseDuckDuckGoResponse(data, query);
      
      return items.length > 0 ? items : this.searchFallback(query);
    } catch (error) {
      return this.searchFallback(query);
    }
  },

  searchFallback(query) {
    const fallback = loadResults();
    return this.filterByQuery(fallback, query);
  }
};

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

function serveStaticFile(req, res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Type': 'text/plain; charset=utf-8'
      });
      res.end('File not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || 'application/octet-stream';

    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Type': contentType
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && requestUrl.pathname === '/api/status') {
    sendJson(req, res, 200, { connected: true, message: 'Hello from StrawSearch server' });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/search') {
    (async () => {
      const query = (requestUrl.searchParams.get('q') || '').trim();
      
      if (!query) {
        const results = loadResults().slice(0, 6);
        sendJson(req, res, 200, { query: '', results });
        return;
      }

      const results = await searchService.search(query);
      sendJson(req, res, 200, { query, results });
    })().catch(() => {
      const query = (requestUrl.searchParams.get('q') || '').trim();
      const results = query ? searchService.searchFallback(query) : loadResults().slice(0, 6);
      sendJson(req, res, 200, { query, results });
    });
    return;
  }

  const safePath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Type': 'text/plain; charset=utf-8'
    });
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
