const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.NT_TEST_PORT || 8765);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
/** 仅向本机提供测试页面；模拟 Chrome 接口只在显式 fixture 参数下插入。 */
function serve(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  if (/^\/watch\/\d+$/.test(pathname) || pathname === '/') pathname = '/tests/browser.html';
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end('Not found'); return; }
  let body = fs.readFileSync(file);
  if (url.searchParams.has('fixture') && ['popup.html', 'vocabulary.html'].includes(path.basename(file))) body = Buffer.from(body.toString().replace('<script src="lib/core.js">', '<script src="tests/browser-mocks.js"></script><script src="lib/core.js">'));
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(body);
}
const server = http.createServer(serve);
server.listen(port, '127.0.0.1', () => console.log('浏览器模拟验收：http://127.0.0.1:' + port + '/watch/999\n真实本地引擎：http://127.0.0.1:' + port + '/tests/local-engine.html'));
