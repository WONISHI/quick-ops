const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8849);

const sendJson = (res, statusCode, data) => {
  // 故意不设置 Access-Control-Allow-Origin
  // 这样浏览器前端直接请求这个服务时会跨域报错
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });

  res.end(JSON.stringify(data, null, 2));
};

const readBody = (req) => {
  return new Promise((resolve) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');

      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(raw);
      }
    });
  });
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    // 故意不返回 CORS headers
    res.writeHead(204, {
      'content-type': 'text/plain',
    });
    res.end();
    return;
  }

  if (requestUrl.pathname === '/ISAPI/Security/sessionLogin') {
    const body = await readBody(req);

    sendJson(res, 200, {
      code: 200,
      message: 'Node 服务命中成功：sessionLogin',
      method: req.method,
      path: requestUrl.pathname,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
      body,
      time: new Date().toISOString(),
    });
    return;
  }

  if (requestUrl.pathname.startsWith('/ISAPI/')) {
    const body = await readBody(req);

    sendJson(res, 200, {
      code: 200,
      message: 'Node 服务命中成功：ISAPI 通用接口',
      method: req.method,
      path: requestUrl.pathname,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
      body,
      time: new Date().toISOString(),
    });
    return;
  }

  sendJson(res, 404, {
    code: 404,
    message: '接口不存在',
    path: requestUrl.pathname,
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`No-CORS Node server running: http://127.0.0.1:${PORT}`);
  console.log(`Test API: http://127.0.0.1:${PORT}/ISAPI/Security/sessionLogin`);
});
