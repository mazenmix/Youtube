// MXTube Pages gateway. Self-hosted secure yt-dlp extraction and same-origin media stream when configured; legacy public provider fallback otherwise.
const INV = [
  'https://inv.nadeko.net',
  'https://invidious.tiekoetter.com',
  'https://invidious.nerdvpn.de',
  'https://yt.chocolatemoo53.com'
];
const PIPED = [
  'https://pipedapi.ducks.party',
  'https://api.piped.private.coffee',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks'
];
const clean = (v, n=180) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n);
const idOk = id => /^[a-zA-Z0-9_-]{11}$/.test(id);
const safeMedia = link => {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) return null;
    return url.toString();
  } catch { return null; }
};
function json(obj, status=200, ttl=60) {
  return new Response(JSON.stringify(obj), {status, headers: {
    'content-type':'application/json; charset=utf-8',
    'cache-control': status === 200 ? 'public, max-age='+ttl : 'no-store',
    'x-content-type-options':'nosniff',
    'access-control-allow-origin':'*'
  }});
}
async function readJson(url, ms=4800) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(url, {signal:ctrl.signal, headers:{accept:'application/json'}});
    if (!resp.ok) throw new Error('provider HTTP '+resp.status);
    const len = Number(resp.headers.get('content-length') || 0);
    if (len > 1500000) throw new Error('large provider payload');
    return await resp.json();
  } finally { clearTimeout(t); }
}
async function firstUsable(jobs) {
  return await Promise.any(jobs.map(async job => {
    const data = await job();
    if (!data) throw new Error('empty provider');
    return data;
  }));
}
function item(raw, piped=false) {
  const id = piped ? ((raw.url || '').match(/[?&]v=([a-zA-Z0-9_-]{11})/) || [])[1] : raw.videoId;
  if (!idOk(id)) return null;
  return {
    id, title:clean(raw.title, 180),
    author: clean(piped ? raw.uploaderName : raw.author, 90),
    duration: Number(raw.lengthSeconds || raw.duration || 0) || 0,
    views: Number(raw.viewCount || raw.views || 0) || 0,
    live: Boolean(raw.liveNow || raw.isLive),
    thumbnail: 'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'
  };
}
function itemsFrom(rows, piped=false) {
  return (Array.isArray(rows) ? rows : []).map(x=>item(x,piped)).filter(Boolean).slice(0,30);
}
async function search(q) {
  const query = encodeURIComponent(q);
  const jobs = [
    ...INV.map(host=> async ()=>{
      const data = await readJson(host+'/api/v1/search?q='+query+'&type=video&sort=relevance');
      const items=itemsFrom(data);
      return items.length ? items : null;
    }),
    ...PIPED.map(host=> async ()=>{
      const data=await readJson(host+'/search?q='+query+'&filter=videos');
      const items=itemsFrom(data.items,true);
      return items.length ? items : null;
    })
  ];
  return await firstUsable(jobs);
}
async function trending() {
  const jobs=[
    ...INV.map(host=>async()=>{
      const data = await readJson(host+'/api/v1/trending?region=US');
      const items=itemsFrom(data);
      return items.length ? items : null;
    }),
    ...PIPED.map(host=>async()=>{
      const data=await readJson(host+'/trending?region=US');
      const items=itemsFrom(data,true);
      return items.length ? items : null;
    })
  ];
  return await firstUsable(jobs);
}
const qNum = q => {
  const found=String(q||'').match(/(\d{2,4})/);
  return found ? Number(found[1]) : 360;
};
function sortSources(sources) {
  return sources
    .filter(x=>x.url && (x.type.startsWith('video/') || x.type.includes('mpegurl')))
    .sort((a,b)=>(b.type.includes('mp4')?3:0)-(a.type.includes('mp4')?3:0) || a.quality-b.quality)
    .slice(0,12);
}
async function fromInvidious(host, id) {
  const v=await readJson(host+'/api/v1/videos/'+id+'?local=true',6500);
  if (v?.error) throw new Error('provider error');
  const streams=Array.isArray(v.formatStreams) ? v.formatStreams : [];
  const sources=sortSources(streams.map(s=>({
    url:safeMedia(s.url),
    type:clean(s.type || 'video/mp4',120),
    quality:qNum(s.qualityLabel || s.quality),
    label:clean(s.qualityLabel || s.quality || '360p',20),
    origin:'Invidious'
  })));
  if (v.hlsUrl) {
    sources.push({url:safeMedia(v.hlsUrl),type:'application/vnd.apple.mpegurl',quality:720,label:'Live HLS',origin:'Invidious'});
  }
  const usable=sources.filter(x=>x.url);
  if (!usable.length) return null;
  return {
    id, title:clean(v.title,240), author:clean(v.author,100),
    duration:Number(v.lengthSeconds||0),
    thumbnail:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg',
    sources:usable,
    source:'Invidious',
    embed:host+'/embed/'+id+'?local=true'
  };
}
async function fromPiped(host,id) {
  const v=await readJson(host+'/streams/'+id,6500);
  if (v?.error) return null;
  const streams=Array.isArray(v.videoStreams)?v.videoStreams:[];
  const sources=sortSources(streams
    .filter(s=>s.videoOnly === false)
    .map(s=>({
      url:safeMedia(s.url),
      type:clean(s.mimeType || s.format || 'video/mp4',100),
      quality:qNum(s.quality),
      label:clean(s.quality||'Video',25),
      origin:'Piped'
    })));
  if (v.hls) sources.push({url:safeMedia(v.hls),type:'application/vnd.apple.mpegurl',quality:720,label:'HLS',origin:'Piped'});
  const usable=sources.filter(x=>x.url);
  if (!usable.length) return null;
  return {
    id, title:clean(v.title,240),author:clean(v.uploader,100),duration:Number(v.duration||0),
    thumbnail:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg',
    sources:usable,source:'Piped',
    embed:'https://inv.nadeko.net/embed/'+id+'?local=true'
  };
}
async function video(id) {
  const jobs=[
    ...INV.map(host=>()=>fromInvidious(host,id)),
    ...PIPED.map(host=>()=>fromPiped(host,id))
  ];
  return await firstUsable(jobs);
}

// Self-hosted yt-dlp backend is opt-in: no secret or backend URL is bundled
// into client JavaScript. Pages keeps the secret in context.env.
function ownBackend(context) {
  const value=context.env?.MX_STREAM_BACKEND_URL;
  const secret=context.env?.MX_STREAM_SECRET;
  if (!value || !secret || secret.length<24) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        parsed.port || parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local'))
      return null;
    return {base:parsed.origin,secret};
  } catch {return null;}
}
async function ownVideo(context,id) {
  const backend=ownBackend(context);
  if (!backend) return null;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),29000);
  try {
    const res=await fetch(backend.base+'/api/video?id='+encodeURIComponent(id),{
      headers:{'x-mxtube-key':backend.secret,accept:'application/json'},
      signal:ctrl.signal
    });
    if(!res.ok) return json({error:'The standalone MXTube stream server could not extract this video.'},503);
    const data=await res.json();
    if(data.id!==id || !Array.isArray(data.sources)) return json({error:'Invalid backend response.'},502);
    const safe=data.sources.filter(x=>{
      const parts=String(x.url||'').match(/^\/api\/stream\/([A-Za-z0-9_-]{11})\/([A-Za-z0-9_.-]{1,72})$/);
      return parts && parts[1]===id && ['video/mp4','video/webm'].includes(x.type);
    }).slice(0,8).map(x=>({
      url:x.url,type:x.type,quality:Number(x.quality)||0,label:clean(x.label,24),origin:'MXTube'
    }));
    if(!safe.length) return json({error:'No playable streams available.'},503);
    return json({
      id,title:clean(data.title,240),author:clean(data.author,100),
      duration:Number(data.duration)||0,
      thumbnail:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg',
      sources:safe,source:'MXTube'
    },200,25);
  } catch {
    return json({error:'Standalone stream server unavailable.'},503);
  } finally {clearTimeout(timer);}
}
async function ownStream(context, route) {
  const backend=ownBackend(context);
  if(!backend) return json({error:'MXTube streaming backend not configured.'},503);
  if(!/^\/api\/stream\/[A-Za-z0-9_-]{11}\/[A-Za-z0-9_.-]{1,72}$/.test(route))
    return json({error:'Invalid stream URL'},400);
  const headers={'x-mxtube-key':backend.secret};
  const range=context.request.headers.get('range');
  if(range) {
    if(!/^bytes=\d{0,16}-\d{0,16}$/.test(range)) return json({error:'Invalid byte range'},416);
    headers.range=range;
  }
  try {
    const upstream=await fetch(backend.base+route,{
      method:context.request.method==='HEAD'?'HEAD':'GET', headers,
      redirect:'manual'
    });
    if(upstream.status!==200 && upstream.status!==206)
      return json({error:'MXTube video stream not available.'},502);
    const safeHeaders=new Headers({
      'cache-control':'private, no-store',
      'x-content-type-options':'nosniff',
    });
    for (const key of ['content-type','content-length','content-range','accept-ranges']) {
      const value=upstream.headers.get(key);
      if(value)safeHeaders.set(key,value);
    }
    return new Response(context.request.method==='HEAD'?null:upstream.body,{
      status:upstream.status,headers:safeHeaders
    });
  } catch {return json({error:'MXTube stream connection failed.'},503);}
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const route = url.pathname.replace(/\/+$/,'');
  try {
    if (route === '/api/search') {
      const q=clean(url.searchParams.get('q'),101);
      if (q.length<2 || q.length>100) return json({error:'Please provide 2–100 search characters.'},400);
      const items=await search(q);
      return json({items},200,180);
    }
    if (route === '/api/trending') {
      const items=await trending();
      return json({items},200,360);
    }
    if (route.startsWith('/api/stream/')) return ownStream(context,route);
    if (route === '/api/status') {
      return json({backend:ownBackend(context)?'selfhosted':'unconfigured',
        mode:ownBackend(context)?'own':'public-fallback'},200,15);
    }
    if (route === '/api/video') {
      const id=clean(url.searchParams.get('id'),12);
      if (!idOk(id)) return json({error:'Invalid YouTube video ID.'},400);
      if(ownBackend(context)) return await ownVideo(context,id);
      const videoData=await video(id);
      return json(videoData,200,90);
    }
    return json({error:'Not found'},404);
  } catch {
    return json({error:'Playback sources are temporarily unavailable. Try another video or retry.'},503);
  }
}
