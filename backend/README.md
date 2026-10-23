# MXTube standalone backend

Uses `yt-dlp[default]` and the Deno JavaScript runtime to extract progressive
audio+video streams from YouTube. No Piped or Invidious service is used by this backend.

## Connect to your MXTube Cloudflare Pages website

1. Deploy `backend/Dockerfile` with Docker, or provision via `render.yaml`.
2. On the backend, create a secret environment variable `MX_STREAM_SECRET` with
   at least 24 random characters. Keep it private.
3. On Cloudflare Pages (`mxtube`), in Settings > Variables and Secrets, set:
   - `MX_STREAM_BACKEND_URL` to the HTTPS origin of your deployed backend.
   - `MX_STREAM_SECRET` to exactly the same secret as on the backend.
4. Deploy the site again. The Pages Function will prefer the standalone backend
   for `/api/video` and proxy authenticated Range streaming to the local
   HTML5 player through `/api/stream/{video_id}/{format_id}`.

The gateway will retain the existing Piped/Invidious metadata fallback until
the standalone service is enabled. Streaming bytes transit the hosting provider
and Cloudflare; bandwidth and server charges may apply. Some formats and videos
cannot be extracted because of restrictions or YouTube changes. There is no
guarantee that every video will work or that all ads are absent from every source.

Security: validated 11-character IDs, validated stream identifiers, Googlevideo
host allow-list, secret authentication, per-client rate limits, and small bounded
metadata cache. Add WAF / quotas for a public deployment. The service never
accepts arbitrary user-submitted URLs for fetching.
