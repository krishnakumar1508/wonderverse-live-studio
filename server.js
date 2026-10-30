const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!PASSWORD || PASSWORD.length < 12) {
  console.error('Set ADMIN_PASSWORD (minimum 12 characters).');
  process.exit(1);
}

const publicDir = path.join(__dirname, 'public');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json'
};

let config = null;
let ffmpeg = null;
let liveSince = null;
let lastLog = 'Idle';
let stopping = false;

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function authorized(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(token);
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validRTMP(value) {
  try {
    const u = new URL(value);
    return ['rtmp:', 'rtmps:'].includes(u.protocol);
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 20000) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function makeDestinations(c) {
  const destinations = [];

  if (c.ytUrl || c.ytKey) {
    if (!validRTMP(c.ytUrl) || !c.ytKey) {
      throw new Error('YouTube RTMP URL and stream key are required.');
    }
    destinations.push(c.ytUrl.replace(/\/+$/, '') + '/' + c.ytKey);
  }

  if (c.fbUrl || c.fbKey) {
    if (!validRTMP(c.fbUrl) || !c.fbKey) {
      throw new Error('Facebook RTMP URL and stream key are required.');
    }
    destinations.push(c.fbUrl.replace(/\/+$/, '') + '/' + c.fbKey);
  }

  if (!destinations.length) {
    throw new Error('Add at least one streaming destination.');
  }

  return destinations;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/health') {
    return send(res, 200, { ok: true, service: 'WonderVerse Live Studio' });
  }

  if (url.pathname.startsWith('/api/')) {
    if (!authorized(req)) {
      return send(res, 401, { error: 'Wrong dashboard password.' });
    }

    if (url.pathname === '/api/screen-config' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        makeDestinations(body);
        config = body;
        return send(res, 200, { ok: true, message: 'Streaming settings saved.' });
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }

    if (url.pathname === '/api/status' && req.method === 'GET') {
      return send(res, 200, {
        live: !!ffmpeg,
        liveSince,
        message: lastLog
      });
    }

    if (url.pathname === '/api/stop' && req.method === 'POST') {
      if (ffmpeg) {
        stopping = true;
        ffmpeg.kill('SIGTERM');
      }
      return send(res, 200, { ok: true, message: 'Stop signal sent.' });
    }

    return send(res, 404, { error: 'Not found' });
  }

  const requested = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
  const file = path.join(publicDir, requested);

  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'File not found' });
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream'
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname !== '/api/screen') {
    socket.destroy();
    return;
  }

  const token = url.searchParams.get('token') || '';
  const a = Buffer.from(token);
  const b = Buffer.from(PASSWORD);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', ws => {
  if (!config) {
    ws.close(1008, 'Save streaming settings first.');
    return;
  }

  if (ffmpeg) {
    ws.close(1013, 'A stream is already running.');
    return;
  }

  let destinations;

  try {
    destinations = makeDestinations(config);
  } catch (e) {
    ws.close(1008, e.message);
    return;
  }

  const tee = destinations
    .map(d => `[f=flv:onfail=ignore]${d}`)
    .join('|');

  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-f', 'webm',
    '-i', 'pipe:0',
    '-map', '0:v:0?',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'tee',
    tee
  ];

  stopping = false;
  lastLog = 'Starting screen stream...';

  try {
    ffmpeg = spawn('ffmpeg', args, {
      stdio: ['pipe', 'ignore', 'pipe']
    });
  } catch (e) {
    ffmpeg = null;
    lastLog = e.message;
    ws.close(1011, 'Could not start FFmpeg.');
    return;
  }

  const current = ffmpeg;
  liveSince = new Date().toISOString();

  current.stderr.on('data', data => {
    lastLog = data.toString().slice(-700).trim();
  });

  current.on('error', err => {
    lastLog = 'FFmpeg error: ' + err.message;
    if (ffmpeg === current) {
      ffmpeg = null;
      liveSince = null;
    }
  });

  current.on('close', code => {
    if (ffmpeg === current) {
      ffmpeg = null;
      liveSince = null;
    }
    if (!stopping) lastLog = `FFmpeg stopped (${code}).`;
    stopping = false;
  });

  ws.on('message', data => {
    if (ffmpeg === current && current.stdin.writable) {
      current.stdin.write(data);
    }
  });

  ws.on('close', () => {
    if (ffmpeg === current) {
      stopping = true;
      current.stdin.end();
      setTimeout(() => {
        if (ffmpeg === current) current.kill('SIGTERM');
      }, 5000).unref();
    }
  });

  ws.on('error', () => {
    if (ffmpeg === current) current.kill('SIGTERM');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WonderVerse Live Studio running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  if (ffmpeg) ffmpeg.kill('SIGTERM');
  server.close(() => process.exit(0));
});
