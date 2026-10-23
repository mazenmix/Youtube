// MXTube public video metadata gateway.
// The browser plays third-party video URLs inside its own native player; this Function never proxies video bytes.
const INV = [
  'https://inv.nadeko.net',
  'https://invidious.tiekoetter.com',
  'https://invidious.nerdvpn.de',
  'https://yt.chocolatemoo53.com'
];
const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.nosebs.ru'
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
    if (route === '/api/video') {
      const id=clean(url.searchParams.get('id'),12);
      if (!idOk(id)) return json({error:'Invalid YouTube video ID.'},400);
      const videoData=await video(id);
      return json(videoData,200,90);
    }
    return json({error:'Not found'},404);
  } catch {
    return json({error:'Playback sources are temporarily unavailable. Try another video or retry.'},503);
  }
}
