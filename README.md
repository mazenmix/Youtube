# MXTube · MazenmiX

**Live website:** https://mxtube.pages.dev/

Dark, responsive in-site video player for iPhone and desktop. Watch videos
inside the website with an HTML5 player; search, saved videos, quality
selection, and Full Screen.

## Playback architecture

* **Standalone backend (new):** `backend/app.py` runs FastAPI + yt-dlp +
  Deno. It extracts combined audio/video streams for a small private-use site,
  relays allowed Google video CDN requests, supports HTTP Range seeking and
  requires a private key. It does not use Invidious or Piped.
* **Cloudflare Pages gateway:** `functions/api/[[route]].js` securely forwards
  video requests to the standalone service if configured. Browser playback
  URLs remain on `mxtube.pages.dev`.
* **Existing legacy fallback:** Until the standalone service is deployed and
  its environment variables are configured, the site continues using the
  existing public metadata gateways. Visit `/api/status` for live backend
  configuration state.
* **Official YouTube fallback:** an optional in-page embedded player. This
  may display advertisements and is clearly labelled.

## Activate the standalone streaming backend

1. Deploy the `backend/Dockerfile` on a Docker host. A sample Render
   `render.yaml` is included; a hosting account and a new web service are
   required.
2. Set a random backend `MX_STREAM_SECRET` of 24+ characters.
3. In your Cloudflare Pages project, create two server-side environment
   variables: `MX_STREAM_BACKEND_URL` (HTTPS backend origin) and
   `MX_STREAM_SECRET` (the same backend secret).
4. Redeploy the Pages project, then check
   `https://mxtube.pages.dev/api/status`. Its `backend` field should
   report `selfhosted`.
5. Verify playback and seeking of a public video on Safari and Chrome.

**Status:** The code is committed; unless the environment above is set,
the new standalone server is **not live**.

Video availability depends on YouTube's ongoing anti-bot and PO Token
enforcement, legal access, bandwidth limits and extraction compatibility.
Zero advertisements and universal playback cannot be guaranteed.

## Chrome extension

The original `manifest.json`, `clean.js`, and `popup.html` files remain
available for desktop Chrome. To install, open `chrome://extensions`,
enable Developer Mode, choose Load unpacked, and select this repository root.
Chrome on iOS cannot install desktop extensions.

## Development

See [backend/README.md](backend/README.md) for deployment, security and
operating notes.
