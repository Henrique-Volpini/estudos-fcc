import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, SimuladoStore } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BODY_LIMIT = 64 * 1024;

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  if (request.headers['x-estudos-fcc'] !== '1') throw new AppError(403, 'Requisição não autorizada pelo aplicativo local.');
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new AppError(415, 'Envie o conteúdo como application/json.');
  if (request.headers.origin) {
    let origin;
    try { origin = new URL(request.headers.origin); } catch { throw new AppError(403, 'Origem não permitida.'); }
    if (origin.protocol !== 'http:' || origin.host !== request.headers.host || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new AppError(403, 'Origem não permitida.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new AppError(413, 'A requisição ultrapassa o tamanho permitido.');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new AppError(400, 'Corpo JSON inválido.'); }
}

export function createAppServer({ dataRoot = process.env.ESTUDOS_FCC_DATA_ROOT || path.join(ROOT, 'Backend/simulados'), frontendRoot = path.join(ROOT, 'Frontend'), store = null } = {}) {
  const storage = store ?? new SimuladoStore(dataRoot);
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ]);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/api/health') {
        await storage.ready;
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/simulados') return sendJson(response, 200, await storage.list());
      const match = url.pathname.match(/^\/api\/simulados\/([^/]+)(?:\/(iniciar|respostas|classificacao|navegacao|finalizar|reiniciar))?$/);
      if (match) {
        let id;
        try { id = decodeURIComponent(match[1]); } catch { throw new AppError(400, 'ID do simulado inválido.'); }
        const action = match[2];
        if (request.method === 'GET' && !action) return sendJson(response, 200, await storage.get(id));
        const allowed = { iniciar: 'POST', respostas: 'POST', classificacao: 'PATCH', navegacao: 'PATCH', finalizar: 'POST', reiniciar: 'POST' };
        if (!action || request.method !== allowed[action]) throw new AppError(405, 'Método não permitido.');
        const body = await readBody(request);
        const methods = { iniciar: 'start', respostas: 'answer', classificacao: 'classify', navegacao: 'navigate', finalizar: 'finish', reiniciar: 'reset' };
        return sendJson(response, 200, await storage[methods[action]](id, body));
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && assets.has(url.pathname)) {
        const [filename, type] = assets.get(url.pathname);
        const target = path.resolve(frontendRoot, filename);
        let content;
        try { content = await fs.readFile(target); } catch (error) {
          if (error.code === 'ENOENT') throw new AppError(404, 'Arquivo da interface não encontrado.');
          throw error;
        }
        response.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        response.end(request.method === 'HEAD' ? undefined : content);
        return;
      }
      throw new AppError(404, 'Página ou recurso não encontrado.');
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      if (!(error instanceof AppError)) console.error('Falha no aplicativo local:', error);
      if (!response.headersSent) sendJson(response, status, { erro: error instanceof AppError ? error.message : 'Não foi possível concluir a operação. Seus arquivos foram preservados; tente novamente.' });
      else response.end();
    }
  });
  server.store = storage;
  return server;
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (scriptPath && scriptPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const port = Number(process.env.ESTUDOS_FCC_PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('ESTUDOS_FCC_PORT deve ser uma porta entre 1 e 65535.');
    process.exitCode = 1;
  } else {
    const server = createAppServer();
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `A porta ${port} já está em uso. Defina outra em ESTUDOS_FCC_PORT.` : 'Não foi possível iniciar o servidor local.');
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`Estudos FCC disponível em http://127.0.0.1:${port}`));
  }
}
