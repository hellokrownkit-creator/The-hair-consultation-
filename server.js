
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data", "store.enc");

const SALON_NAME = process.env.SALON_NAME || "Your Salon";
const SALON_PASSWORD = process.env.SALON_PASSWORD || "change-this-password";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";
const DATA_KEY = crypto.createHash("sha256").update(process.env.DATA_KEY || "change-this-data-key").digest();
const COOKIE = "thc_session";

if (SALON_PASSWORD === "change-this-password" || SESSION_SECRET.startsWith("change-this") || process.env.DATA_KEY === undefined) {
  console.warn("WARNING: Set SALON_PASSWORD, SESSION_SECRET and DATA_KEY before production use.");
}
if (!fs.existsSync(DATA)) {
  fs.writeFileSync(DATA, encrypt({links:[], submissions:[]}));
}

function encrypt(obj){
  const iv=crypto.randomBytes(12);
  const c=crypto.createCipheriv("aes-256-gcm", DATA_KEY, iv);
  const body=Buffer.concat([c.update(JSON.stringify(obj),"utf8"),c.final()]);
  return JSON.stringify({v:1,iv:iv.toString("base64"),tag:c.getAuthTag().toString("base64"),data:body.toString("base64")});
}
function decrypt(s){
  const x=JSON.parse(s);
  const d=crypto.createDecipheriv("aes-256-gcm",DATA_KEY,Buffer.from(x.iv,"base64"));
  d.setAuthTag(Buffer.from(x.tag,"base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(x.data,"base64")),d.final()]).toString("utf8"));
}
function readStore(){try{return decrypt(fs.readFileSync(DATA,"utf8"))}catch(e){console.error("Data store error:",e.message);return {links:[],submissions:[]}}}
function writeStore(x){fs.writeFileSync(DATA,encrypt(x),{mode:0o600})}
function id(){return crypto.randomBytes(18).toString("base64url")}
function hmac(v){return crypto.createHmac("sha256",SESSION_SECRET).update(v).digest("base64url")}
function sessionToken(){
  const exp=Date.now()+8*60*60*1000, raw=`${id()}.${exp}`, sig=hmac(raw);
  return Buffer.from(`${raw}.${sig}`).toString("base64url");
}
function validSession(t){
  try{
    const raw=Buffer.from(t,"base64url").toString();
    const parts=raw.split("."); if(parts.length!==3)return false;
    const [nonce,exp,sig]=parts; if(Number(exp)<Date.now())return false;
    return crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(hmac(`${nonce}.${exp}`)));
  }catch{return false}
}
function cookies(req){const out={};(req.headers.cookie||"").split(";").forEach(x=>{const i=x.indexOf("=");if(i>0)out[x.slice(0,i).trim()]=decodeURIComponent(x.slice(i+1).trim())});return out}
function json(res,status,obj){const b=JSON.stringify(obj);res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin"});res.end(b)}
function parseBody(req){
  return new Promise((resolve,reject)=>{
    let d="";req.on("data",c=>{d+=c;if(d.length>2_000_000)req.destroy()});
    req.on("end",()=>{try{resolve(JSON.parse(d||"{}"))}catch(e){reject(e)}});req.on("error",reject)
  })
}
function authed(req){return validSession(cookies(req)[COOKIE]||"")}
function requireAuth(req,res){if(!authed(req)){json(res,401,{error:"Not signed in"});return false}return true}
function serve(res,file){
  const ext=path.extname(file),types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".webmanifest":"application/manifest+json"};
  res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"no-cache","X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin"});
  fs.createReadStream(file).pipe(res);
}
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==="GET" && u.pathname==="/api/config") return json(res,200,{salonName:SALON_NAME});
  if(req.method==="POST" && u.pathname==="/api/login"){
    const x=await parseBody(req);
    if(x.password!==SALON_PASSWORD)return json(res,403,{error:"Incorrect password"});
    res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":`${COOKIE}=${encodeURIComponent(sessionToken())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,"Cache-Control":"no-store"});
    return res.end(JSON.stringify({ok:true}));
  }
  if(req.method==="POST" && u.pathname==="/api/logout"){
    res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`});return res.end('{"ok":true}');
  }
  if(req.method==="GET" && u.pathname==="/api/me") return json(res,200,{signedIn:authed(req),salonName:SALON_NAME});
  if(req.method==="POST" && u.pathname==="/api/salon/links"){
    if(!requireAuth(req,res))return;
    const x=await parseBody(req); if(!x.service)return json(res,400,{error:"Service required"});
    const s=readStore(), token=id();
    s.links.unshift({token,service:x.service,clientName:x.clientName||"",createdAt:new Date().toISOString(),active:true});
    writeStore(s); return json(res,201,{token,service:x.service,clientName:x.clientName||""});
  }
  if(req.method==="GET" && u.pathname==="/api/salon/links"){
    if(!requireAuth(req,res))return;
    return json(res,200,{links:readStore().links});
  }
  if(req.method==="GET" && u.pathname==="/api/salon/submissions"){
    if(!requireAuth(req,res))return;
    return json(res,200,{submissions:readStore().submissions});
  }
  if(req.method==="POST" && u.pathname==="/api/salon/delete"){
    if(!requireAuth(req,res))return;
    const x=await parseBody(req),s=readStore();s.submissions=s.submissions.filter(a=>a.id!==x.id);writeStore(s);return json(res,200,{ok:true});
  }
  if(req.method==="GET" && u.pathname==="/api/client/link"){
    const t=u.searchParams.get("token"),s=readStore(),l=s.links.find(a=>a.token===t&&a.active);
    if(!l)return json(res,404,{error:"This consultation link is invalid or inactive."});
    return json(res,200,{service:l.service,clientName:l.clientName,salonName:SALON_NAME});
  }
  if(req.method==="POST" && u.pathname==="/api/client/submit"){
    const x=await parseBody(req),s=readStore(),l=s.links.find(a=>a.token===x.token&&a.active);
    if(!l)return json(res,404,{error:"This consultation link is invalid or inactive."});
    if(!x.client?.fullName)return json(res,400,{error:"Name is required"});
    s.submissions.unshift({id:id(),token:x.token,service:l.service,submittedAt:new Date().toISOString(),status:"new",client:x.client,answers:x.answers||{}});
    l.active=false; writeStore(s); return json(res,201,{ok:true});
  }
  let p=u.pathname==="/" ? "/index.html" : u.pathname;
  const f=path.normalize(path.join(PUBLIC,p));
  if(!f.startsWith(PUBLIC))return json(res,404,{error:"Not found"});
  if(fs.existsSync(f)&&fs.statSync(f).isFile())return serve(res,f);
  return json(res,404,{error:"Not found"});
 }catch(e){console.error(e);json(res,500,{error:"Server error"})}
});
server.listen(PORT,()=>console.log(`THE HAIR CONSULTATION™ listening on port ${PORT}`));
