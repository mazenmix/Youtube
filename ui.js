(() => {
  const base = 'https://www.youtube.com/';
  const validYoutube = (value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      const host = url.hostname.toLowerCase();
      if (host === 'youtu.be') {
        const id = url.pathname.slice(1).split('/')[0];
        return /^[a-zA-Z0-9_-]{11}$/.test(id)
          ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(id) : null;
      }
      if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
        return 'https://www.youtube.com' + url.pathname + url.search + url.hash;
      }
      return null;
    } catch (_) { return null; }
  };
  const open = (url) => chrome.tabs.create({url});
  for (const button of document.querySelectorAll('[data-go]')) {
    button.addEventListener('click', () => open(base + button.dataset.go));
  }
  for (const form of document.querySelectorAll('[data-search-form]')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = form.querySelector('input');
      const value = input.value.trim();
      if (!value) return;
      const ytUrl = validYoutube(value);
      if (ytUrl) {
        open(ytUrl);
      } else if (/^https?:\/\//i.test(value)) {
        form.querySelector('.feedback').textContent = 'الرابط مو من يوتيوب. الصگ رابط يوتيوب أو اكتب كلمة للبحث.';
        return;
      } else {
        open(base + 'results?search_query=' + encodeURIComponent(value));
      }
      input.value = '';
    });
  }
})();