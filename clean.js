(() => {
  'use strict';
  if (window.__mxYTContentClean) return;
  window.__mxYTContentClean = true;

  const AD_CSS = `
    ytd-ad-slot-renderer, ytd-display-ad-renderer,
    ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer,
    ytd-promoted-video-renderer, ytd-video-masthead-ad-v3-renderer,
    ytd-player-legacy-desktop-watch-ads-renderer, ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    ytm-promoted-sparkles-web-renderer, ytm-companion-ad-renderer,
    #masthead-ad, #player-ads, #ad_creative_1, #ad_creative_2,
    .ytp-ad-overlay-container, .ytp-ad-message-container,
    ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"] {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      min-height: 0 !important;
    }
  `;
  function ensureStyle() {
    if (document.getElementById('mx-youtube-clean-style')) return;
    const style = document.createElement('style');
    style.id = 'mx-youtube-clean-style';
    style.textContent = AD_CSS;
    (document.head || document.documentElement).appendChild(style);
  }
  ensureStyle();

  let scheduled = false;
  function skipAd() {
    scheduled = false;
    const closers = document.querySelectorAll(
      '.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container button, .ytp-ad-image-overlay button'
    );
    for (const button of closers) {
      try { button.click(); } catch (_) {}
    }
    const player = document.querySelector('.html5-video-player');
    if (!player || !player.classList.contains('ad-showing')) return;
    for (const selector of [
      '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern',
      '.ytp-skip-ad-button', '.ytp-ad-skip-button-slot button',
      'button.ytp-ad-skip-button', 'button.ytp-ad-skip-button-modern'
    ]) {
      const button = player.querySelector(selector);
      if (button && !button.disabled) {
        try { button.click(); } catch (_) {}
      }
    }
    const media = player.querySelector('video');
    if (media && Number.isFinite(media.duration) && media.duration > 0 &&
        media.duration < 3600 && media.currentTime < media.duration - 0.2) {
      try { media.currentTime = Math.max(0, media.duration - 0.05); } catch (_) {}
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(skipAd);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'aria-label']
  });
  document.addEventListener('yt-navigate-finish', schedule, true);
  document.addEventListener('loadedmetadata', schedule, true);
  setInterval(schedule, 900);
  schedule();
})();