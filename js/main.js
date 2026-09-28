(function(){
'use strict';
var $=function(s,c){return (c||document).querySelector(s)}, $$=function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};
var RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
var FINE=matchMedia('(pointer: fine)').matches;

/* ---------- theme ---------- */
var rootEl=document.documentElement;
try{var t=localStorage.getItem('cv-theme'); if(t) rootEl.dataset.theme=t;}catch(e){}
$('#themeBtn').addEventListener('click',function(){
  rootEl.dataset.theme = rootEl.dataset.theme==='dark' ? 'light':'dark';
  try{localStorage.setItem('cv-theme',rootEl.dataset.theme)}catch(e){}
});

/* ---------- loader ---------- */
var loader=$('#loader'), pct=0, lgP=$('#lgPct'), lgB=$('#lgBar');
function bootDone(){
  if(loader.classList.contains('done')) return;
  loader.classList.add('done');
  setTimeout(function(){ show(nameFromHash(),true); }, RM?0:250);
  /* Ambient motion is released only after the first real frame is painted,
     so the orbs / marquee / particles never compete with the loader.     */
  var kick=function(){
    document.body.classList.add('booted');
    if(typeof startParticles==='function') startParticles();
    if(typeof measure==='function'){ measure(); scrollFrame(); }
  };
  if(window.requestAnimationFrame) requestAnimationFrame(function(){ requestAnimationFrame(kick); });
  else setTimeout(kick,0);
}
if(RM){ bootDone(); }
else{
  var t0=performance.now();
  (function tickL(now){
    var p=Math.min(100,Math.floor((now-t0)/14));
    lgP.textContent=String(p).padStart(3,'0');
    lgB.style.width=p+'%';
    if(p<100) requestAnimationFrame(tickL); else setTimeout(bootDone,350);
  })(t0);
}

/* ---------- router ---------- */
var pages={}; $$('.page').forEach(function(p){pages[p.dataset.page]=p});
var TITLES={}; $$('.page').forEach(function(p){TITLES[p.dataset.page]=p.dataset.title});
var cur=null, busy=false;
function nameFromHash(){var h=location.hash.replace(/^#\/?/,'');return h||'home'}
function show(name,first){
  var next=pages[name]?name:'404';
  if(next===cur){window.scrollTo(0,0);return}
  var doSwap=function(){
    if(cur&&pages[cur]) pages[cur].classList.remove('on');
    cur=next;
    var el=pages[cur];
    el.classList.add('on');
    document.title=TITLES[cur]||'Caravel';
    window.scrollTo(0,0);
    $$('.nav-links a.nl').forEach(function(a){
      var href=a.getAttribute('href')||'';
      a.setAttribute('aria-current', href==='#/'+cur ? 'page':'false');
    });
    closeAll();
    /* new page = new document height; re-cache geometry once, not per frame */
    if(typeof refreshAfterRoute==='function') refreshAfterRoute();
  };
  if(first||RM||!cur){ doSwap(); return; }
  busy=true;
  var oldEl=pages[cur];
  oldEl.classList.add('out');
  setTimeout(function(){ oldEl.classList.remove('out'); doSwap(); busy=false; },270);
}
window.addEventListener('hashchange',function(){ if(!busy) show(nameFromHash()); });

/* ---------- reveal / counters / scramble ---------- */
function scramble(el){
  var orig=el.dataset.text||el.textContent; el.dataset.text=orig;
  if(RM){el.textContent=orig;return}
  var chars='—+×/<>#01', total=Math.max(16,orig.length*2), f=0;
  (function tick(){
    f++;
    var out='', prog=f/total;
    for(var i=0;i<orig.length;i++){
      var c=orig[i];
      if(c===' '){out+=' ';continue}
      out += (i/orig.length < prog*1.25-0.2) ? c : chars[Math.floor(Math.random()*chars.length)];
    }
    el.textContent=out;
    if(f<total) requestAnimationFrame(tick); else el.textContent=orig;
  })();
}
function count(el){
  var target=parseFloat(el.dataset.count), dec=parseInt(el.dataset.dec||'0',10);
  if(RM){el.textContent=target.toFixed(dec);return}
  var t0=performance.now(), dur=1600;
  (function tick(now){
    var p=Math.min(1,(now-t0)/dur), e=1-Math.pow(1-p,3);
    el.textContent=(target*e).toFixed(dec);
    if(p<1) requestAnimationFrame(tick);
  })(t0);
}
var io=new IntersectionObserver(function(es){
  es.forEach(function(en){
    if(!en.isIntersecting) return;
    var el=en.target;
    el.classList.add('in');
    if(el.hasAttribute('data-scr')) scramble(el);
    if(el.hasAttribute('data-count')) count(el);
    if(el.hasAttribute('data-term')) el.classList.add('run');
    io.unobserve(el);
  });
},{threshold:.15,rootMargin:'0px 0px -6% 0px'});
$$('[data-rv],[data-scr],[data-count],[data-term],.steps,.tl').forEach(function(el){io.observe(el)});

/* ============================================================
   SCROLL + PERFORMANCE ENGINE
   - one batched rAF loop drives every scroll-linked effect
   - ZERO layout reads per frame (geometry cached, invalidated on
     resize / route change / content resize instead)
   - writes use translate3d + will-change so they stay on the GPU
   - a frame-time profiler demotes the page to a "lite" tier when
     the device genuinely stutters, and promotes it back when it
     recovers (hysteresis, so it can't oscillate)
   ============================================================ */
var bodyEl=document.body;
var nav=$('#nav'), pbar=$('#pbar'), totop=$('#totop'), ringC=$('#totop .ring circle');
var innerH=innerHeight, docH=1, lastProg=-1, lastSc=null, lastTo=null;
var scrolling=false, scrollEndT=0, frameId=0, lastT=0;
var plxCache=[], tocLinks=[], tocCache=[], tocLast=null;
/* feature handles, assigned by the blocks below */
var ambient=false, glowing=false, heroVisible=false;
var startParticles=function(){}, stopParticles=function(){}, drawParticles=function(){}, glowFrame=function(){};

/* ---------- geometry cache ---------- */
function buildPlx(){
  plxCache=$$('[data-plx]').map(function(el){
    return {el:el, host:el.parentElement, k:parseFloat(el.dataset.plx)||0, top:0, h:0, ok:false, last:NaN};
  });
}
function buildToc(){
  tocLinks=$$('[data-toc] a');
  tocCache=tocLinks.map(function(a){
    return {a:a, el:document.getElementById(a.getAttribute('href').slice(1)), top:0};
  });
}
function measure(){
  var sy=window.scrollY||rootEl.scrollTop||0;
  for(var i=0;i<plxCache.length;i++){
    var p=plxCache[i], r=p.host.getBoundingClientRect();
    p.top=r.top+sy; p.h=r.height; p.ok=true;
  }
  for(var j=0;j<tocCache.length;j++){
    var t=tocCache[j];
    if(t.el) t.top=t.el.getBoundingClientRect().top+sy;
  }
  docH=Math.max(1,rootEl.scrollHeight);
}
function invalidate(){ for(var i=0;i<plxCache.length;i++) plxCache[i].ok=false; measure(); }
function refreshAfterRoute(){
  lastProg=-1; lastSc=null; lastTo=null; tocLast=null;
  for(var i=0;i<plxCache.length;i++) plxCache[i].last=NaN;
  setTimeout(function(){ measure(); scrollFrame(); requestFrame(); },60);
}

/* ---------- adaptive quality tiers ----------
   Demote when measured frames are consistently slow; climb back only
   after several consecutive comfortable windows, so it can never
   oscillate between tiers.                                          */
var tier='high', tierAcc=0, tierN=0, demoteLock=0, goodRuns=0;
function setTier(t){
  if(tier===t) return;
  tier=t;
  bodyEl.classList.toggle('perf-lite',t==='lite');
  if(t==='lite') stopParticles(); else startParticles();
}
function sampleFrame(dt){
  if(demoteLock>0){ demoteLock--; return; }
  tierAcc+=dt; tierN++;
  if(tierN<120) return;                 /* judge over ~2s of real frames */
  var avg=tierAcc/tierN; tierAcc=0; tierN=0;
  if(tier==='high'){
    if(avg>22){ setTier('lite'); demoteLock=240; }   /* < ~45fps sustained */
  }else{
    if(avg<12){ if(++goodRuns>=4){ goodRuns=0; setTier('high'); } }
    else goodRuns=0;
  }
}
function getTier(){ return tier; }

/* ---------- the frame ---------- */
function scrollFrame(){
  var y=window.scrollY||rootEl.scrollTop||0;
  var max=docH-innerH, prog=max>0?Math.min(1,Math.max(0,y/max)):0;
  if(Math.abs(prog-lastProg)>0.0004){
    lastProg=prog;
    pbar.style.transform='scaleX('+prog.toFixed(4)+')';
    if(ringC) ringC.style.strokeDashoffset=(150*(1-prog)).toFixed(1);
  }
  var sc=y>10; if(sc!==lastSc){ lastSc=sc; nav.classList.toggle('scrolled',sc); }
  var to=y>700; if(to!==lastTo){ lastTo=to; totop.classList.toggle('on',to); }
  for(var i=0;i<plxCache.length;i++){
    var p=plxCache[i];
    if(!p.ok){ var r=p.host.getBoundingClientRect(); p.top=r.top+y; p.h=r.height; p.ok=true; }
    if(y+p.h<-200||y>p.top+p.h+200) continue;      /* off-screen: don't even write */
    var off=Math.round((((p.top-y)+p.h/2-innerH/2)*p.k)*2)/2;
    if(off!==p.last){ p.last=off; p.el.style.transform='translate3d(0,'+(-off)+'px,0)'; }
  }
  spyFrame(y);
}
function frame(now){
  frameId=0;
  var dt=lastT?(now-lastT):16; lastT=now;
  sampleFrame(dt);
  if(scrolling) scrollFrame();
  if(ambient) drawParticles();
  if(glowing) glowFrame();
  if(scrolling||ambient||glowing) requestFrame(); else lastT=0;
}
function requestFrame(){ if(!frameId) frameId=requestAnimationFrame(frame); }

/* ---------- wiring ---------- */
function onScrollEvent(){
  if(!scrolling){ scrolling=true; bodyEl.classList.add('is-scrolling'); }
  clearTimeout(scrollEndT);
  scrollEndT=setTimeout(function(){
    scrolling=false; bodyEl.classList.remove('is-scrolling');
    invalidate(); requestFrame();      /* re-measure once the dust settles */
  },150);
  requestFrame();
}
addEventListener('scroll',onScrollEvent,{passive:true});
addEventListener('resize',function(){ innerH=innerHeight; invalidate(); requestFrame(); },{passive:true});
if(typeof ResizeObserver!=='undefined'){
  try{ new ResizeObserver(function(){ invalidate(); }).observe(document.body); }catch(e){}
}
if('scrollRestoration' in history) history.scrollRestoration='manual';
buildPlx(); buildToc(); measure(); scrollFrame();
totop.addEventListener('click',function(){window.scrollTo({top:0,behavior:RM?'auto':'smooth'})});

/* ---------- pause off-screen ambient animation ---------- */
if('IntersectionObserver' in window){
  var ambIO=new IntersectionObserver(function(es){
    es.forEach(function(en){ en.target.classList.toggle('anim-off',!en.isIntersecting); });
  },{rootMargin:'140px 0px'});
  $$('.hero,.band,.st-card,.featpost,.bcard,.mq,.cta-band,.svc-prev,.pitem,.tpanel,.float-card')
    .forEach(function(el){ ambIO.observe(el); });
}
/* ---------- particles ----------
   Was: 70 points, O(n^2) = 2,415 pair tests, one beginPath per point,
   redrawn forever — even off-screen and in a hidden tab.            */
var cv=$('#px');
if(cv){
  var cx=cv.getContext('2d'), pts=[], W=0, H=0, pRaf=0, pLast=0;
  var PCOUNT=innerWidth<760?34:64;      /* mobile gets a lighter field  */
  var LINK2=9000;                        /* same 95px radius as before */
  function sizeCv(){
    var r=cv.getBoundingClientRect();
    W=cv.width=Math.max(1,Math.round(r.width||cv.offsetWidth));
    H=cv.height=Math.max(1,Math.round(r.height||cv.offsetHeight));
  }
  function seed(){
    pts=[];
    for(var i=0;i<PCOUNT;i++) pts.push({x:Math.random(),y:Math.random(),
      vx:(Math.random()-.5)*.0006, vy:(Math.random()-.5)*.0006, r:Math.random()*1.6+.4, px:0, py:0});
  }
  function pTick(ts){
    pRaf=0;
    if(!ambient) return;
    pRaf=requestAnimationFrame(pTick);
    if(ts-pLast<33) return;               /* ~30fps: a particle field does
                                            not need 60, and it halves the
                                            canvas cost on weak GPUs      */
    pLast=ts;
    if(document.hidden) return;
    var dark=rootEl.dataset.theme==='dark';
    var i,j,p,q,dx,dy,d2;
    cx.clearRect(0,0,W,H);
    cx.fillStyle=dark?'rgba(124,231,255,.5)':'rgba(30,94,255,.4)';
    cx.strokeStyle=dark?'rgba(124,231,255,.12)':'rgba(30,94,255,.1)';
    /* move + project once, then reuse the cached pixel coords */
    for(i=0;i<pts.length;i++){
      p=pts[i];
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0||p.x>1) p.vx*=-1;
      if(p.y<0||p.y>1) p.vy*=-1;
      p.px=p.x*W; p.py=p.y*H;
    }
    /* one path for all dots instead of 64 separate fills */
    cx.beginPath();
    for(i=0;i<pts.length;i++){ p=pts[i]; cx.moveTo(p.px+p.r,p.py); cx.arc(p.px,p.py,p.r,0,6.2832); }
    cx.fill();
    /* one path for all links */
    cx.beginPath();
    for(i=0;i<pts.length;i++){
      p=pts[i];
      for(j=i+1;j<pts.length;j++){
        q=pts[j];
        dx=p.px-q.px; dy=p.py-q.py; d2=dx*dx+dy*dy;
        if(d2<LINK2){ cx.moveTo(p.px,p.py); cx.lineTo(q.px,q.py); }
      }
    }
    cx.stroke();
  }
  sizeCv(); seed();
  startParticles=function(){
    if(ambient||RM||tier==='lite'||!heroVisible) return;
    ambient=true; requestFrame();
    if(!pRaf) pRaf=requestAnimationFrame(pTick);
  };
  stopParticles=function(){
    ambient=false;
    if(pRaf){ cancelAnimationFrame(pRaf); pRaf=0; }
    if(cx) cx.clearRect(0,0,W,H);
  };
  drawParticles=function(){ /* driven by the shared frame loop */ };
  addEventListener('resize',function(){ sizeCv(); if(ambient) pLast=0; },{passive:true});
  document.addEventListener('visibilitychange',function(){
    if(document.hidden) stopParticles(); else startParticles();
  });
  /* only animate while the hero is actually on screen */
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(es){
      es.forEach(function(en){
        heroVisible=en.isIntersecting;
        en.isIntersecting?startParticles():stopParticles();
      });
    },{rootMargin:'80px 0px'}).observe(cv);
  } else { heroVisible=true; startParticles(); }
}

/* ---------- hero spotlight ----------
   Was: a getBoundingClientRect() on EVERY mousemove (forced layout),
   writing CSS vars with no coalescing. Now: one rect per hover, and at
   most one style write per frame.                                      */
var hero=$('#hero');
if(hero&&FINE){
  var hRect=null, hRaf=0, hx=0, hy=0;
  hero.addEventListener('mouseenter',function(){ hRect=hero.getBoundingClientRect(); });
  hero.addEventListener('mousemove',function(e){
    if(!hRect) hRect=hero.getBoundingClientRect();
    hx=(e.clientX-hRect.left)/hRect.width*100;
    hy=(e.clientY-hRect.top)/hRect.height*100;
    if(!hRaf) hRaf=requestAnimationFrame(function(){
      hRaf=0;
      hero.style.setProperty('--mx',hx.toFixed(2)+'%');
      hero.style.setProperty('--my',hy.toFixed(2)+'%');
    });
  },{passive:true});
  hero.addEventListener('mouseleave',function(){ hRect=null; });
}

/* ---------- cursor glow ----------
   Was: an unconditional rAF loop that never stopped, writing
   g.style.left / g.style.top — which invalidates layout every frame.
   Now: transform-only (compositor), and the loop shuts itself off
   once the glow has settled and the pointer is idle.                */
if(FINE&&!RM){
  document.body.classList.add('glow-on');
  var g=$('#cglow'), gx=0, gy=0, tx=0, ty=0, gLast=0;
  glowFrame=function(){
    gx+=(tx-gx)*.08; gy+=(ty-gy)*.08;
    g.style.transform='translate3d('+gx+'px,'+gy+'px,0) translate(-50%,-50%)';
    if(Math.abs(tx-gx)<.05 && Math.abs(ty-gy)<.05 && performance.now()-gLast>400) glowing=false;
  };
  addEventListener('mousemove',function(e){
    tx=e.clientX; ty=e.clientY; gLast=performance.now();
    if(!glowing){ glowing=true; requestFrame(); }
  },{passive:true});
  glowing=true; requestFrame();
}

/* ---------- magnetic ---------- */
if(FINE&&!RM){$$('.mag').forEach(function(b){
  var r=null;
  b.addEventListener('mouseenter',function(){ r=b.getBoundingClientRect(); });
  b.addEventListener('mousemove',function(e){
    if(!r) r=b.getBoundingClientRect();
    var x=(e.clientX-r.left-r.width/2)/r.width, y=(e.clientY-r.top-r.height/2)/r.height;
    b.style.transform='translate3d('+(x*10).toFixed(1)+'px,'+(y*8).toFixed(1)+'px,0)';
  });
  b.addEventListener('mouseleave',function(){ r=null; b.style.transform=''; });
});}

/* ---------- 404 compass ----------
   Was: bound to window, so it ran a getBoundingClientRect() on every
   mouse move on EVERY page, even though it only exists on /404.     */
var needle=$('#needle');
if(needle){
  var nSvg=needle.ownerSVGElement, nRect=null, nRaf=0, nAng=0;
  var remeasure=function(){ nRect=nSvg.getBoundingClientRect(); };
  addEventListener('hashchange',remeasure);
  addEventListener('resize',remeasure);
  addEventListener('mousemove',function(e){
    if(!(pages['404']&&pages['404'].classList.contains('on'))) return;
    if(!nRect) remeasure();
    nAng=Math.atan2(e.clientY-(nRect.top+nRect.height/2), e.clientX-(nRect.left+nRect.width/2))*180/Math.PI+90;
    if(!nRaf) nRaf=requestAnimationFrame(function(){
      nRaf=0; needle.style.transform='rotate('+nAng.toFixed(1)+'deg)';
    });
  },{passive:true});
}

/* ---------- mega menu (touch) ---------- */
$$('.mm-btn, .nav-links button.nl').forEach(function(btn){
  btn.addEventListener('click',function(e){
    e.stopPropagation();
    var li=btn.closest('.mm');
    $$('.mm.open').forEach(function(o){if(o!==li)o.classList.remove('open')});
    li.classList.toggle('open');
    btn.setAttribute('aria-expanded',li.classList.contains('open'));
  });
});
document.addEventListener('click',function(){$$('.mm.open').forEach(function(o){o.classList.remove('open')})});

/* ---------- drawer ---------- */
$('#burger').addEventListener('click',function(){document.body.classList.add('drawer')});
$$('[data-dclose]').forEach(function(el){el.addEventListener('click',function(){document.body.classList.remove('drawer')})});
$$('#drawer .pn a').forEach(function(a){a.addEventListener('click',function(){document.body.classList.remove('drawer')})});

/* ---------- accordions ---------- */
$$('.acc-h').forEach(function(h){
  h.addEventListener('click',function(){
    var acc=h.closest('.acc'), open=acc.classList.toggle('open');
    h.setAttribute('aria-expanded',open);
  });
});
/* services rows */
$$('.svc-h').forEach(function(h){
  h.addEventListener('click',function(){
    var row=h.closest('.svc-row'), open=row.classList.toggle('open');
    h.setAttribute('aria-expanded',open);
  });
  h.addEventListener('mouseenter',function(){
    var idx=$$('.svc-h').indexOf(h);
    var imgs=$$('.svc-prev img'); if(!imgs.length)return;
    imgs.forEach(function(im){im.classList.remove('on')});
    if(imgs[idx])imgs[idx].classList.add('on');
    var cap=$('#svcCap'); if(cap) cap.textContent='0'+(idx+1)+' — '+h.querySelector('b').textContent;
  });
});
/* ---------- tabs ---------- */
$$('[data-tabs]').forEach(function(w){
  var tabs=$$('.tab',w);
  tabs.forEach(function(t){
    t.addEventListener('click',function(){
      tabs.forEach(function(x){x.setAttribute('aria-selected','false')});
      t.setAttribute('aria-selected','true');
      var root=w.parentElement;
      $$('.tpanel',root).forEach(function(p){p.classList.toggle('on',p.dataset.panel===t.dataset.tab)});
    });
  });
});

/* ---------- sliders ---------- */
$$('[data-slider]').forEach(function(sl){
  var track=$('.sl-track',sl), slides=$$('.sl-slide',sl), idx=0;
  var dotsW=$('[data-sl-dots]',sl), cnt=$('[data-sl-cnt]',sl);
  slides.forEach(function(_,i){
    var d=document.createElement('i'); if(i===0)d.classList.add('on');
    d.addEventListener('click',function(){go2(i)});
    dotsW.appendChild(d);
  });
  function go2(i){
    idx=(i+slides.length)%slides.length;
    track.style.transform='translateX(-'+(idx*100)+'%)';
    $$('i',dotsW).forEach(function(d,j){d.classList.toggle('on',j===idx)});
    cnt.textContent=String(idx+1).padStart(2,'0')+' / '+String(slides.length).padStart(2,'0');
  }
  $('[data-sl="prev"]',sl).addEventListener('click',function(){go2(idx-1)});
  $('[data-sl="next"]',sl).addEventListener('click',function(){go2(idx+1)});
  if(!RM) setInterval(function(){ if(sl.getBoundingClientRect().top<innerHeight) go2(idx+1) },7000);
});

/* ---------- pricing toggle ---------- */
$$('[data-bill]').forEach(function(b){
  b.addEventListener('click',function(){
    $$('[data-bill]').forEach(function(x){x.classList.remove('on')});
    b.classList.add('on');
    var mode=b.dataset.bill;
    $$('.flip').forEach(function(f){
      f.classList.add('sw');
      setTimeout(function(){f.textContent=f.dataset[mode];f.classList.remove('sw')},200);
    });
  });
});
/* ---------- filters (portfolio + roles) ---------- */
function bindFilter(btnSel,gridSel,itemSel){
  $$(btnSel).forEach(function(b){
    b.addEventListener('click',function(){
      b.parentElement.querySelectorAll('.fbtn').forEach(function(x){x.classList.remove('on')});
      b.classList.add('on');
      var f=b.dataset.f;
      $$(itemSel, $(gridSel) ? $(gridSel).parentElement : document).forEach(function(it){});
      var scope=$(gridSel);
      $$(itemSel,scope||document).forEach(function(it){
        var showIt = f==='all'||it.dataset.cat===f;
        it.classList.toggle('off',!showIt);
        if(showIt){it.style.animation='none';void it.offsetWidth;it.style.animation='pgIn .5s'}
      });
    });
  });
}
bindFilter('.filters [data-f]','[data-pgrid]','.pitem');
$$('[data-rf] .fbtn').forEach(function(b){
  b.addEventListener('click',function(){
    $$('[data-rf] .fbtn').forEach(function(x){x.classList.remove('on')});
    b.classList.add('on');
    var f=b.dataset.f;
    $$('.role').forEach(function(r){
      var showIt=f==='all'||r.dataset.cat===f;
      r.style.display=showIt?'':'none';
      if(showIt){r.style.animation='none';void r.offsetWidth;r.style.animation='pgIn .5s'}
    });
  });
});

/* ---------- modal ---------- */
var modal=$('#modal'), mBody=$('#modalBody');
function openModal(html){mBody.innerHTML=html;modal.classList.add('on');document.body.style.overflow='hidden'}
function closeModal(){modal.classList.remove('on');document.body.style.overflow=''}
$$('[data-mclose]').forEach(function(el){el.addEventListener('click',closeModal)});
$$('.pitem').forEach(function(it){
  it.addEventListener('click',function(){
    openModal(
      '<div class="kb" style="aspect-ratio:16/8;border-radius:26px 26px 0 0;overflow:hidden"><img src="'+it.dataset.pi+'" alt="" style="width:100%;height:100%;object-fit:cover"></div>'+
      '<div style="padding:30px 34px 38px"><span class="chip">'+it.dataset.pm+'</span>'+
      '<h3 class="h-md" style="margin:14px 0 10px">'+it.dataset.pt+'</h3>'+
      '<p style="color:var(--mut);font-size:14.5px;max-width:60ch">'+it.dataset.pd+'</p>'+
      '<div style="display:flex;gap:12px;margin-top:22px"><a class="btn btn-blue btn-sm" href="#/cases" onclick="document.getElementById(\'modal\').classList.remove(\'on\');document.body.style.overflow=\'\'">Full case study</a><a class="btn btn-ghost btn-sm" href="#/contact">Similar project?</a></div></div>'
    );
  });
});
/* video modal */
$$('.vbtn').forEach(function(v){
  v.addEventListener('click',function(){
    openModal('<div class="vplayer"><span class="pulse"><svg><use href="#i-play"/></svg></span><div class="pb"><i></i></div></div><div style="padding:24px 30px 30px"><h3 class="h-md">'+v.dataset.vt+'</h3><p class="mono" style="margin-top:8px">Streaming · Caravel Films</p></div>');
  });
});

/* ---------- search ---------- */
var INDEX=[
 ['home','Home','hero landing start'],['about','About Us','story values timeline team'],
 ['services','Services','strategy design engineering ai cloud security'],
 ['solutions','Solutions','atlas compass helm ledger platform'],
 ['industries','Industries','finance healthcare logistics retail energy'],
 ['portfolio','Portfolio','work projects gallery'],['cases','Case Studies','results proof helios aurora nordwind quantica'],
 ['pricing','Pricing','plans cost voyage expedition flagship'],['careers','Careers','jobs roles hiring culture'],
 ['blog','Blog','insights articles logbook'],['faq','FAQ','questions answers'],
 ['testimonials','Testimonials','quotes reviews clients'],['contact','Contact','email phone offices form'],
 ['privacy','Privacy Policy','gdpr data rights'],['terms','Terms of Service','contract legal']
];
var search=$('#search'), sIn=$('#searchIn'), sRes=$('#searchRes'), selIdx=0;
function openSearch(){search.classList.add('on');document.body.style.overflow='hidden';setTimeout(function(){sIn.focus()},60);renderRes('')}
function closeSearch(){search.classList.remove('on');document.body.style.overflow=''}
function renderRes(q){
  q=q.toLowerCase();
  var hits=INDEX.filter(function(r){return !q||r[1].toLowerCase().indexOf(q)>-1||r[2].indexOf(q)>-1});
  selIdx=0;
  sRes.innerHTML=hits.map(function(r,i){
    return '<li><button class="'+(i===0?'sel':'')+'" data-go="'+r[0]+'"><span>'+r[1]+'</span><span class="mono">'+r[0]+'</span></button></li>';
  }).join('')||'<li style="padding:16px;color:var(--mut);font-size:13px">No coordinates found.</li>';
  $$('button[data-go]',sRes).forEach(function(b){
    b.addEventListener('click',function(){closeSearch();location.hash='#/'+b.dataset.go});
  });
}
sIn.addEventListener('input',function(){renderRes(sIn.value)});
sIn.addEventListener('keydown',function(e){
  var opts=$$('button[data-go]',sRes);
  if(e.key==='ArrowDown'){selIdx=Math.min(selIdx+1,opts.length-1)}
  else if(e.key==='ArrowUp'){selIdx=Math.max(selIdx-1,0)}
  else if(e.key==='Enter'&&opts[selIdx]){closeSearch();location.hash='#/'+opts[selIdx].dataset.go;return}
  else return;
  opts.forEach(function(o,i){o.classList.toggle('sel',i===selIdx)});
});
$('#searchBtn').addEventListener('click',openSearch);
$$('[data-sclose]').forEach(function(el){el.addEventListener('click',closeSearch)});
addEventListener('keydown',function(e){
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch()}
  if(e.key==='Escape'){closeSearch();closeModal();document.body.classList.remove('drawer');$$('.mm.open').forEach(function(o){o.classList.remove('open')})}
});
/* ---------- toast ---------- */
var toast=$('#toast'), toastT;
function say(msg){$('#toastMsg').textContent=msg;toast.classList.add('on');clearTimeout(toastT);toastT=setTimeout(function(){toast.classList.remove('on')},2600)}

/* ---------- forms ---------- */
$$('[data-nl]').forEach(function(f){
  f.addEventListener('submit',function(e){e.preventDefault();say('Welcome aboard — check your inbox ⚓');f.reset()});
});
var cform=$('[data-cform]');
if(cform)cform.addEventListener('submit',function(e){
  e.preventDefault();
  var btn=$('button[type=submit]',cform), old=btn.innerHTML;
  btn.innerHTML='Charting…'; btn.disabled=true;
  setTimeout(function(){btn.innerHTML='Brief received ✓';say('Thank you — a partner replies within one business day.');
    setTimeout(function(){btn.innerHTML=old;btn.disabled=false;cform.reset()},2400);
  },900);
});
$$('[data-apply]').forEach(function(b){
  b.addEventListener('click',function(){say('Application channel opened — CV optional, craft required.')});
});

/* ---------- FAQ search ---------- */
var fq=$('#faqQ');
if(fq)fq.addEventListener('input',function(){
  var q=fq.value.toLowerCase();
  $$('#faqList .acc').forEach(function(a){
    a.style.display=(!q||a.textContent.toLowerCase().indexOf(q)>-1||a.dataset.q.indexOf(q)>-1)?'':'none';
  });
});

/* ---------- cookie ---------- */
setTimeout(function(){ if(!localStorage.getItem('cv-ck')) $('#cookie').classList.add('on') },1800);
$('#ckY').addEventListener('click',function(){try{localStorage.setItem('cv-ck','y')}catch(e){} $('#cookie').classList.remove('on');say('Preferences saved.')});
$('#ckN').addEventListener('click',function(){try{localStorage.setItem('cv-ck','n')}catch(e){} $('#cookie').classList.remove('on')});

/* ---------- TOC scrollspy ----------
   Was a SECOND, un-throttled scroll listener doing a
   getElementById + getBoundingClientRect() per link on every scroll
   event (a second forced layout per event, on top of the main one).
   Now it rides the single batched frame loop off cached offsets and
   only touches the DOM when the active link actually changes.     */
function spyFrame(y){
  if(!tocCache.length) return;
  var line=y+innerH*.4, best=null;
  for(var i=0;i<tocCache.length;i++){
    var t=tocCache[i];
    if(t.el && t.top<=line) best=t.a;
  }
  if(best===tocLast) return;
  tocLast=best;
  for(var j=0;j<tocCache.length;j++) tocCache[j].a.classList.toggle('on', tocCache[j].a===best);
}

/* ---------- pager (demo) ---------- */
$$('.pager button').forEach(function(b){
  b.addEventListener('click',function(){
    if(b.textContent.match(/\d/)){b.parentElement.querySelectorAll('button').forEach(function(x){x.classList.remove('on')});b.classList.add('on');say('Page '+b.textContent+' — demo pagination')}
  });
});

/* ---------- closeAll helper ---------- */
function closeAll(){document.body.classList.remove('drawer');$$('.mm.open').forEach(function(o){o.classList.remove('open')})}
})();
