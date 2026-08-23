const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const SALON_NAME = process.env.SALON_NAME || 'Your Salon';
const SALON_PASSWORD = process.env.SALON_PASSWORD || 'salon123';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadStore(){ try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch { return {links:{}, submissions:[]}; } }
let store = loadStore();
function saveStore(){ fs.writeFileSync(DATA_FILE, JSON.stringify(store,null,2)); }
const sessions = new Set();
function json(res,status,body,headers={}){ const out=JSON.stringify(body); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(out); }
function cookies(req){ const raw=req.headers.cookie||''; return Object.fromEntries(raw.split(';').filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),decodeURIComponent(x.slice(i+1).trim())]})); }
function readBody(req){ return new Promise((resolve,reject)=>{let d='';req.on('data',c=>{d+=c;if(d.length>2000000){req.destroy();reject(new Error('Body too large'))}});req.on('end',()=>{try{resolve(d?JSON.parse(d):{})}catch{reject(new Error('Invalid JSON'))}});req.on('error',reject)}) }
function signedIn(req){ const sid=cookies(req).sid; return !!sid && sessions.has(sid); }
function requireSalon(req,res){ if(!signedIn(req)){json(res,401,{error:'Salon sign-in required.'});return false} return true; }
function token(){return crypto.randomBytes(24).toString('hex')}
function staticFile(req,res,pathname){
  let file=pathname==='/'?'index.html':pathname.replace(/^\/+/,''), full=path.normalize(path.join(PUBLIC_DIR,file));
  if(!full.startsWith(PUBLIC_DIR)){res.writeHead(403);return res.end('Forbidden')}
  fs.readFile(full,(err,data)=>{
    if(err){ if(pathname!=='/'){return fs.readFile(path.join(PUBLIC_DIR,'index.html'),(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(d)})} res.writeHead(404);return res.end('Not found') }
    const ext=path.extname(full).toLowerCase(); const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'});res.end(data);
  });
}
async function handle(req,res){
  const parsed=url.parse(req.url,true), p=parsed.pathname;
  if(req.method==='GET'&&p==='/api/health') return json(res,200,{ok:true,service:'THE HAIR CONSULTATION'});
  if(req.method==='GET'&&p==='/api/me') return json(res,200,{signedIn:signedIn(req),salonName:SALON_NAME});
  if(req.method==='POST'&&p==='/api/login'){try{const b=await readBody(req);if(b.password!==SALON_PASSWORD)return json(res,401,{error:'Incorrect salon password.'});const sid=token();sessions.add(sid);return json(res,200,{ok:true,salonName:SALON_NAME},{'Set-Cookie':`sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`})}catch{return json(res,400,{error:'Invalid request.'})}}
  if(req.method==='POST'&&p==='/api/logout'){const sid=cookies(req).sid;if(sid)sessions.delete(sid);return json(res,200,{ok:true},{'Set-Cookie':'sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'})}
  if(req.method==='POST'&&p==='/api/salon/links'){if(!requireSalon(req,res))return;try{const b=await readBody(req);const allowed=['Haircut / Styling','Colour / Lightening','Treatment / Repair','Texture / Smoothing'];const service=allowed.includes(b.service)?b.service:'Haircut / Styling';const t=token();store.links[t]={token:t,service,clientName:String(b.clientName||'').slice(0,120),createdAt:new Date().toISOString(),submitted:false};saveStore();return json(res,200,{token:t,service})}catch{return json(res,400,{error:'Could not create client link.'})}}
if(req.method==='GET'&&p==='/api/salon/links'){if(!requireSalon(req,res))return;return json(res,200,{links:Object.values(store.links)})}
  if(req.method==='GET'&&p==='/api/salon/submissions'){if(!requireSalon(req,res))return;return json(res,200,{submissions:store.submissions})}
  if(req.method==='GET'&&p==='/api/client/link'){const t=String(parsed.query.token||'');const l=store.links[t];if(!l||l.submitted)return json(res,404,{error:'This consultation link is invalid or has already been submitted.'});return json(res,200,{salonName:SALON_NAME,service:l.service,clientName:l.clientName})}
  if(req.method==='POST'&&p==='/api/client/submit'){try{const b=await readBody(req),t=String(b.token||''),l=store.links[t];if(!l||l.submitted)return json(res,404,{error:'This consultation link is invalid or has already been submitted.'});const c=b.client||{},a=b.answers||{};if(!String(c.fullName||'').trim()||!String(a.service||l.service).trim())return json(res,400,{error:'Please provide your name and booked service.'});const sub={id:token(),submittedAt:new Date().toISOString(),client:{fullName:String(c.fullName||'').slice(0,200),preferredName:String(c.preferredName||'').slice(0,120),mobile:String(c.mobile||'').slice(0,80),email:String(c.email||'').slice(0,200)},service:l.service,answers:a};store.submissions.unshift(sub);l.submitted=true;l.submittedAt=sub.submittedAt;saveStore();return json(res,200,{ok:true,id:sub.id})}catch{return json(res,400,{error:'Unable to submit consultation.'})}}
  staticFile(req,res,p);
}
http.createServer((req,res)=>handle(req,res).catch(e=>{console.error(e);json(res,500,{error:'Server error.'})})).listen(PORT,HOST,()=>console.log(`THE HAIR CONSULTATION running on ${HOST}:${PORT}`));
