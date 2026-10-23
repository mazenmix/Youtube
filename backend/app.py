"""Self-hosted MXTube yt-dlp gateway: public video IDs only, authenticated from Cloudflare."""
import asyncio
import hmac
import os
import re
import time
from collections import defaultdict, deque
from urllib.parse import urlsplit

import httpx
import yt_dlp
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
FID = re.compile(r"^[A-Za-z0-9_.-]{1,72}$")
GOOGLEVIDEO = re.compile(r"(^|\.)googlevideo\.com$", re.I)
cache = {}
hits = defaultdict(deque)
slots = asyncio.Semaphore(3)

def guard(secret):
    server_secret = os.getenv("MX_STREAM_SECRET", "")
    if len(server_secret) < 24 or not secret or not hmac.compare_digest(secret, server_secret):
        raise HTTPException(403, "Authentication required")

def limit(request, stream=False):
    # Cap abuse on a per-forwarded-client basis. Set WAF/rate limits at Cloudflare too.
    ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    key = ip[:80] + (":s" if stream else ":m")
    q = hits[key]
    now = time.monotonic()
    while q and q[0] < now-60: q.popleft()
    if len(q) >= (80 if stream else 30): raise HTTPException(429, "Too many requests")
    q.append(now)
    if len(hits) > 4000:
        for key in list(hits)[:1000]:
            if not hits[key] or hits[key][-1] < now-60: hits.pop(key, None)

def good_url(value):
    try:
        p = urlsplit(value)
        return p.scheme == "https" and p.port in (None,443) and bool(GOOGLEVIDEO.search(p.hostname or ""))
    except (ValueError, TypeError): return False

def extract_sync(vid):
    opts = {
        "quiet": True, "no_warnings": True, "noplaylist": True,
        "skip_download": True, "socket_timeout": 13, "retries": 1,
        "extractor_args":{"youtube":{"player_client":["android_vr","web_safari","web_embedded"]}},
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        item = ydl.extract_info("https://www.youtube.com/watch?v="+vid, download=False)
    formats = []
    for row in item.get("formats", []) if isinstance(item,dict) else []:
        fid=str(row.get("format_id",""))
        link=row.get("url","")
        ext=row.get("ext","")
        if (row.get("vcodec") in (None,"none") or row.get("acodec") in (None,"none")
            or ext not in ("mp4","webm") or not FID.fullmatch(fid) or not good_url(link)):
            continue
        height=int(row.get("height") or 0)
        if height>1080: continue
        headers={k:v for k,v in (row.get("http_headers") or {}).items()
                 if k.lower() in ("user-agent","referer","origin")}
        formats.append({
            "fid":fid,"_url":link,"_headers":headers,
            "quality":height,"label":str(height)+"p" if height else "Auto",
            "type":"video/mp4" if ext=="mp4" else "video/webm"
        })
    formats.sort(key=lambda x: (x["type"]=="video/mp4",x["quality"]),reverse=True)
    if not formats: raise RuntimeError("No progressive stream available")
    return {
        "id":vid,"title":str(item.get("title") or "")[:240],
        "author":str(item.get("uploader") or item.get("channel") or "")[:100],
        "duration":int(item.get("duration") or 0),
        "thumbnail":"https://i.ytimg.com/vi/"+vid+"/hqdefault.jpg",
        "source":"MXTube",
        "sources":formats[:8],
    }

async def fetch_info(vid):
    if not ID.fullmatch(vid): raise HTTPException(400,"Invalid video ID")
    old=cache.get(vid)
    if old and old[0]>time.monotonic():return old[1]
    async with slots:
        old=cache.get(vid)
        if old and old[0]>time.monotonic():return old[1]
        try:
            data=await asyncio.wait_for(asyncio.to_thread(extract_sync,vid),timeout=28)
        except Exception as exc:
            raise HTTPException(503,"Video extraction not available") from exc
        if len(cache)>=80: cache.pop(next(iter(cache)))
        cache[vid]=(time.monotonic()+420,data)
        return data

@app.get("/health")
async def health():
    return {"status":"ok","backend":"mxtube-selfhost"}

@app.get("/api/video")
async def video(request:Request,id:str="",x_mxtube_key:str|None=Header(None)):
    guard(x_mxtube_key);limit(request)
    info=await fetch_info(id)
    return {
        **{k:info[k] for k in ("id","title","author","duration","thumbnail","source")},
        "sources":[{
          "url":"/api/stream/"+id+"/"+f["fid"],
          "type":f["type"],"quality":f["quality"],"label":f["label"],"origin":"MXTube"
        } for f in info["sources"]]
    }

@app.api_route("/api/stream/{vid}/{fid}",methods=["GET","HEAD"])
async def stream(request:Request,vid:str,fid:str,x_mxtube_key:str|None=Header(None)):
    guard(x_mxtube_key);limit(request,stream=True)
    if not ID.fullmatch(vid) or not FID.fullmatch(fid):
        raise HTTPException(400,"Bad video or format ID")
    info=await fetch_info(vid)
    f=next((f for f in info["sources"] if f["fid"]==fid),None)
    if not f:raise HTTPException(404,"Unknown video format")
    url=f["_url"]
    if not good_url(url):raise HTTPException(502,"Untrusted media host")
    headers={**f["_headers"],"Accept-Encoding":"identity"}
    rng=request.headers.get("range")
    if rng:
        if not re.fullmatch(r"bytes=\d{0,16}-\d{0,16}",rng):
            raise HTTPException(416,"Invalid range")
        headers["Range"]=rng
    client=httpx.AsyncClient(follow_redirects=False,timeout=httpx.Timeout(20,read=60))
    try:
        method="HEAD" if request.method=="HEAD" else "GET"
        resp=await client.send(client.build_request(method,url,headers=headers),stream=True)
        if resp.status_code not in (200,206):
            await resp.aclose();await client.aclose()
            raise HTTPException(502,"Upstream video unavailable")
        out={k:resp.headers[k] for k in ("content-type","content-length","content-range","accept-ranges")
             if k in resp.headers}
        out["cache-control"]="private, no-store"
        out["x-content-type-options"]="nosniff"
        async def chunks():
            try:
                async for b in resp.aiter_raw(chunk_size=65536):
                    if await request.is_disconnected(): break
                    yield b
            finally:
                await resp.aclose()
                await client.aclose()
        return StreamingResponse(chunks(),status_code=resp.status_code,headers=out)
    except HTTPException:raise
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(502,"Media request failed") from exc
