\
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error('Set ADMIN_PASSWORD to a strong password of at least 12 characters.');
  process.exit(1);
}
let proc = null;
let liveSince = null;
let lastLog = 'Idle';
let stopping = false;
const publicDir = path.join(__dirname, 'public');
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json'};

function send(res, status, data, type='application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function parseBody(req) {
  return new Promise((resolve,reject)=>{
    let raw='', size=0;
    req.on('data', chunk=>{ size+=chunk.length; if(size>20000){reject(new Error('Request too large'));req.destroy();} else raw+=chunk;});
    req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch(e){reject(new Error('Invalid JSON'));}});
    req.on('error',reject);
  });
}
function authed(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  const a = Buffer.from(token), b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
function validUrl(s, protocols) {
  try { const u = new URL(s); return protocols.includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
function safeStatus() { return {live:!!proc, liveSince, message:lastLog}; }

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health' && req.method === 'GET') return send(res,200,{ok:true,service:'WonderVerse Live Studio'});
  if (url.pathname.startsWith('/api/')) {
    if (!authed(req)) return send(res,401,{error:'Unauthorized. Enter your dashboard password.'});
    if (url.pathname === '/api/status' && req.method === 'GET') return send(res,200,safeStatus());
    if (url.pathname === '/api/start' && req.method === 'POST') {
      if (proc) return send(res,409,{error:'A stream process is already running.'});
      let body;
      try { body = await parseBody(req); } catch(e) { return send(res,400,{error:e.message}); }
      const source = String(body.source || '').trim();
      const ytUrl = String(body.ytUrl || '').trim();
      const ytKey = String(body.ytKey || '').trim();
      const fbUrl = String(body.fbUrl || '').trim();
      const fbKey = String(body.fbKey || '').trim();
      if (!validUrl(source,['http:','https:'])) return send(res,400,{error:'Source must be a direct HTTP(S) media URL (MP4 or HLS/M3U8). Platform watch pages may not work.'});
      const destinations = [];
      if (ytUrl || ytKey) {
        if (!validUrl(ytUrl,['rtmp:','rtmps:']) || !ytKey) return send(res,400,{error:'Provide both a valid YouTube RTMP(S) URL and stream key.'});
        destinations.push({name:'YouTube',url:ytUrl.replace(/\/+$/,'')+'/'+ytKey});
      }
      if (fbUrl || fbKey) {
        if (!validUrl(fbUrl,['rtmp:','rtmps:']) || !fbKey) return send(res,400,{error:'Provide both a valid Facebook RTMP(S) URL and stream key.'});
        destinations.push({name:'Facebook',url:fbUrl.replace(/\/+$/,'')+'/'+fbKey});
      }
      if (!destinations.length) return send(res,400,{error:'Configure at least one destination.'});
      // FFmpeg tee muxer relays one input to multiple RTMP(S) destinations.
      const tee = destinations.map(d=>`[f=flv:onfail=ignore]${d.url}`).join('|');
      const args = ['-hide_banner','-loglevel','warning','-re','-i',source,'-map','0:v:0?','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-tune','zerolatency','-pix_fmt','yuv420p','-r','30','-g','60','-c:a','aac','-b:a','128k','-ar','44100','-f','tee',tee];
      stopping = false;
      try {
        proc = spawn('ffmpeg', args, {stdio:['ignore','ignore','pipe']});
      } catch(e) { proc=null; return send(res,500,{error:'Could not start FFmpeg. Check server installation.'}); }
      liveSince = new Date().toISOString();
      lastLog = 'Starting stream process';
      proc.stderr.on('data',d=>{ lastLog = d.toString().slice(-700).trim() || lastLog; });
      proc.on('error',e=>{ lastLog='FFmpeg error: '+e.message; proc=null; liveSince=null; });
      proc.on('close',(code)=>{
        proc=null; liveSince=null;
        if (!stopping) lastLog = `FFmpeg exited (${code}). Check the source URL, server logs, and stream destination settings.`;
        stopping=false;
      });
      return send(res,200,{ok:true,message:'FFmpeg process started. Check platform dashboards to confirm the stream is live.'});
    }
    if (url.pathname === '/api/stop' && req.method === 'POST') {
      if (!proc) return send(res,200,{ok:true,message:'No stream process is running.'});
      stopping=true; const p=proc; p.kill('SIGTERM');
      setTimeout(()=>{ if(proc===p) p.kill('SIGKILL'); },5000).unref();
      return send(res,200,{ok:true,message:'Stop signal sent.'});
    }
    return send(res,404,{error:'Not found'});
  }
  const requested = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
  const file = path.join(publicDir,requested);
  fs.readFile(file,(err,data)=>{
    if(err) return send(res,404,'Not found','text/plain; charset=utf-8');
    send(res,200,data,mime[path.extname(file)]||'application/octet-stream');
  });
});
server.listen(PORT,'0.0.0.0',()=>console.log(`WonderVerse Live Studio listening on ${PORT}`));
process.on('SIGTERM',()=>{ if(proc){stopping=true;proc.kill('SIGTERM');} server.close(()=>process.exit(0)); });
