(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = {
    form:$('search-form'), input:$('search-input'), results:$('results'),
    heading:$('section-heading'), count:$('result-count'), chips:$('chips'),
    video:$('video-player'), iframe:$('iframe-player'), holder:$('player-placeholder'),
    player:$('player-card'), prompt:$('placeholder-title'), hint:$('placeholder-hint'),
    spinner:$('spinner'), title:$('video-title'), author:$('video-author'),
    quality:$('quality'), retry:$('retry'), alternate:$('alternate'), direct:$('direct'), save:$('save'), share:$('share'),
    toast:$('toast'), tabs:[...document.querySelectorAll('[data-mode]')]
  };
  const state = {seq:0, mode:'trending',current:null,video:null,sourceIndex:0,results:[],usingIframe:false,toastTimer:0};
  function notify(message) {
    el.toast.textContent = message;
    el.toast.classList.add('on');
    clearTimeout(state.toastTimer);
    state.toastTimer=setTimeout(()=>el.toast.classList.remove('on'),3400);
  }
  function getSaved() {
    try {
      const rows=JSON.parse(localStorage.getItem('mxtube-saved')||'[]');
      return Array.isArray(rows) ? rows.filter(x=>/^[\w-]{11}$/.test(x.id)).slice(0,120):[];
    } catch{return [];}
  }
  function setSaved(rows) {
    try {localStorage.setItem('mxtube-saved',JSON.stringify(rows.slice(0,120)));}catch{}
  }
  function htmlSafe(value) {
    return String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function time(total) {
    let n=Math.max(0,Number(total)||0);
    if (!n) return '';
    n=Math.floor(n);
    const parts=[Math.floor(n/3600),Math.floor((n%3600)/60),n%60];
    return (parts[0] ? parts.map(x=>String(x).padStart(2,'0')):parts.slice(1).map(x=>String(x).padStart(2,'0'))).join(':');
  }
  function empty(title,detail) {
    el.results.innerHTML='<div class="empty"><strong>'+htmlSafe(title)+'</strong>'+htmlSafe(detail)+'</div>';
    el.count.textContent='';
  }
  async function api(path) {
    const controller = new AbortController();
    const timer=setTimeout(()=>controller.abort(),16500);
    try {
      const res=await fetch(path,{signal:controller.signal,headers:{accept:'application/json'}});
      const data=await res.json();
      if (!res.ok) throw new Error(data.error||'تعذر الاتصال بمصادر الفيديو');
      return data;
    } finally{clearTimeout(timer);}
  }
  function updateTab() {
    el.tabs.forEach(btn=>btn.setAttribute('aria-selected',String(btn.dataset.mode===state.mode)));
    el.chips.hidden = state.mode==='saved';
  }
  function render(items) {
    state.results=items.filter(x=>/^[A-Za-z0-9_-]{11}$/.test(x.id));
    el.count.textContent=state.results.length ? state.results.length+' فيديو' : '';
    if (!state.results.length) {
      empty('ماكو فيديوهات بهالقسم','جرب كلمة بحث ثانية أو أعد المحاولة.');
      return;
    }
    const fragment=document.createDocumentFragment();
    for(const row of state.results) {
      const button=document.createElement('button');
      button.type='button';button.className='tile';button.dataset.id=row.id;
      button.setAttribute('aria-label','شغّل '+row.title);
      button.innerHTML='<div class="thumb"><img loading="lazy" referrerpolicy="no-referrer" src="https://i.ytimg.com/vi/'+row.id+'/hqdefault.jpg" alt=""><span class="duration">'+htmlSafe(row.live?'LIVE':time(row.duration))+'</span></div>'+
        '<div class="tile-body"><div class="tile-title" dir="auto">'+htmlSafe(row.title)+'</div><div class="tile-by" dir="auto">'+htmlSafe(row.author||'YouTube')+'</div></div>';
      button.addEventListener('click',()=>play(row.id,true,row));
      fragment.appendChild(button);
    }
    el.results.replaceChildren(fragment);
  }
  async function feed(mode,q='',historyWrite=true) {
    state.mode=mode;
    updateTab();
    if (mode==='saved') {
      el.heading.textContent='المحفوظة';
      render(getSaved());
      if(historyWrite)history.replaceState({},'',location.pathname+(state.current?'?v='+state.current:''));
      return;
    }
    el.heading.textContent=mode==='search'?'نتائج البحث':'فيديوهات رائجة';
    empty('جاري جلب الفيديوهات...','');
    try {
      const path=mode==='search'?'/api/search?q='+encodeURIComponent(q):'/api/trending';
      const data=await api(path);
      if(state.mode!==mode)return;
      render(Array.isArray(data.items)?data.items:[]);
      if (mode==='search'&&historyWrite)history.replaceState({},'',location.pathname+'?q='+encodeURIComponent(q));
    } catch {
      if(state.mode!==mode)return;
      empty('حالياً البحث غير متاح','مصادر البحث الخارجية متوقفة أو ما تجاوبت. جرّب مرة ثانية.');
      notify('تعذر الاتصال بمصادر البحث حالياً');
    }
  }
  function setLoading(title='جاري تجهيز الفيديو...',hint='ندور على مصدر تشغيل بدون إعلانات يوتيوب') {
    el.holder.hidden=false;
    el.prompt.textContent=title;el.hint.textContent=hint;
    el.spinner.hidden=false;
    el.iframe.hidden=true;el.video.hidden=true;
    el.iframe.style.display='none';el.video.style.display='none';
    el.video.pause();el.video.removeAttribute('src');el.video.load();el.iframe.src='about:blank';
  }
  function revealVideo() {
    el.holder.hidden=true;
    el.video.hidden=false;el.video.style.display='block';
    el.iframe.hidden=true;el.iframe.style.display='none';
    el.iframe.src='about:blank';
  }
  function resetControls() {
    el.quality.hidden=true;el.quality.innerHTML='';
    el.retry.hidden=false;el.alternate.hidden=true;el.direct.hidden=false;el.direct.textContent='▶ يوتيوب مباشر';
    el.title.textContent='جاري التحميل...';el.author.textContent='';
    el.save.hidden=false;el.share.hidden=false;
  }
  function updateSave() {
    const saved=getSaved().some(x=>x.id===state.current);
    el.save.textContent=saved?'♥ محفوظ':'♡ حفظ';
    el.save.setAttribute('aria-pressed',String(saved));
  }
  function applySource(index,shouldPlay=false) {
    const info=state.video;
    if (!info || index>=info.sources.length) {
      showAlternative();
      return;
    }
    const src=info.sources[index];
    state.sourceIndex=index;state.usingIframe=false;
    el.direct.textContent='▶ يوتيوب مباشر';
    el.quality.value=String(index);
    revealVideo();
    el.video.pause();
    el.video.removeAttribute('src');
    el.video.load();
    el.video.src=src.url;
    el.video.load();
    if(shouldPlay)el.video.play().catch(()=>{});
  }
  function showAlternative() {
    const id=state.current;
    if(!id)return;
    state.usingIframe=true;
    el.video.pause();el.video.removeAttribute('src');el.video.load();
    el.video.hidden=true;el.video.style.display='none';
    el.iframe.hidden=false;el.iframe.style.display='block';
    el.holder.hidden=true;
    const fallback=(state.video && state.video.embed)||'https://inv.nadeko.net/embed/'+id+'?local=true';
    const parsed = new URL(fallback);
    const known=['inv.nadeko.net','invidious.tiekoetter.com','invidious.nerdvpn.de','yt.chocolatemoo53.com'];
    const safe=parsed.protocol==='https:' && known.includes(parsed.hostname) && parsed.pathname.startsWith('/embed/'+id);
    el.iframe.src=safe?fallback:'https://inv.nadeko.net/embed/'+id+'?local=true';
    el.alternate.hidden=false;el.alternate.textContent='بدّل السيرفر';
    notify('جرّب المشغّل البديل داخل MXTube');
    el.direct.textContent='▶ يوتيوب مباشر';
  }
  function showDirect() {
    const id=state.current;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return;
    state.usingIframe=true;
    el.video.pause();el.video.removeAttribute('src');el.video.load();
    el.video.hidden=true;el.video.style.display='none';
    el.holder.hidden=true;
    el.iframe.hidden=false;el.iframe.style.display='block';
    el.iframe.src='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(id)+'?autoplay=1&playsinline=1&rel=0';
    el.direct.textContent='◀ الرجوع للوضع النظيف';
    notify('تشغيل YouTube داخل MXTube · قد تظهر إعلانات');
  }
  el.direct.addEventListener('click',()=>{
    if (!state.current) return;
    if (state.usingIframe && el.iframe.src.includes('youtube-nocookie.com')) {
      if (state.video?.sources?.length) applySource(state.sourceIndex,true);
      else play(state.current,false,null,true);
    } else showDirect();
  });
  async function play(id,writeHistory=true,fromItem=null,refresh=false) {
    if(!/^[A-Za-z0-9_-]{11}$/.test(id))return;
    const seq=++state.seq;
    state.current=id;state.video=null;state.sourceIndex=0;
    resetControls();
    setLoading();
    const item=fromItem||state.results.find(x=>x.id===id)||getSaved().find(x=>x.id===id);
    if(item){el.title.textContent=item.title||'فيديو يوتيوب';el.author.textContent=item.author||'';}
    updateSave();
    if (writeHistory) history.pushState({id},'',location.pathname+'?v='+encodeURIComponent(id));
    el.player.scrollIntoView({behavior:'smooth',block:'start'});
    try {
      const video=await api('/api/video?id='+encodeURIComponent(id)+(refresh?'&refresh='+Date.now():''));
      if(seq!==state.seq)return;
      const sources=Array.isArray(video.sources)?video.sources.filter(s=>{
        try{return new URL(s.url).protocol==='https:';}catch{return false;}
      }):[];
      if(!sources.length) throw new Error('no playback sources');
      state.video={...video,sources};
      el.title.textContent=video.title||el.title.textContent;
      el.author.textContent=video.author||el.author.textContent;
      el.quality.innerHTML='';
      sources.forEach((s,index)=>{
        const option=document.createElement('option');option.value=String(index);
        option.textContent=(s.label||'جودة تلقائية')+' · '+s.origin;
        el.quality.appendChild(option);
      });
      el.quality.hidden=sources.length<2;
      el.alternate.hidden=false;
      el.alternate.textContent='مشغّل بديل';
      let preferred=sources.findIndex(s=>s.type.includes('mp4') && s.quality>=360 && s.quality<=720);
      if(preferred<0)preferred=sources.findIndex(s=>s.type.includes('mp4'));
      applySource(preferred>=0?preferred:0,true);
    } catch {
      if(seq!==state.seq)return;
      state.video={embed:'https://inv.nadeko.net/embed/'+id+'?local=true',sources:[]};
      el.title.textContent=el.title.textContent==='جاري التحميل...'?'تعذر الوصول للفيديو':el.title.textContent;
      el.holder.hidden=false;
      el.prompt.textContent='المصدر النظيف غير متاح حالياً';
      el.hint.textContent='تكدر تجرّب يوتيوب مباشر داخل MXTube، لكن قد تظهر إعلانات.';
      el.spinner.hidden=true;
      el.video.hidden=true;el.video.style.display='none';
      el.iframe.hidden=true;el.iframe.style.display='none';
      el.alternate.hidden=false;
      el.alternate.textContent='مشغّل بديل';
      el.direct.textContent='▶ يوتيوب مباشر';
    }
  }
  el.video.addEventListener('error',()=>{
    if(!state.video || state.usingIframe || !state.current)return;
    const next=state.sourceIndex+1;
    if(next<state.video.sources.length) {
      notify('جاري تغيير مصدر التشغيل');
      applySource(next,true);
    } else showAlternative();
  });
  el.quality.addEventListener('change',()=>applySource(Number(el.quality.value),true));
  el.alternate.addEventListener('click',()=>{
    if(!state.current)return;
    if(!state.usingIframe){showAlternative();return;}
    const all=['https://inv.nadeko.net','https://invidious.tiekoetter.com','https://invidious.nerdvpn.de','https://yt.chocolatemoo53.com'];
    const current=new URL(el.iframe.src).origin;
    const next=(all.indexOf(current)+1)%all.length;
    el.iframe.src=all[next]+'/embed/'+state.current+'?local=true';
    notify('تم تبديل السيرفر داخل الموقع');
  });
  el.retry.addEventListener('click',()=>state.current&&play(state.current,false,null,true));
  el.save.addEventListener('click',()=>{
    if(!state.current)return;
    let list=getSaved();
    const found=list.some(x=>x.id===state.current);
    if(found)list=list.filter(x=>x.id!==state.current);
    else list.unshift({id:state.current,title:el.title.textContent,author:el.author.textContent,duration:state.video?.duration||0});
    setSaved(list);
    updateSave();
    notify(found?'انحذف من المحفوظة':'انحفظ الفيديو على جهازك');
    if(state.mode==='saved')render(getSaved());
  });
  el.share.addEventListener('click',async()=>{
    if(!state.current)return;
    const link=location.origin+'/?v='+state.current;
    try {
      if(navigator.share)await navigator.share({title:el.title.textContent,url:link});
      else {await navigator.clipboard.writeText(link);notify('انسخ رابط MXTube');}
    } catch(err){if(err?.name!=='AbortError')notify('تعذر مشاركة الرابط');}
  });
  function findId(value) {
    const text=value.trim();
    if(/^[A-Za-z0-9_-]{11}$/.test(text))return text;
    let url;
    try {url=new URL(/^https?:\/\//i.test(text)?text:'https://'+text);}
    catch{return null;}
    const hostname=url.hostname.toLowerCase();
    if(hostname==='youtu.be') {
      const v=url.pathname.split('/')[1];
      return /^[A-Za-z0-9_-]{11}$/.test(v)?v:null;
    }
    if(!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','www.youtube-nocookie.com'].includes(hostname))return null;
    const v=url.searchParams.get('v')||(['shorts','live','embed'].includes(url.pathname.split('/')[1])?url.pathname.split('/')[2]:null);
    return /^[A-Za-z0-9_-]{11}$/.test(v||'')?v:null;
  }
  el.form.addEventListener('submit',(event)=>{
    event.preventDefault();
    const q=el.input.value.trim();
    if(!q)return;
    const id=findId(q);
    if(id){play(id,true);return;}
    if(q.length<2){notify('اكتب كلمتين أو رابط فيديو');return;}
    feed('search',q);
  });
  for(const btn of el.tabs){
    btn.addEventListener('click',()=>{
      const mode=btn.dataset.mode;
      if(mode==='search'){el.input.focus();notify('اكتب اسم الفيديو واضغط بحث');return;}
      feed(mode);
    });
  }
  for(const btn of document.querySelectorAll('[data-quick]')){
    btn.addEventListener('click',()=>{
      const q=btn.dataset.quick;
      el.input.value=q;
      feed('search',q);
    });
  }
  window.addEventListener('popstate',()=>{
    const url=new URL(location.href);
    const v=url.searchParams.get('v');
    if(v&&/^[A-Za-z0-9_-]{11}$/.test(v))play(v,false);
    else if(url.searchParams.has('q')){el.input.value=url.searchParams.get('q');feed('search',el.input.value,false);}
    else feed('trending','',false);
  });
  (()=>{
    const url=new URL(location.href);
    const id=url.searchParams.get('v');
    if(id&&/^[A-Za-z0-9_-]{11}$/.test(id)){play(id,false);feed('trending','',false);}
    else if(url.searchParams.has('q')){el.input.value=url.searchParams.get('q');feed('search',el.input.value,false);}
    else feed('trending','',false);
  })();
})();