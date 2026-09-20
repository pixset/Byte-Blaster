/**
 * Приёмник картинок из браузера.
 *
 * Нужен для съёмки скриншотов магазина и рендера иконки: страница рисует кадр
 * в canvas и отправляет его сюда, а сервер кладёт файл на диск. Так картинки
 * не идут через консоль и не упираются в её ограничения.
 *
 * Запуск:  node _tools/shot-server.js
 * Приём:   POST /save?name=01.png   тело — dataURL или голый base64
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'store');
const PORT = process.env.PORT || 8899;

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(200); res.end('shot-server ok'); return; }

  const url = new URL(req.url, 'http://x');
  // Имя чистим: сюда стучится страница, и путь наружу папки открывать незачем.
  const name = path.basename(url.searchParams.get('name') || ('shot-' + Date.now() + '.png'));
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    try {
      const b64 = body.indexOf(',') >= 0 && body.slice(0, 5) === 'data:' ? body.slice(body.indexOf(',') + 1) : body;
      const buf = Buffer.from(b64, 'base64');
      fs.writeFileSync(path.join(OUT, name), buf);
      console.log('сохранено:', name, (buf.length / 1024).toFixed(0) + ' КБ');
      res.writeHead(200); res.end('ok ' + buf.length);
    } catch (e) {
      console.error('ошибка:', name, e.message);
      res.writeHead(500); res.end('err');
    }
  });
}).listen(PORT, () => console.log('приёмник картинок на порту ' + PORT + ', папка: ' + OUT));
