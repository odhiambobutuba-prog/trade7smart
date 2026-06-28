// ===== SERVICE WORKER REGISTRATION =====
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js')
      .then(reg=>console.log('✅ PWA ready'))
      .catch(err=>console.log('❌ PWA error:',err));
  });
}

// ===== STATE =====
const S={
  page:'home',ws:null,ready:false,auth:false,rec:false,hb:null,
  ticks:[],df:Array(10).fill(0),
  sym:'R_100',pid:null,pdata:null,
  sel:{c:'DIGITOVER',b:'0'},
  oid:null,odata:null,hist:[],
  cfg:{maxStake:10,token:'',sym:'R_100'},
  acc:{bal:0,cur:'USD',login:'',pl:0},
  last:null,rid:1,stake:1,
  auto:{on:false,arrows:0,need:3,dir:1,lvl:0,base:1,lad:[],buf:.91,busy:false,cd:false,c:'DIGITOVER',b:'1'},
  mode:'triple',modeActive:false,savedBots:[],
  mg:{on:false,resetOnWin:true,step:0,losses:0,sessionPL:0,lastContract:null,lastBarrier:null,paused:false},
  dbot:{loaded:null,running:false,stats:{totalStake:0,totalPayout:0,runs:0,won:0,lost:0,pl:0},transactions:[],journal:[],chartData:[]}
};
const SC={ticks:0,signals:0,trades:0,feed:[],lastSig:'—',confHistory:[],lastAnalysis:0,modeLastSig:{triple:'—',momentum:'—',smart:'—',sniper:'—'},modeSigCount:{triple:0,momentum:0,smart:0,sniper:0},cooldown:false};

// 5 volatility markets (1s only)
const VOLATILITY_1S = ['R_100','R_75','R_50','1HZ100V','1HZ75V'];

// ===== HELPERS =====
function save(){try{localStorage.setItem('t7s_cfg',JSON.stringify(S.cfg));localStorage.setItem('t7s_h',JSON.stringify(S.hist.slice(0,500)));localStorage.setItem('t7s_bots',JSON.stringify(S.savedBots));}catch(e){}}
function load(){try{const c=JSON.parse(localStorage.getItem('t7s_cfg'));if(c)Object.assign(S.cfg,c);const h=JSON.parse(localStorage.getItem('t7s_h')||'[]');if(Array.isArray(h))S.hist=h;const b=JSON.parse(localStorage.getItem('t7s_bots')||'[]');if(Array.isArray(b))S.savedBots=b;}catch(e){}}
function $(id){return document.getElementById(id);}
function fmt(n,d){d=d||2;return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function $f(n){return '$'+fmt(n);}
function toast(m,t,ms){t=t||'info';ms=ms||3000;const d=document.createElement('div');d.style.cssText='padding:10px 14px;border-radius:10px;background:rgba(13,18,25,.95);backdrop-filter:blur(20px);border:1px solid '+(t==='success'?'rgba(34,197,94,.4)':t==='error'?'rgba(239,68,68,.4)':'rgba(59,130,246,.4)')+';display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;animation:sl .4s';d.innerHTML='<span>'+(t==='success'?'✓':t==='error'?'✕':'ⓘ')+'</span><span>'+m+'</span>';$('toasts').appendChild(d);setTimeout(function(){d.remove();},ms);}

// ===== BOOT =====
function runBoot(){
  try{
    if(sessionStorage.getItem('t7s_booted')){
      const boot=$('boot');if(boot)boot.style.display='none';
      document.body.style.overflow='';
      setTimeout(init,100);return;
    }
    const BG=['#22C55E','#8B5CF6','#22D3EE','#F59E0B','#22C55E','#3B82F6','#EC4899','#22C55E'];
    const STEPS=[['AI SCAN','Scanning market data...',20],['DATA STREAM','Processing live tick data...',45],['ANALYZING','AI is analyzing patterns...',70],['CALCULATING','Calculating probabilities...',85],['OPTIMIZING','Optimizing strategy model...',92],['CONNECTING','Connecting to market server...',96],['PREPARING INSIGHTS','Preparing AI insights...',99],['ALMOST READY','Almost ready...',100]];
    const ICONS={scan:'<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3"><circle cx="50" cy="50" r="35"/><path d="M50 15L50 85M15 50L85 50"/></svg>',brain:'<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3"><circle cx="50" cy="50" r="28"/><path d="M50 12L50 88M12 50L88 50"/></svg>',gear:'<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3"><circle cx="50" cy="50" r="18"/><path d="M50 10L50 22M10 50L22 50M22 22L30 30M70 70L78 78M22 78L30 70M70 30L78 22" stroke-width="4"/></svg>',globe:'<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3"><circle cx="50" cy="50" r="38"/><ellipse cx="50" cy="50" rx="16" ry="38"/></svg>',chart:'<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3"><path d="M15 85L85 85L85 15"/><path d="M25 70L40 55L55 65L70 35L82 45"/></svg>',ready:'<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4"><circle cx="50" cy="50" r="38"/><path d="M32 50L45 63L68 38"/></svg>',calc:'<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3"><rect x="25" y="20" width="50" height="60" rx="5"/><path d="M35 55L65 55M35 65L65 65M35 75L65 75"/></svg>',stream:'<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3"><path d="M10 50 Q25 20 40 50 T70 50 T100 50"/></svg>'};
    const bg=$('bootBg');if(bg){for(let i=0;i<20;i++){const s=document.createElement('div');s.style.cssText='position:absolute;width:2px;height:2px;background:#22D3EE;border-radius:50%;box-shadow:0 0 6px #22D3EE;left:'+Math.random()*100+'%;animation:bf 18s linear infinite;animation-delay:'+Math.random()*18+'s';bg.appendChild(s);}}
    const st=document.createElement('style');st.textContent='@keyframes bf{0%{transform:translateY(100vh);opacity:0}10%{opacity:1}90%{opacity:1}100%{transform:translateY(-100vh);opacity:0}}@keyframes bspin{to{transform:rotate(360deg)}}@keyframes bz{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}@keyframes brk{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}@keyframes sl{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}';document.head.appendChild(st);
    const content=$('bootContent');if(!content){document.body.style.overflow='';init();return;}
    const screens=[];STEPS.forEach(function(s,i){
      const div=document.createElement('div');div.style.cssText='display:none;color:'+BG[i]+';animation:bz .5s ease';
      const icons=[ICONS.scan,ICONS.stream,ICONS.brain,ICONS.calc,ICONS.gear,ICONS.globe,ICONS.chart,ICONS.ready];
      div.innerHTML='<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);font-size:10px;font-weight:700;margin-bottom:14px;font-family:monospace"><span style="font-size:14px;font-weight:800">'+(i+1)+'</span> '+s[0]+'</div><div style="width:120px;height:120px;margin:0 auto 12px;animation:bspin 3s linear infinite;color:'+BG[i]+'">'+icons[i]+'</div><div style="font-size:20px;font-weight:800;letter-spacing:.04em;margin-bottom:4px">'+s[0]+'</div><div style="font-size:11px;color:#5A6478;letter-spacing:.15em;margin-bottom:12px;text-transform:uppercase">Trade7Smart AI ANALYZER</div><div style="font-size:13px;color:#8B95A8;margin-bottom:14px">'+s[1]+'</div><div style="height:5px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden;margin-bottom:8px"><div id="bf'+i+'" style="height:100%;width:0%;background:'+BG[i]+';border-radius:99px;box-shadow:0 0 10px '+BG[i]+';transition:width .8s ease"></div></div><div id="bp'+i+'" style="font-size:18px;font-weight:700;font-family:monospace;color:'+BG[i]+'">0%</div>';
      content.appendChild(div);screens.push(div);
    });
    const fin=document.createElement('div');fin.id='bootFinal';fin.style.cssText='display:none;color:#22C55E';
    fin.innerHTML='<div style="font-size:56px;margin-bottom:12px;animation:brk 1.5s ease infinite">🚀</div><div style="font-size:22px;font-weight:800;margin-bottom:6px;background:linear-gradient(135deg,#fff,#22C55E);-webkit-background-clip:text;background-clip:text;color:transparent">Trade7Smart AI Ready</div><div style="font-size:13px;color:#8B95A8;margin-bottom:4px">Welcome to Trade7Smart AI Analyzer</div><div style="font-size:12px;color:#22D3EE;font-weight:600">Smart Data. Smarter Decisions.</div><div style="width:54px;height:54px;border-radius:50%;margin:12px auto 0;background:radial-gradient(circle,rgba(34,197,94,.3),transparent);display:flex;align-items:center;justify-content:center;font-size:28px;color:#22C55E;box-shadow:0 0 36px rgba(34,197,94,.5);animation:bz .5s ease">✓</div>';
    content.appendChild(fin);
    let idx=0;function next(){if(idx>=STEPS.length){screens.forEach(function(s){s.style.display='none';});fin.style.display='block';setTimeout(finish,1500);return;}
    screens.forEach(function(s){s.style.display='none';});screens[idx].style.display='block';
    setTimeout(function(){const f=$('bf'+idx),p=$('bp'+idx);if(f)f.style.width=STEPS[idx][2]+'%';if(p)p.textContent=STEPS[idx][2]+'%';},100);
    idx++;setTimeout(next,1000);}
    next();
    function finish(){sessionStorage.setItem('t7s_booted','1');const boot=$('boot');if(boot){boot.style.transition='opacity .8s';boot.style.opacity='0';setTimeout(function(){boot.style.display='none';document.body.style.overflow='';init();},800);}else{document.body.style.overflow='';init();}}
  }catch(e){console.error('Boot err:',e);const boot=$('boot');if(boot)boot.style.display='none';document.body.style.overflow='';init();}
}

// ===== NAVIGATION =====
function go(p){
  S.page=p;
  document.querySelectorAll('.page').forEach(function(x){x.style.display='none';});
  document.querySelectorAll('.nav').forEach(function(n){
    n.style.background='transparent';n.style.color='var(--td)';n.style.border='1px solid transparent';
    if(n.dataset.p===p){n.style.background='linear-gradient(135deg,rgba(59,130,246,.15),rgba(139,92,246,.1))';n.style.color='#fff';n.style.border='1px solid rgba(59,130,246,.25)';}
  });
  const bnav=document.getElementById('bnav');
  if(bnav){bnav.querySelectorAll('div[onclick^="go"]').forEach(function(b){b.style.color='var(--tm)';b.style.background='transparent';if(b.getAttribute('onclick')==='go(\''+p+'\')'){b.style.color='var(--bl)';b.style.background='rgba(59,130,246,.1)';}});}
  document.querySelector('main').scrollTop=0;
  $('p-'+p).style.display='block';
  if(p==='history')renderH();
  if(p==='home')renderHome();
  if(p==='modes')renderModes();
  if(p==='dbot')renderDBot();
}

// ===== DERIV WEBSOCKET =====
const WS='wss://ws.binaryws.com/websockets/v3?app_id=1089';
function conn(){
  if(S.ws){try{S.ws.close();}catch(e){}}
  S.ws=null;S.ready=false;S.auth=false;S.pid=null;S.pdata=null;updateConn('connecting');
  try{S.ws=new WebSocket(WS);}catch(e){recon();return;}
  S.ws.onopen=function(){
    S.ready=true;try{S.ws.send(JSON.stringify({forget_all:'all'}));}catch(e){}
    if(S.cfg.token&&S.cfg.token.length>5){send({authorize:S.cfg.token});}else{subTicks();updateConn('live');}
    hb();
    // Subscribe to all 5 volatility 1s markets
    VOLATILITY_1S.forEach(function(sym){
      send({ticks:sym,subscribe:1});
    });
  };
  S.ws.onmessage=function(e){try{handle(JSON.parse(e.data));}catch(err){}};
  S.ws.onerror=function(){};
  S.ws.onclose=function(){S.ready=false;S.auth=false;S.pid=null;updateConn('off');shb();recon();};
}
function recon(){if(S.rec)return;S.rec=true;setTimeout(function(){S.rec=false;conn();},4000);}
function hb(){shb();S.hb=setInterval(function(){if(S.ready){try{S.ws.send(JSON.stringify({ping:1}));}catch(e){}}},30000);}
function shb(){if(S.hb){clearInterval(S.hb);}S.hb=null;}
function send(o){if(!S.ready||!S.ws)return;o.req_id=S.rid++;try{S.ws.send(JSON.stringify(o));}catch(e){}}

function handle(d){
  if(d.msg_type==='ping'){send({pong:1});return;}
  if(d.error){
    const c=d.error.code||'';
    if(c==='InvalidToken'||c==='AuthorizationRequired'){S.auth=false;toast('Invalid token','error');}
    else if(c==='RateLimit'){/* silent */}
    else if(c==='MarketIsClosed'){/* silent */}
    else if(c==='ContractBuyPriceError'||c==='PriceMoved'){
      S.pid=null;S.pdata=null;
      setTimeout(function(){if(S.ready&&S.auth)reqProp();},800);
    } else if(!['AlreadySubscribed','ContractWon','ContractLost','InputValidationFailed'].includes(c)){
      toast(d.error.message||'Error','error',3000);
    }
    return;
  }
  if(d.msg_type==='authorize'){
    S.auth=true;S.acc.login=d.authorize.loginid;S.acc.cur=d.authorize.currency||'USD';
    subTicks();send({balance:1,subscribe:1});
    updateConn('live');toast('✓ '+d.authorize.loginid,'success');
  }
  if(d.msg_type==='balance'){
    S.acc.bal=Number(d.balance.balance);
    if(d.balance.currency)S.acc.cur=d.balance.currency;
    renderBal();
  }
  if(d.msg_type==='tick')onTick(d.tick);
  if(d.msg_type==='proposal'){S.pid=d.proposal.id;S.pdata=d.proposal;renderProp();}
  if(d.msg_type==='buy'){
    if(d.buy){
      toast('✓ Bought $'+d.buy.buy_price,'success');
      S.oid=d.buy.contract_id;S.odata=null;
      send({proposal_open_contract:1,contract_id:d.buy.contract_id,subscribe:1});
      renderMon();
    } else {
      toast('Buy failed','error');
      S.auto.busy=false;
    }
  }
  if(d.msg_type==='proposal_open_contract'){
    const c=d.proposal_open_contract;S.odata=c;
    const done=c.is_sold===1||c.status==='lost'||c.status==='won';
    if(done)settle(c);else renderMon();
  }
}

function settle(c){
  const prof=Number(c.profit);const buy=Number(c.buy_price);const pay=Number(c.payout||prof+buy);const w=prof>0;
  S.acc.pl+=prof;
  S.hist.unshift({
    time:c.date_start||Math.floor(Date.now()/1000),
    contract:c.contract_type+' '+c.barrier,
    stake:buy,payout:pay,profit:prof,win:w,
    mode:S.modeActive?S.mode:'manual'
  });
  if(S.hist.length>500)S.hist=S.hist.slice(0,500);
  save();renderH();renderHome();renderBal();
  // Martingale handler
  mgOnResult(w,prof);
  // Update DBot stats if running
  if(S.dbot&&S.dbot.running){
    S.dbot.stats.totalPayout+=pay;
    S.dbot.stats.pl+=prof;
    if(w){S.dbot.stats.won++;}else{S.dbot.stats.lost++;}
    updateDBotStats();
    if(S.dbot.transactions.length>0){
      S.dbot.transactions[0].result=w?'win':'loss';
      S.dbot.transactions[0].payout=pay;
      renderTransactions();
    }
    addJournalEntry((w?'✅ WIN':'❌ LOSS')+' '+(w?'+':'')+fmt(prof)+' · '+c.contract_type+' '+c.barrier,w?'success':'error');
  }
  if(S.modeActive){
    addFeedEntry((w?'✅ WIN':'❌ LOSS')+' '+(w?'+':'')+fmt(prof)+' · '+c.contract_type+' '+c.barrier+(S.mg.on&&S.mg.step>0?' [MG L'+S.mg.step+']':''),w?'success':'error');
  }
  setTimeout(function(){send({balance:1,subscribe:1});},500);
  showRes({contract:c.contract_type+' '+c.barrier,stake:buy,payout:pay,profit:prof,win:w});
  S.oid=null;S.odata=null;
  if(S.page==='modes')renderModes();
}

function updateConn(s){
  const d=$('cd'),t=$('ct'),h=$('hcd'),ht=$('hct');
  if(s==='live'){d.className='dot live';t.textContent=S.auth?'Connected':'Live';h.className='dot live';ht.textContent=S.auth?'Authorized':'Connected';$('hmkt').textContent='Open';$('sbWs').textContent='● Online';$('sbWs').className='ok';}
  else if(s==='connecting'){d.className='dot';t.textContent='Connecting';h.className='dot';ht.textContent='Connecting';$('hmkt').textContent='...';}
  else{d.className='dot';t.textContent='Offline';h.className='dot';ht.textContent='Offline';$('hmkt').textContent='Off';$('sbWs').textContent='● Off';$('sbWs').className='r';}
}
function subTicks(){
  if(!S.ready)return;
  send({forget_all:'ticks'});
  send({ticks_history:S.sym,adjust_start_time:1,count:100,end:'latest',start:1,style:'ticks'});
  send({ticks:S.sym,subscribe:1});
}

function onTick(t){
  const p=Number(t.quote);const pr=S.last;const dir=pr!==null?(p>pr?1:p<pr?-1:0):0;const ch=pr!==null?p-pr:0;const dig=parseInt(t.quote.toString().slice(-1),10);
  S.last=p;const sp=$('px');sp.textContent=fmt(p,4);sp.style.color=dir>0?'var(--g)':dir<0?'var(--r)':'#fff';
  S.ticks.unshift({p:p,dir:dir,ch:ch,dig:dig,time:t.epoch});
  if(S.ticks.length>200)S.ticks=S.ticks.slice(0,200);
  S.df[dig]++;
  renderHomeLive();autoChk();runMode();renderModesLive();
  updateDBotChart();
}

function renderBal(){const tx=S.auth?$f(S.acc.bal):'$—';$('bal').textContent=tx;$('hbal').textContent=tx;$('hacc').textContent=S.acc.login||'—';$('hpl').textContent=S.auth?(S.acc.pl>=0?'+':'')+$f(S.acc.pl):'$0.00';$('hpl').style.color=S.acc.pl>=0?'var(--g)':'var(--r)';}
function renderHome(){
  const t=S.hist.length;const w=S.hist.filter(function(h){return h.win;}).length;
  $('htc').textContent=t;$('hwr').textContent=t?Math.round(w/t*100)+'%':'0%';$('hwrs').textContent=t?w+'W/'+(t-w)+'L':'No trades';
  $('aiHome').textContent=S.modeActive?S.mode.toUpperCase():'READY';
  $('aiHome').style.color=S.modeActive?'var(--g)':'#fff';
  $('aiSub').textContent=S.modeActive?'Active':'Triple Strike';
  const rt=$('rTrades');
  if(t){rt.innerHTML=S.hist.slice(0,4).map(function(h){
    const dt=new Date((h.time||0)*1000);
    return '<div style="display:flex;justify-content:space-between;padding:6px;background:rgba(255,255,255,.02);border-radius:6px;border:1px solid var(--b);margin-bottom:4px"><div><div class="mono fz fw">'+h.contract+'</div><div style="font-size:10px;color:var(--tm)">'+dt.toLocaleTimeString()+'</div></div><span class="mono fw" style="color:'+(h.win?'var(--g)':'var(--r)')+'">'+(h.win?'+':'')+fmt(h.profit)+'</span></div>';
  }).join('');}else{rt.innerHTML='<div style="padding:24px;text-align:center;color:var(--tm);font-size:13px">No trades yet</div>';}
}
function renderHomeLive(){
  const d=S.ticks[0]?S.ticks[0].dig:undefined;
  if(d!==undefined){
    $('md').textContent=d;
    $('mp').textContent=S.last?fmt(S.last,4):'—';
    const s=S.last,p=S.ticks[1]?S.ticks[1].p:s;
    $('reg').textContent=s>p?'BEAR':s<p?'BULL':'—';
  }
}
function renderH(){
  const tb=$('hb'),em=$('he');
  if(!S.hist.length){tb.innerHTML='';em.style.display='block';return;}
  em.style.display='none';
  tb.innerHTML=S.hist.slice(0,100).map(function(h){
    const dt=new Date((h.time||0)*1000);
    return '<tr><td style="padding:8px;border-bottom:1px solid var(--b);font-family:monospace;color:var(--tm)">'+dt.toLocaleString()+'</td><td style="padding:8px;border-bottom:1px solid var(--b);font-family:monospace">'+h.contract+'</td><td style="padding:8px;border-bottom:1px solid var(--b);font-family:monospace">'+$f(h.stake)+'</td><td style="padding:8px;border-bottom:1px solid var(--b);font-family:monospace;color:'+(h.win?'var(--g)':'var(--r)')+';font-weight:700">'+(h.win?'+':'')+fmt(h.profit)+'</td></tr>';
  }).join('');
}

// ===== MODES — PRODUCTION ENGINE =====
let _confSmoothed=0;
let _confPrev=0;

function selMode(m){
  if(S.modeActive){
    S.modeActive=false;SC.cooldown=false;
    updateScannerUI();
    addFeedEntry('Mode switched to '+m.toUpperCase()+' — scanner stopped','dim');
  }
  S.mode=m;_confSmoothed=0;_confPrev=0;
  applyModeCardStyle();renderModes();
}
function applyModeCardStyle(){
  document.querySelectorAll('.mode-card').forEach(function(c){
    const isActive=c.dataset.mode===S.mode;
    c.style.background=isActive?'rgba(59,130,246,.1)':'rgba(255,255,255,.02)';
    c.style.border=isActive?'1px solid var(--bl)':'1px solid var(--b)';
  });
}

function renderModeStats(){
  ['triple','momentum','smart','sniper'].forEach(function(m){
    const el=$('stat-'+m);if(!el)return;
    const mh=S.hist.filter(function(h){return h.mode===m;});
    if(!mh.length){el.textContent='No trades';el.style.color='var(--td)';return;}
    const wr=Math.round(mh.filter(function(h){return h.win;}).length/mh.length*100);
    el.textContent=wr+'% ('+mh.length+'t)';
    el.style.color=wr>=60?'var(--g)':wr>=45?'var(--am)':'var(--r)';
  });
  ['triple','momentum','smart','sniper'].forEach(function(m){
    const el=$('msig-'+m);if(el)el.textContent='Last: '+(SC.modeLastSig[m]||'—');
  });
  ['triple','momentum','smart','sniper'].forEach(function(m){
    const el=$('mstat-'+m);if(!el)return;
    if(!S.modeActive||S.mode!==m){el.className='mstat waiting';el.textContent='IDLE';return;}
    if(SC.cooldown){el.className='mstat cooldown';el.textContent='COOLDOWN';return;}
    if(SC.signals>0&&SC.lastSig!=='—'){el.className='mstat signal';el.textContent='SIGNAL';}
    else{el.className='mstat scanning';el.textContent='SCANNING';}
  });
}

function renderModes(){
  renderModeStats();applyModeCardStyle();
  updateScannerUI();renderDigitChart();
  const mh=S.hist.filter(function(h){return h.mode===S.mode;});
  const allH=S.hist;
  const mwr=mh.length?Math.round(mh.filter(function(h){return h.win;}).length/mh.length*100):0;
  const mpl=mh.reduce(function(a,h){return a+h.profit;},0);
  const allWr=allH.length?Math.round(allH.filter(function(h){return h.win;}).length/allH.length*100):0;
  const avgConf=SC.confHistory.length?Math.round(SC.confHistory.reduce(function(a,b){return a+b;},0)/SC.confHistory.length):0;
  $('modePerf').innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(95px,1fr));gap:8px">'
    +'<div style="padding:10px;background:rgba(0,0,0,.3);border-radius:10px;border:1px solid var(--b)"><div style="font-size:9px;color:var(--tm);text-transform:uppercase;margin-bottom:3px">Mode</div><div style="font-size:13px;font-weight:700;font-family:monospace;color:var(--cy)">'+S.mode.toUpperCase()+'</div></div>'
    +'<div style="padding:10px;background:rgba(0,0,0,.3);border-radius:10px;border:1px solid var(--b)"><div style="font-size:9px;color:var(--tm);text-transform:uppercase;margin-bottom:3px">Trades</div><div class="scan-val" style="font-size:16px;font-weight:700;font-family:monospace">'+mh.length+'</div></div>'
    +'<div style="padding:10px;background:rgba(0,0,0,.3);border-radius:10px;border:1px solid var(--b)"><div style="font-size:9px;color:var(--tm);text-transform:uppercase;margin-bottom:3px">Win%</div><div class="scan-val" id="perf-wr" style="font-size:16px;font-weight:700;font-family:monospace;color:'+(mwr>=50?'var(--g)':'var(--r)')+'">'+mwr+'%</div></div>'
    +'<div style="padding:10px;background:rgba(0,0,0,.3);border-radius:10px;border:1px solid var(--b)"><div style="font-size:9px;color:var(--tm);text-transform:uppercase;margin-bottom:3px">P/L</div><div class="scan-val" id="perf-pl" style="font-size:16px;font-weight:700;font-family:monospace;color:'+(mpl>=0?'var(--g)':'var(--r)')+'">'+(mpl>=0?'+':'')+fmt(mpl)+'</div></div>'
    +'<div style="padding:10px;background:rgba(0,0,0,.3);border-radius:10px;border:1px solid var(--b)"><div style="font-size:9px;color:var(--tm);text-transform:uppercase;margin-bottom:3px">All Win%</div><div class="scan-val" style="font-size:16px;font-weight:700;font-family:monospace;color:'+(allWr>=50?'var(--g)':'var(--r)')+'">'+allWr+'%</div></div>'
    +'<div style="padding:10px;background:rgba(0,0,0,.3);border-radius:10px;border:1px solid var(--b)"><div style="font-size:9px;color:var(--tm);text-transform:uppercase;margin-bottom:3px">Signals</div><div class="scan-val" style="font-size:16px;font-weight:700;font-family:monospace;color:var(--am)">'+SC.signals+'</div></div>'
    +'<div style="padding:10px;background:rgba(0,0,0,.3);border-radius:10px;border:1px solid var(--b)"><div style="font-size:9px;color:var(--tm);text-transform:uppercase;margin-bottom:3px">Avg Conf</div><div class="scan-val" style="font-size:16px;font-weight:700;font-family:monospace;color:var(--bl)">'+avgConf+'%</div></div>'
    +'</div>';
}

function updateScannerUI(){
  const active=S.modeActive;
  const btn=$('modeBtn');if(!btn)return;
  if(active){btn.textContent='⏹ Stop Scanner';btn.className='btn red big btn-scanning';}
  else{btn.textContent='▶ ACTIVATE';btn.className='btn b1 big';}
  const badge=$('scanStatusBadge');if(badge){
    badge.textContent=active?'🟢 SCANNING':'⏸ IDLE';
    badge.style.color=active?'var(--g)':'var(--td)';
    badge.style.borderColor=active?'rgba(34,197,94,.4)':'var(--b)';
    badge.style.background=active?'rgba(34,197,94,.08)':'rgba(255,255,255,.04)';
  }
  const fs=$('feedStatus');if(fs){fs.textContent=active?'● STREAMING':'● IDLE';fs.style.color=active?'var(--r)':'var(--td)';}
  setElText('scanTickCount',SC.ticks.toLocaleString());
  setElText('scanOpCount',SC.signals);
  setElText('scanTradeCount',SC.trades);
  if($('scanLastSig'))$('scanLastSig').textContent=SC.lastSig;
  const avgConf=SC.confHistory.length?Math.round(SC.confHistory.reduce(function(a,b){return a+b;},0)/SC.confHistory.length):0;
  if($('scanAvgConf')){$('scanAvgConf').textContent=avgConf?avgConf+'%':'—';$('scanAvgConf').style.color=avgConf>=70?'var(--g)':avgConf>=45?'var(--am)':'var(--bl)';}
  const mh=S.hist.filter(function(h){return h.mode===S.mode;});
  if($('scanWinRate')){
    if(!mh.length){$('scanWinRate').textContent='—';}
    else{const wr=Math.round(mh.filter(function(h){return h.win;}).length/mh.length*100);$('scanWinRate').textContent=wr+'%';$('scanWinRate').style.color=wr>=50?'var(--g)':'var(--r)';}
  }
}

function setElText(id,val){
  const el=$(id);if(!el)return;
  const prev=el.textContent;const next=String(val);
  if(prev===next)return;
  el.textContent=next;
  const pn=parseFloat(prev),nn=parseFloat(next);
  if(!isNaN(pn)&&!isNaN(nn)&&nn!==pn){
    el.classList.remove('flash-g','flash-r');
    void el.offsetWidth;
    el.classList.add(nn>pn?'flash-g':'flash-r');
    setTimeout(function(){el.classList.remove('flash-g','flash-r');},700);
  }
}

function modeToggle(){
  const btn=$('modeBtn');
  if(!S.ready){
    if(btn){btn.style.transform='scale(.97)';setTimeout(function(){btn.style.transform='';},150);}
    toast('Not connected — WebSocket connecting…','error');return;
  }
  if(!S.auth){
    if(btn){btn.style.transform='scale(.97)';setTimeout(function(){btn.style.transform='';},150);}
    toast('Connect your Deriv account first','error');openConn();return;
  }
  if(S.auto.on){toast('Stop Auto-Trade on Trade page first','error');return;}
  if(S.modeActive){
    S.modeActive=false;SC.cooldown=false;
    updateScannerUI();renderModeStats();
    addFeedEntry('⏹ Scanner stopped · '+SC.ticks+' ticks · '+SC.signals+' signals','dim');
    showAiExplanation('Scanner stopped','You ran '+S.mode.toUpperCase()+' for '+SC.ticks+' ticks. '+SC.signals+' signals were detected, '+SC.trades+' trades executed.','');
    toast(S.mode.toUpperCase()+' stopped','info');
    return;
  }
  SC={ticks:0,signals:0,trades:0,feed:[],lastSig:'—',confHistory:[],lastAnalysis:0,modeLastSig:{triple:'—',momentum:'—',smart:'—',sniper:'—'},modeSigCount:{triple:0,momentum:0,smart:0,sniper:0},cooldown:false};
  S.mg.step=0;S.mg.losses=0;S.mg.sessionPL=0;S.mg.paused=false;
  S.mg.lastContract=null;S.mg.lastBarrier=null;
  _confSmoothed=0;_confPrev=0;
  S.modeActive=true;
  updateScannerUI();renderModeStats();mgUpdate();
  addFeedEntry('▶ '+S.mode.toUpperCase()+' scanner activated','success');
  addFeedEntry('Strategy: '+S.mode+' · 5 markets: '+VOLATILITY_1S.join(', '),'info');
  addFeedEntry('Martingale: '+(S.mg.on?'ON ×'+($('mgMult')?$('mgMult').value:'2.1'):'OFF')+' · Base: $'+fmt(getMgStake()),'info');
  showAiExplanation('Scanner Activated — '+S.mode.toUpperCase(),
    'Monitoring 5 volatility 1s markets: '+VOLATILITY_1S.join(', ')+'\n\nEvery Deriv tick is evaluated against the active pattern strategy. When conditions match, a live proposal is requested and executed via the Deriv WebSocket. Each trade is 1-tick duration.',
    'Awaiting live ticks…');
  toast(S.mode.toUpperCase()+' ACTIVATED','success');
}

function calcConfidence(){
  if(S.ticks.length<3)return 0;
  let raw=0;
  const h=S.ticks.slice(0,6);
  const d0=h[0].dig,d1=h[1]?h[1].dig:-1,d2=h[2]?h[2].dig:-1,d3=h[3]?h[3].dig:-1;
  if(d0===d1&&d1===d2&&d2===d3)raw+=65;
  else if(d0===d1&&d1===d2)raw+=50;
  else if(d0===d1||d1===d2)raw+=20;
  const ups=h.filter(function(t){return t.ch>0;}).length;
  const downs=h.filter(function(t){return t.ch<0;}).length;
  raw+=Math.round((Math.abs(ups-downs)/h.length)*30);
  const tot=S.df.reduce(function(a,b){return a+b;},0);
  if(tot>20){const maxD=Math.max.apply(null,S.df);raw+=maxD/tot>0.18?12:0;}
  if(S.mode==='triple'&&d0===d1&&d1===d2)raw=Math.min(raw+15,100);
  if(S.mode==='sniper')raw=Math.max(raw,30);
  if(S.mode==='momentum'&&(ups>=4||downs>=4))raw=Math.min(raw+20,100);
  raw=Math.min(raw,100);
  _confPrev=_confSmoothed;
  _confSmoothed=_confSmoothed*0.65+raw*0.35;
  return _confSmoothed;
}
function getConfTrend(){
  const diff=_confSmoothed-_confPrev;
  if(diff>2)return{label:'↑ RISING',color:'var(--g)'};
  if(diff<-2)return{label:'↓ FALLING',color:'var(--r)'};
  return{label:'→ STABLE',color:'var(--td)'};
}
function getRecommendation(pct){
  if(pct>=75)return{label:'ENTRY',color:'var(--g)',bg:'rgba(34,197,94,.15)',border:'rgba(34,197,94,.4)'};
  if(pct>=50)return{label:'WATCH',color:'var(--am)',bg:'rgba(245,158,11,.1)',border:'rgba(245,158,11,.3)'};
  return{label:'WAIT',color:'var(--td)',bg:'rgba(255,255,255,.04)',border:'var(--b)'};
}
function getCurrentPattern(){
  if(S.ticks.length<3)return '—';
  const d=S.ticks.slice(0,5).map(function(t){return t.dig;});
  const dirs=S.ticks.slice(0,5).map(function(t){return t.ch>0?'↑':t.ch<0?'↓':'·';});
  return d.join(' ')+' | '+dirs.join('');
}

function renderConfidenceGauge(pct){
  const arc=$('confArc');if(!arc)return;
  const offset=314-(pct/100*314);
  arc.style.strokeDashoffset=offset;
  const clr=pct>=70?'var(--g)':pct>=45?'var(--am)':'var(--bl)';
  arc.style.stroke=clr;
  if($('confVal')){$('confVal').textContent=Math.round(pct)+'%';$('confVal').style.color=pct>=70?'var(--g)':pct>=45?'var(--am)':'#fff';}
  const strength=pct>=75?'Strong':pct>=50?'Moderate':pct>=25?'Weak':'Scanning…';
  const strengthClr=pct>=75?'var(--g)':pct>=50?'var(--am)':pct>=25?'var(--bl)':'var(--td)';
  if($('confStrength')){$('confStrength').textContent=strength;$('confStrength').style.color=strengthClr;}
  const trend=getConfTrend();
  if($('confTrend')){$('confTrend').textContent=trend.label;$('confTrend').style.color=trend.color;$('confTrend').style.borderColor=trend.color;}
  const rec=getRecommendation(pct);
  if($('confRec')){
    $('confRec').textContent=rec.label;
    $('confRec').style.color=rec.color;
    $('confRec').style.background=rec.bg;
    $('confRec').style.border='1px solid '+rec.border;
  }
  if($('confPattern'))$('confPattern').textContent=getCurrentPattern();
  if(S.modeActive&&pct>0){SC.confHistory.push(Math.round(pct));if(SC.confHistory.length>200)SC.confHistory.shift();}
}

function renderDigitChart(){
  const el=$('digitChart');if(!el)return;
  const recent=S.ticks.slice(0,100);
  const df=Array(10).fill(0);
  recent.forEach(function(t){df[t.dig]++;});
  const tot=recent.length;
  if($('dfTotal'))$('dfTotal').textContent=tot;
  if(tot===0){el.innerHTML='<div style="font-size:10px;color:var(--td)">Waiting for ticks…</div>';return;}
  const maxV=Math.max.apply(null,df)||1;
  const domIdx=df.indexOf(maxV);
  const hotIdx=S.ticks.length>=3&&S.ticks[0].dig===S.ticks[1].dig?S.ticks[0].dig:-1;
  if($('dfDominant'))$('dfDominant').textContent=domIdx;
  if($('dfHot'))$('dfHot').textContent=hotIdx>=0?hotIdx:'—';
  const bars=el.querySelectorAll('.dbar-wrap');
  if(bars.length===10){
    df.forEach(function(v,i){
      const h=Math.max(4,Math.round((v/maxV)*74));
      const pct=Math.round(v/tot*100);
      const isDom=i===domIdx,isHot=i===hotIdx;
      const clr=isHot?'var(--cy)':isDom?'var(--am)':'rgba(59,130,246,.55)';
      const bar=bars[i].querySelector('.dbar');
      if(bar){bar.style.height=h+'px';bar.style.background=clr;}
      const pctEl=bars[i].querySelector('.dbar-pct');
      if(pctEl)pctEl.textContent=pct+'%';
    });
  } else {
    el.innerHTML=df.map(function(v,i){
      const h=Math.max(4,Math.round((v/maxV)*74));
      const pct=Math.round(v/tot*100);
      const isDom=i===domIdx,isHot=i===hotIdx;
      const clr=isHot?'var(--cy)':isDom?'var(--am)':'rgba(59,130,246,.55)';
      return '<div class="dbar-wrap" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px" title="Digit '+i+': '+v+' / '+pct+'%">'
        +'<div class="dbar-pct" style="font-size:8px;color:var(--tm)">'+pct+'%</div>'
        +'<div class="dbar" style="width:100%;background:'+clr+';border-radius:3px 3px 0 0;height:'+h+'px"></div>'
        +'</div>';
    }).join('');
  }
}

function addFeedEntry(msg,type){
  const ts=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  SC.feed.unshift({msg:msg,type:type||'info',time:ts});
  if(SC.feed.length>50)SC.feed.pop();
  if(S.page==='modes')renderAiFeed();
}
function clearFeed(){SC.feed=[];renderAiFeed();}
function renderAiFeed(){
  const el=$('aiFeed');if(!el)return;
  if(!SC.feed.length){el.innerHTML='<div style="font-size:11px;color:var(--td);text-align:center;padding:20px 0">Activate scanner to begin streaming</div>';return;}
  el.innerHTML=SC.feed.slice(0,30).map(function(f,i){
    const clr=f.type==='success'?'var(--g)':f.type==='error'?'var(--r)':f.type==='signal'?'var(--am)':f.type==='dim'?'var(--tm)':'var(--cy)';
    return '<div class="feed-row '+f.type+'" style="'+(i===0?'background:rgba(255,255,255,.04);':'')+'">'
      +'<span style="font-family:monospace;font-size:10px;color:'+clr+';line-height:1.4">'+f.msg+'</span>'
      +'<span style="font-size:9px;color:var(--tm);flex-shrink:0;font-family:monospace">'+f.time+'</span>'
      +'</div>';
  }).join('');
  el.scrollTop=0;
}

function showAiExplanation(title,body,footer){
  const panel=$('aiExplain');const bdy=$('aiExplainBody');if(!panel||!bdy)return;
  const lines=body.split('\n');
  bdy.innerHTML='<div style="font-weight:700;color:var(--am);margin-bottom:6px">'+title+'</div>'
    +lines.map(function(l){return l?'<div style="margin-bottom:4px;padding-left:8px;border-left:2px solid rgba(245,158,11,.3)">'+l+'</div>':''}).join('')
    +(footer?'<div style="margin-top:8px;font-size:10px;color:var(--td)">'+footer+'</div>':'');
  panel.style.display='block';
}

function showHighConfAlert(mode,contract,conf,reason){
  const existing=document.querySelector('.hconf-alert');if(existing)existing.remove();
  const d=document.createElement('div');d.className='hconf-alert';
  d.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    +'<div style="font-size:10px;font-weight:800;color:var(--am);text-transform:uppercase;letter-spacing:.08em">⚡ High Confidence Signal</div>'
    +'<button onclick="this.parentNode.parentNode.remove()" style="background:none;border:none;color:var(--td);font-size:16px;cursor:pointer;line-height:1">×</button></div>'
    +'<div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:4px">'+contract+'</div>'
    +'<div style="font-size:11px;color:var(--td);margin-bottom:6px">'+reason+'</div>'
    +'<div style="display:flex;gap:6px">'
    +'<div style="padding:3px 10px;border-radius:99px;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.4);font-size:10px;font-weight:700;color:var(--am)">'+mode.toUpperCase()+'</div>'
    +'<div style="padding:3px 10px;border-radius:99px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.4);font-size:10px;font-weight:700;color:var(--g)">'+Math.round(conf)+'% CONF</div>'
    +'</div>';
  document.body.appendChild(d);
  setTimeout(function(){if(d.parentNode){d.style.transition='opacity .5s';d.style.opacity='0';setTimeout(function(){d.remove();},500);}},6000);
}

function buildFeedAnalysis(){
  if(S.ticks.length<3)return;
  const h=S.ticks.slice(0,5);
  const d=h.map(function(t){return t.dig;});
  const dirs=h.map(function(t){return t.ch>0?'UP':t.ch<0?'DN':'--';});
  const ups=dirs.filter(function(x){return x==='UP';}).length;
  const downs=dirs.filter(function(x){return x==='DN';}).length;
  const streak=1;for(let i=1;i<d.length;i++){if(d[i]===d[0])streak++;else break;}
  const msgs=[];
  if(streak>=3)msgs.push('🔴 Digit '+d[0]+' repeated '+streak+'× — pattern forming');
  else if(streak===2)msgs.push('👀 Digit '+d[0]+' appeared twice — watching');
  if(ups>=3)msgs.push('📈 '+ups+'/5 ticks bullish — momentum detected');
  else if(downs>=3)msgs.push('📉 '+downs+'/5 ticks bearish — downward pressure');
  if(msgs.length===0&&SC.ticks%5===0)msgs.push('📡 Tick '+SC.ticks+' · Digit: '+d[0]+' · Price: '+fmt(S.last,4));
  msgs.forEach(function(m){addFeedEntry(m,'info');});
}

function renderModesLive(){
  if(S.modeActive)SC.ticks++;
  const conf=calcConfidence();
  if(S.page==='modes'){
    renderConfidenceGauge(conf);
    renderDigitChart();
    updateScannerUI();
    if(S.modeActive){
      buildFeedAnalysis();
      renderModeStats();
    }
  }
}

// ===== runMode — USES CURRENTLY SELECTED CONTRACT (fixes OVER 1 / UNDER 9 bug) =====
function runMode(){
  if(!S.modeActive||!S.auth||S.ticks.length<3)return;
  if(SC.cooldown)return;
  if(S.oid||S.auto.busy)return;
  let fired=false;let reason='';let contract='';
  if(S.mode==='triple'){
    const h=S.ticks.slice(0,3).map(function(t){return t.dig;});
    if(h[0]===h[1]&&h[1]===h[2]){
      const dig=h[0];
      // Use correct contract mapping
      if(dig===0){S.sel.c='DIGITOVER';S.sel.b='0';contract='OVER 0';reason='Digits 0,0,0 — triple 0, stat edge OVER 0';fired=true;}
      else if(dig===1){S.sel.c='DIGITOVER';S.sel.b='1';contract='OVER 1';reason='Digits 1,1,1 — triple 1, stat edge OVER 1';fired=true;}
      else if(dig===9){S.sel.c='DIGITUNDER';S.sel.b='9';contract='UNDER 9';reason='Digits 9,9,9 — triple 9, stat edge UNDER 9';fired=true;}
      else if(dig===8){S.sel.c='DIGITUNDER';S.sel.b='8';contract='UNDER 8';reason='Digits 8,8,8 — triple 8, stat edge UNDER 8';fired=true;}
      else if(dig>=5){S.sel.c='DIGITUNDER';S.sel.b='9';contract='UNDER 9';reason='Digits '+dig+','+dig+','+dig+' — high digit, UNDER 9';fired=true;}
      else{S.sel.c='DIGITOVER';S.sel.b='1';contract='OVER 1';reason='Digits '+dig+','+dig+','+dig+' — mid digit, OVER 1';fired=true;}
    }
  }
  else if(S.mode==='momentum'){
    const tk=S.ticks.slice(0,5);
    const ups=tk.filter(function(t){return t.ch>0;}).length;
    const downs=tk.filter(function(t){return t.ch<0;}).length;
    if(ups>=3){
      S.sel.c='DIGITOVER';S.sel.b='1';
      contract='OVER 1';reason=ups+'/5 ticks bullish — momentum OVER 1';
      fired=true;
    } else if(downs>=3){
      S.sel.c='DIGITUNDER';S.sel.b='9';
      contract='UNDER 9';reason=downs+'/5 ticks bearish — momentum UNDER 9';
      fired=true;
    }
  }
  else if(S.mode==='smart'){
    const tk=S.ticks.slice(0,4);
    const pat=tk.slice(0,3).map(function(t){return t.dig;}).join(',');
    const ups=tk.slice(0,3).filter(function(t){return t.ch>0;}).length;
    const downs=tk.slice(0,3).filter(function(t){return t.ch<0;}).length;
    if(pat==='0,0,0'&&ups>=2){S.sel.c='DIGITOVER';S.sel.b='0';contract='OVER 0';reason='Pattern 0,0,0 + '+ups+'/3 bullish — OVER 0';fired=true;}
    else if(pat==='1,1,1'&&ups>=2){S.sel.c='DIGITOVER';S.sel.b='1';contract='OVER 1';reason='Pattern 1,1,1 + '+ups+'/3 bullish — OVER 1';fired=true;}
    else if(pat==='9,9,9'&&downs>=2){S.sel.c='DIGITUNDER';S.sel.b='9';contract='UNDER 9';reason='Pattern 9,9,9 + '+downs+'/3 bearish — UNDER 9';fired=true;}
    else if(pat==='8,8,8'&&downs>=2){S.sel.c='DIGITUNDER';S.sel.b='8';contract='UNDER 8';reason='Pattern 8,8,8 + '+downs+'/3 bearish — UNDER 8';fired=true;}
  }
  else if(S.mode==='sniper'){
    if(SC.ticks>0&&SC.ticks%5===0){
      const tk=S.ticks.slice(0,6);
      const ups=tk.filter(function(t){return t.ch>0;}).length;
      const downs=tk.filter(function(t){return t.ch<0;}).length;
      if(ups>downs){
        S.sel.c='DIGITOVER';S.sel.b='1';
        contract='OVER 1';reason=ups+'/6 ticks bullish — OVER 1';
        fired=true;
      } else if(downs>ups){
        S.sel.c='DIGITUNDER';S.sel.b='9';
        contract='UNDER 9';reason=downs+'/6 ticks bearish — UNDER 9';
        fired=true;
      }
    }
  }
  if(fired){
    SC.signals++;
    SC.modeLastSig[S.mode]=contract+' @ '+fmt(S.last,4);
    SC.modeSigCount[S.mode]=(SC.modeSigCount[S.mode]||0)+1;
    SC.lastSig=contract+' @ '+fmt(S.last,4);
    const conf=Math.round(_confSmoothed);
    addFeedEntry('🎯 SIGNAL · '+contract+' · '+conf+'% conf','signal');
    addFeedEntry('↳ '+reason,'info');
    if(conf>=75)showHighConfAlert(S.mode,contract,conf,reason);
    showAiExplanation(
      'Signal Detected — '+contract,
      reason+'\n\nConfidence: '+conf+'% ('+getRecommendation(conf).label+')\nRecommendation: '+(conf>=75?'Execute trade':'Watch — conditions forming'),
      'Executing via Deriv API…'
    );
    SC.cooldown=true;
    setTimeout(function(){SC.cooldown=false;if(S.page==='modes')renderModeStats();},3000);
    executeMode(reason,contract);
  }
}

// ===== MARTINGALE — REAL RECOVERY WITH MIRROR CONTRACT =====
function getMgStake(){
  const base=parseFloat(($('mgBase')&&$('mgBase').value)||1)||1;
  const mult=parseFloat(($('mgMult')&&$('mgMult').value)||2.1)||2.1;
  const step=S.mg.step;
  if(step<=0)return base;
  let s=base;for(let i=0;i<step;i++)s=+(s*mult).toFixed(2);
  return s;
}
function getMgLadder(){
  const base=parseFloat(($('mgBase')&&$('mgBase').value)||1)||1;
  const mult=parseFloat(($('mgMult')&&$('mgMult').value)||2.1)||2.1;
  const steps=parseInt(($('mgMaxSteps')&&$('mgMaxSteps').value)||5)||5;
  const lad=[];let s=base;
  for(let i=0;i<=steps;i++){lad.push(+s.toFixed(2));s=+(s*mult).toFixed(2);}
  return lad;
}
function mgUpdate(){
  const lad=getMgLadder();
  const el=$('mgLadder');
  if(el){
    el.innerHTML=lad.map(function(v,i){
      const active=i===S.mg.step;
      return '<div style="padding:4px 10px;border-radius:8px;font-family:monospace;font-size:11px;font-weight:700;background:'+(active?'rgba(139,92,246,.2)':'rgba(0,0,0,.3)')+';border:1px solid '+(active?'rgba(139,92,246,.5)':'var(--b)')+';color:'+(active?'var(--pp)':'var(--td)')+'">L'+(i+1)+' · $'+fmt(v)+'</div>';
    }).join('');
  }
  if($('mgNextStake'))$('mgNextStake').textContent='$'+fmt(getMgStake());
  if($('mgStep'))$('mgStep').textContent=S.mg.step;
  if($('mgLosses'))$('mgLosses').textContent=S.mg.losses;
  const pl=S.mg.sessionPL;
  if($('mgSessionPL')){$('mgSessionPL').textContent=(pl>=0?'+':'')+$f(pl);$('mgSessionPL').style.color=pl>=0?'var(--g)':'var(--r)';}
}
function mgToggle(){
  S.mg.on=!S.mg.on;
  const wrap=$('mgToggleWrap'),knob=$('mgKnob'),badge=$('mgBadge');
  if(S.mg.on){
    if(wrap){wrap.style.background='rgba(139,92,246,.6)';wrap.style.borderColor='rgba(139,92,246,.5)';}
    if(knob)knob.style.left='20px';
    if(badge){badge.textContent='ON';badge.style.color='var(--pp)';badge.style.borderColor='rgba(139,92,246,.4)';badge.style.background='rgba(139,92,246,.1)';}
    toast('Martingale Recovery ON','success');
  } else {
    if(wrap){wrap.style.background='rgba(255,255,255,.08)';wrap.style.borderColor='var(--b)';}
    if(knob)knob.style.left='2px';
    if(badge){badge.textContent='OFF';badge.style.color='var(--td)';badge.style.borderColor='var(--b)';badge.style.background='rgba(255,255,255,.04)';}
    S.mg.step=0;S.mg.losses=0;S.mg.paused=false;
    mgUpdate();
    toast('Martingale Recovery OFF','info');
  }
}
function mgResetToggle(){
  S.mg.resetOnWin=!S.mg.resetOnWin;
  const wrap=$('mgResetWrap'),knob=$('mgResetKnob'),lbl=$('mgResetLabel');
  if(S.mg.resetOnWin){
    if(wrap){wrap.style.background='rgba(34,197,94,.5)';wrap.style.borderColor='rgba(34,197,94,.4)';}
    if(knob)knob.style.left='16px';
    if(lbl)lbl.textContent='ON';
  } else {
    if(wrap){wrap.style.background='rgba(255,255,255,.08)';wrap.style.borderColor='var(--b)';}
    if(knob)knob.style.left='2px';
    if(lbl)lbl.textContent='OFF';
  }
}
function mgOnResult(win,profit){
  if(!S.mg.on||!S.modeActive)return;
  S.mg.sessionPL=+(S.mg.sessionPL+profit).toFixed(2);
  const stopLoss=parseFloat(($('mgStopLoss')&&$('mgStopLoss').value)||0);
  const takeProfit=parseFloat(($('mgTakeProfit')&&$('mgTakeProfit').value)||0);
  if(takeProfit>0&&S.mg.sessionPL>=takeProfit){
    S.mg.paused=true;S.mg.step=0;S.mg.losses=0;
    addFeedEntry('🎯 Take Profit $'+fmt(takeProfit)+' reached · Scanner paused','success');
    if($('mgStatus'))$('mgStatus').textContent='TAKE PROFIT';
    toast('✅ Take Profit $'+fmt(takeProfit)+' reached!','success');
    S.modeActive=false;updateScannerUI();
    mgUpdate();return;
  }
  if(stopLoss>0&&S.mg.sessionPL<=-stopLoss){
    S.mg.paused=true;S.mg.step=0;S.mg.losses=0;
    addFeedEntry('🛑 Stop Loss $'+fmt(stopLoss)+' hit · Scanner paused','error');
    if($('mgStatus'))$('mgStatus').textContent='STOP LOSS';
    toast('🛑 Stop Loss $'+fmt(stopLoss)+' hit — scanner stopped','error');
    S.modeActive=false;updateScannerUI();
    mgUpdate();return;
  }
  const maxSteps=parseInt(($('mgMaxSteps')&&$('mgMaxSteps').value)||5);
  if(win){
    const wasRecovery=S.mg.step>0;
    if(S.mg.resetOnWin){S.mg.step=0;S.mg.losses=0;}
    if($('mgStatus'))$('mgStatus').textContent=wasRecovery?'Recovered ✓':'Win';
    addFeedEntry('✅ WIN'+(wasRecovery?' · Recovery complete':'')+(S.mg.resetOnWin?' · Reset to base':''),'success');
  } else {
    S.mg.losses++;
    if(S.mg.step<maxSteps){
      S.mg.step++;
      // MIRROR CONTRACT: if last was OVER, recover with UNDER (and vice versa)
      var newContract=S.sel.c;
      var newBarrier=S.sel.b;
      if(S.sel.c==='DIGITOVER'){
        // Switch to mirror: last OVER → next UNDER (use the higher barrier)
        newContract='DIGITUNDER';
        newBarrier=Number(S.sel.b)<=1?'9':'8';
        addFeedEntry('🔄 MIRROR RECOVERY: switching '+S.sel.c+' '+S.sel.b+' → '+newContract+' '+newBarrier,'info');
      } else {
        newContract='DIGITOVER';
        newBarrier='1';
        addFeedEntry('🔄 MIRROR RECOVERY: switching '+S.sel.c+' '+S.sel.b+' → '+newContract+' '+newBarrier,'info');
      }
      S.mg.lastContract=newContract;
      S.mg.lastBarrier=newBarrier;
      const next=getMgStake();
      addFeedEntry('❌ LOSS · Step '+S.mg.step+'/'+maxSteps+' · Next stake $'+fmt(next),'error');
      if($('mgStatus'))$('mgStatus').textContent='Recovery L'+S.mg.step;
    } else {
      S.mg.step=0;S.mg.losses=0;
      addFeedEntry('⚠ Max steps reached · Resetting to base','dim');
      if($('mgStatus'))$('mgStatus').textContent='Reset (max steps)';
      toast('Martingale max steps reached — resetting','info');
    }
  }
  mgUpdate();
}

// executeMode — uses S.sel which runMode set (so contract is CORRECT)
function executeMode(reason,contract){
  if(S.oid||S.auto.busy)return;
  if(S.mg.paused){addFeedEntry('⏸ Recovery paused (TP/SL hit)','dim');return;}
  S.auto.busy=true;
  let stake;
  if(S.mg.on){
    stake=getMgStake();
  } else {
    stake=parseFloat(($('stake')&&$('stake').value)||1)||1;
  }
  stake=+stake.toFixed(2);
  if(stake>S.cfg.maxStake){
    addFeedEntry('⚠ Stake $'+fmt(stake)+' exceeds max $'+S.cfg.maxStake+' — skipped','error');
    S.auto.busy=false;return;
  }
  if(S.acc.bal>0&&stake>S.acc.bal){
    addFeedEntry('⚠ Insufficient balance $'+fmt(S.acc.bal)+' for stake $'+fmt(stake),'error');
    S.auto.busy=false;return;
  }
  S.mg.lastContract=S.sel.c;
  S.mg.lastBarrier=S.sel.b;
  document.querySelectorAll('.cbtn').forEach(function(b){
    b.style.outline='none';
    if(b.dataset.c===S.sel.c&&b.dataset.b===S.sel.b)b.style.outline='2px solid var(--bl)';
  });
  send({proposal:1,amount:String(stake),basis:'stake',contract_type:S.sel.c,
    currency:S.acc.cur,duration:1,duration_unit:'t',symbol:S.sym,barrier:String(S.sel.b)});
  setTimeout(function(){
    if(S.pid&&S.pdata){
      send({buy:S.pid,price:S.pdata.ask_price});
      SC.trades++;
      const stepTxt=S.mg.on&&S.mg.step>0?' [MG L'+S.mg.step+']':'';
      addFeedEntry('⚡ BUY'+stepTxt+' · 1 tick · '+S.sel.c.replace('DIGIT','')+' '+S.sel.b+' · $'+fmt(stake),'success');
      toast('⚡ '+(contract||S.sel.c+' '+S.sel.b)+' · $'+fmt(stake),'info');
      updateScannerUI();
    } else {
      addFeedEntry('⚠ Proposal not ready — skipped','dim');
    }
    S.auto.busy=false;
  },700);
}

// ===== AUTO-TRADE (LEGACY 3-ARROWS) =====
function buildL(){const l=[S.auto.base];let s=S.auto.base;for(let i=1;i<8;i++){const n=+(s*2.15/S.auto.buf).toFixed(2);l.push(n);s+=n;}return l;}
function autoChk(){if(!S.auto.on||S.auto.cd||S.auto.busy||S.ticks.length<2)return;const last=S.ticks[0];const ok=S.auto.dir===1?last.ch>0:last.ch<0;if(ok){S.auto.arrows++;aUpdate();if(S.auto.arrows>=S.auto.need){S.auto.arrows=0;autoBuy();}}else{S.auto.arrows=0;aUpdate();}}
function autoBuy(){
  if(!S.pid||!S.pdata){reqProp();setTimeout(autoBuy,800);return;}
  const st=S.auto.lad[Math.min(S.auto.lvl,S.auto.lad.length-1)];
  if(S.acc.bal>0&&st>S.acc.bal){toast('Low balance','error');autoStop();return;}
  // Use recovery contract if martingale active
  const contractType=S.mg.on&&S.mg.lastContract?S.mg.lastContract:S.auto.c;
  const barrier=S.mg.on&&S.mg.lastBarrier?S.mg.lastBarrier:S.auto.b;
  send({proposal:1,amount:String(st),basis:'stake',contract_type:contractType,currency:S.acc.cur,duration:1,duration_unit:'t',symbol:S.sym,barrier:String(barrier)});
  S.auto.busy=true;
  setTimeout(function(){
    if(S.pid){
      send({buy:S.pid,price:S.pdata.ask_price});
      toast('Auto L'+(S.auto.lvl+1)+' $'+st,'info');
      S.auto.lvl++;
    }
    $('alv').textContent=S.auto.lvl+1;
    $('astk').textContent=$f(S.auto.lad[Math.min(S.auto.lvl,S.auto.lad.length-1)]);
    aUpdate();
    S.auto.busy=false;
  },600);
}
function autoStart(){
  if(!S.auth){toast('Connect first','error');openConn();return;}
  if(S.auto.on){autoStop();return;}
  S.auto.on=true;
  S.auto.base=parseFloat($('stake').value)||1;
  S.auto.need=parseInt($('aa').value)||3;
  S.auto.buf=parseFloat($('ab').value)||0.91;
  S.auto.lad=buildL();
  S.auto.arrows=0;S.auto.lvl=0;
  aUpdate();
  toast('Auto ON','info');
}
function autoStop(){S.auto.on=false;S.auto.cd=false;aUpdate();toast('Auto OFF','info');}
function aUpdate(){
  const on=S.auto.on;
  $('aBtn').textContent=on?'⏹ STOP':'▶ SCAN';
  $('aBtn').classList.toggle('red',on);
  $('aBtn').classList.toggle('b1',!on);
  $('aStat').textContent=on?'Scanning':'Stopped';
  $('anow').textContent=S.auto.arrows+'/'+S.auto.need;
  document.querySelectorAll('.arr').forEach(function(a,i){
    if(on&&i<S.auto.arrows){a.style.background='linear-gradient(135deg,var(--bl),var(--cy))';a.style.color='#fff';a.style.borderColor='var(--bl)';}
    else{a.style.background='rgba(255,255,255,.04)';a.style.color='var(--td)';a.style.borderColor='var(--b)';}
  });
  $('alv').textContent=S.auto.lvl+1;
  $('astk').textContent=$f(S.auto.lad[Math.min(S.auto.lvl,S.auto.lad.length-1)]);
  $('lad').innerHTML=S.auto.lad.slice(0,5).map(function(s,i){
    return '<div style="display:flex;justify-content:space-between;padding:4px 8px;border-radius:5px;font-size:11px;background:'+(i===S.auto.lvl?'rgba(59,130,246,.15)':'rgba(255,255,255,.02)')+';border:1px solid '+(i===S.auto.lvl?'rgba(59,130,246,.4)':'var(--b)')+'"><span style="color:var(--td)">L'+(i+1)+'</span><span class="mono fw">'+$f(s)+'</span></div>';
  }).join('');
}

// ===== TRADE (manual buy) =====
let selEl=null;
function pick(el){
  if(selEl){selEl.style.outline='none';}
  el.style.outline='2px solid var(--bl)';el.style.outlineOffset='2px';
  selEl=el;
  S.sel.c=el.dataset.c;
  S.sel.b=el.dataset.b;
  reqProp();
}
function reqProp(){
  if(!S.ready){toast('Not connected','error');return;}
  if(!S.auth){toast('Authorize first','error');openConn();return;}
  const st=parseFloat($('stake').value)||1;
  if(st>S.cfg.maxStake){toast('Max $'+S.cfg.maxStake,'error');return;}
  if(S.acc.bal>0&&st>S.acc.bal){toast('Insufficient','error');return;}
  S.stake=st;
  $('pst').textContent='Fetching...';
  $('buyBtn').disabled=true;
  $('pc').textContent=S.sel.c+' '+S.sel.b;
  $('pb').textContent=S.sel.b;
  $('ps').textContent=$f(st);
  send({proposal:1,amount:String(st),basis:'stake',contract_type:S.sel.c,
    currency:S.acc.cur,duration:1,duration_unit:'t',symbol:S.sym,barrier:String(S.sel.b)});
}
function renderProp(){
  if(!S.pdata)return;
  const p=S.pdata;
  const st=Number(p.ask_price||S.stake);
  const po=Number(p.payout||0);
  const pr=po-st;
  $('pc').textContent=S.sel.c+' '+S.sel.b;
  $('ps').textContent=$f(st);
  $('ppo').textContent=$f(po);
  $('ppr').textContent=(pr>=0?'+':'')+$f(pr);
  $('ppr').style.color=pr>=0?'var(--g)':'var(--r)';
  $('pst').textContent=S.auth?'Ready':'Authorize';
  $('buyBtn').disabled=!S.auth;
}
function buy(){
  if(!S.pid||!S.auth)return;
  $('buyBtn').disabled=true;$('buyBtn').textContent='...';
  send({buy:S.pid,price:S.pdata.ask_price});
  setTimeout(function(){$('buyBtn').textContent='⚡ BUY';$('buyBtn').disabled=false;},2000);
}
function renderMon(){
  const sl=$('omon');
  if(!S.odata||!S.oid){sl.innerHTML='';return;}
  const c=S.odata;
  const cur=c.current_spot_display?Number(c.current_spot_display):(c.current_spot||0);
  const en=c.entry_tick_display?Number(c.entry_tick_display):(c.entry_tick||0);
  const cd=cur?parseInt(cur.toString().slice(-1),10):0;
  const ed=en?parseInt(en.toString().slice(-1),10):0;
  const buy=Number(c.buy_price);
  const cv=Number(c.bid_price!==undefined?c.bid_price:buy);
  const pr=cv-buy;
  const wc=c.status==='won'?'up':c.status==='lost'?'down':(pr>0?'up':'down');
  sl.innerHTML='<div class="glass" style="padding:18px;text-align:center;max-width:480px;margin:0 auto"><span class="live">● LIVE</span><div style="font-size:11px;color:var(--td);margin-top:8px">'+c.contract_type+' '+c.barrier+'</div><div style="font-size:clamp(50px,10vw,80px);font-weight:800;font-family:monospace;line-height:1;margin:6px 0;color:'+(wc==='up'?'var(--g)':'var(--r)')+'">'+cd+'</div><div style="font-family:monospace;font-size:11px;color:var(--td)">Entry: '+ed+'</div></div>';
}
function showRes(e){
  $('omon').innerHTML='<div class="glass" style="padding:24px;text-align:center;max-width:400px;margin:0 auto;border-radius:20px"><div style="width:70px;height:70px;border-radius:50%;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800;background:radial-gradient(circle,rgba('+(e.win?'34,197,94':'239,68,68')+',.3),transparent);color:'+(e.win?'var(--g)':'var(--r)')+'">'+(e.win?'✓':'✕')+'</div><h2 style="color:'+(e.win?'var(--g)':'var(--r)')+'">'+(e.win?'PROFIT':'LOSS')+'</h2><div style="font-size:30px;font-weight:800;font-family:monospace;margin:6px 0">'+(e.win?'+':'')+fmt(e.profit)+'</div><div style="font-family:monospace;font-size:11px;color:var(--td)">'+e.contract+'</div><button class="btn big" onclick="$(\'omon\').innerHTML=\'\'" style="width:100%;margin-top:14px">Continue</button></div>';
}

// ===== DBOT =====
window.openImportModal=function(){$('dbotImportModal').style.display='flex';};
window.closeImportModal=function(){$('dbotImportModal').style.display='none';};
window.editBotXml=function(){
  if(!S.dbot.loaded){toast('No bot loaded','error');return;}
  $('botXml').value=S.dbot.loaded.xml;
  openImportModal();
};
window.switchDBotTab=function(tab){
  document.querySelectorAll('.dbot-tab').forEach(function(t){t.classList.remove('active');if(t.dataset.tab===tab)t.classList.add('active');});
  document.querySelectorAll('.dbot-tab-panel').forEach(function(p){p.classList.remove('active');if('tab-'+tab===p.id)p.classList.add('active');});
};
window.loadBotFile=function(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=function(ev){$('botXml').value=ev.target.result;};
  r.readAsText(f);
};

function parseBot(){
  const xml=$('botXml').value.trim();
  if(!xml){toast('Paste XML first','error');return;}
  const blocks=[];
  const blockRegex=/<block\s+type="([^"]+)"[^>]*>([\s\S]*?)<\/block>/g;
  let match;
  while((match=blockRegex.exec(xml))!==null){
    const type=match[1];
    const content=match[2];
    const params={};
    const fieldRegex=/<field\s+name="([^"]+)"[^>]*>([^<]*)<\/field>/g;
    let fm;
    while((fm=fieldRegex.exec(content))!==null){
      params[fm[1].toLowerCase()]=fm[2];
    }
    blocks.push({type:type, params:params, id:Date.now()+Math.random()});
  }
  if(blocks.length===0){toast('No blocks found','error');return;}
  const name=prompt('Save bot as:','Bot1');
  if(!name)return;
  S.dbot.loaded={name:name, xml:xml, blocks:blocks};
  S.dbot.stats={totalStake:0,totalPayout:0,runs:0,won:0,lost:0,pl:0};
  S.dbot.transactions=[];
  S.dbot.journal=[];
  S.savedBots=S.savedBots.filter(function(b){return b.name!==name;});
  S.savedBots.push({name:name, xml:xml, time:Date.now()});
  save();
  closeImportModal();
  $('loadedBotName').textContent=name;
  $('botNameOverlay').style.display='block';
  $('editBtn').style.display='inline-flex';
  $('dbotEmptyState').style.display='none';
  $('dbotSummaryStats').style.display='block';
  updateDBotStats();
  initDBotChart();
  addJournalEntry('Bot loaded: '+name+' with '+blocks.length+' blocks','info');
  toast('Bot loaded successfully','success');
}

window.toggleDBotRun=function(){
  if(!S.auth){toast('Connect first','error');openConn();return;}
  if(!S.dbot.loaded){toast('Import a bot first','error');openImportModal();return;}
  if(S.dbot.running){stopDBot();}else{startDBot();}
};

function startDBot(){
  S.dbot.running=true;
  S.dbot.stats.runs++;
  $('dbotRunBtn').textContent='⏹ Stop';
  $('dbotRunBtn').classList.add('btn-running');
  $('dbotRunBtn').classList.remove('b1');
  $('dbotStatus').textContent='Bot is running';
  $('dbotStatus').style.color='var(--g)';
  addJournalEntry('▶ Bot started','success');
  executeDBotBlocks();
}

function stopDBot(){
  S.dbot.running=false;
  $('dbotRunBtn').textContent='▶ Run';
  $('dbotRunBtn').classList.remove('btn-running');
  $('dbotRunBtn').classList.add('b1');
  $('dbotStatus').textContent='Bot is not running';
  $('dbotStatus').style.color='var(--td)';
  addJournalEntry('⏹ Bot stopped','dim');
}

function executeDBotBlocks(){
  if(!S.dbot.running||!S.dbot.loaded)return;
  const blocks=S.dbot.loaded.blocks;
  let idx=0;
  function nextBlock(){
    if(!S.dbot.running)return;
    if(idx>=blocks.length){
      addJournalEntry('✓ All blocks executed','success');
      stopDBot();
      return;
    }
    const b=blocks[idx];
    addJournalEntry('Executing block '+(idx+1)+': '+b.type,'info');
    if(b.type==='purchase'){
      executePurchase(b.params,function(){
        idx++;
        setTimeout(nextBlock,500);
      });
    } else {
      idx++;
      setTimeout(nextBlock,200);
    }
  }
  nextBlock();
}

function executePurchase(params,callback){
  // Parse contract correctly
  let contractType='DIGITUNDER'; // default safer
  let barrier='9';
  const ct=(params.contract_type||'').toUpperCase();
  if(ct==='CALL'||ct==='OVER'||ct==='DIGITOVER'||ct==='UP'){
    contractType='DIGITOVER';
    barrier=params.barrier||'1';
  } else if(ct==='PUT'||ct==='UNDER'||ct==='DIGITUNDER'||ct==='DOWN'){
    contractType='DIGITUNDER';
    barrier=params.barrier||'9';
  }
  const stake=parseFloat(params.amount||params.stake||1);
  const symbol=params.symbol||S.sym;
  if(stake>S.cfg.maxStake){
    addJournalEntry('⚠ Stake exceeds max','error');
    callback();
    return;
  }
  if(S.acc.bal>0&&stake>S.acc.bal){
    addJournalEntry('⚠ Insufficient balance','error');
    callback();
    return;
  }
  S.sel.c=contractType;
  S.sel.b=String(barrier);
  addTransaction(contractType.replace('DIGIT','')+' '+barrier,stake,'pending');
  send({proposal:1,amount:String(stake),basis:'stake',contract_type:contractType,
    currency:S.acc.cur,duration:1,duration_unit:'t',symbol:symbol,barrier:String(barrier)});
  setTimeout(function(){
    if(S.pid&&S.pdata){
      send({buy:S.pid,price:S.pdata.ask_price});
      S.dbot.stats.totalStake+=stake;
      addJournalEntry('✓ Bought '+contractType.replace('DIGIT','')+' '+barrier+' for $'+fmt(stake)+' on '+symbol,'success');
    } else {
      addJournalEntry('⚠ Proposal failed','error');
    }
    callback();
  },800);
}

function updateDBotStats(){
  $('dbotTotalStake').textContent=$f(S.dbot.stats.totalStake);
  $('dbotTotalPayout').textContent=$f(S.dbot.stats.totalPayout);
  $('dbotRuns').textContent=S.dbot.stats.runs;
  $('dbotLost').textContent=S.dbot.stats.lost;
  $('dbotWon').textContent=S.dbot.stats.won;
  const pl=S.dbot.stats.pl;
  $('dbotPL').textContent=(pl>=0?'+':'')+$f(pl);
  $('dbotPL').style.color=pl>=0?'var(--g)':'var(--r)';
}

function addTransaction(contract,stake,result){
  const tx={time:new Date().toLocaleTimeString(),contract:contract,stake:stake,result:result,payout:0};
  S.dbot.transactions.unshift(tx);
  if(S.dbot.transactions.length>50)S.dbot.transactions.pop();
  renderTransactions();
}
function renderTransactions(){
  const el=$('dbotTransactions');if(!el)return;
  if(S.dbot.transactions.length===0){
    el.innerHTML='<div style="text-align:center;padding:30px;color:var(--td);font-size:11px">No transactions yet</div>';
    return;
  }
  el.innerHTML=S.dbot.transactions.map(function(tx){
    const cls=tx.result==='win'?'win':tx.result==='loss'?'loss':'';
    return '<div class="tx-row '+cls+'"><div><div class="mono fw" style="font-size:11px">'+tx.contract+'</div><div style="font-size:9px;color:var(--tm)">'+tx.time+'</div></div><div class="mono fw" style="font-size:11px">$'+fmt(tx.stake)+'</div></div>';
  }).join('');
}
function addJournalEntry(msg,type){
  const entry={time:new Date().toLocaleTimeString(),msg:msg,type:type};
  S.dbot.journal.unshift(entry);
  if(S.dbot.journal.length>100)S.dbot.journal.pop();
  renderJournal();
}
function renderJournal(){
  const el=$('dbotJournal');if(!el)return;
  if(S.dbot.journal.length===0){
    el.innerHTML='<div style="text-align:center;padding:30px;color:var(--td);font-size:11px">No journal entries</div>';
    return;
  }
  el.innerHTML=S.dbot.journal.map(function(j){
    const clr=j.type==='success'?'var(--g)':j.type==='error'?'var(--r)':j.type==='dim'?'var(--tm)':'var(--cy)';
    return '<div style="color:'+clr+';margin-bottom:2px;padding:4px;border-bottom:1px solid rgba(255,255,255,.02)"><span style="color:var(--tm)">['+j.time+']</span> '+j.msg+'</div>';
  }).join('');
}

window.resetDBotStats=function(){
  if(!confirm('Reset all stats?'))return;
  S.dbot.stats={totalStake:0,totalPayout:0,runs:0,won:0,lost:0,pl:0};
  S.dbot.transactions=[];
  S.dbot.journal=[];
  updateDBotStats();
  renderTransactions();
  renderJournal();
  $('dbotEmptyState').style.display='block';
  $('dbotSummaryStats').style.display='none';
  toast('Stats reset','info');
};

function initDBotChart(){
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d');
  const container=$('dbotChart');
  container.innerHTML='';
  container.appendChild(canvas);
  canvas.width=container.offsetWidth||600;
  canvas.height=container.offsetHeight||400;
  S.dbot.chartData=[];
  drawDBotChart(ctx,canvas.width,canvas.height);
}
function drawDBotChart(ctx,w,h){
  ctx.clearRect(0,0,w,h);
  if(!S.dbot||!S.dbot.chartData||S.dbot.chartData.length<2){
    ctx.fillStyle='#5A6478';ctx.font='13px Inter';ctx.textAlign='center';
    ctx.fillText('Real-time price chart will appear here',w/2,h/2);
    ctx.fillText('Import a bot and run to see live data',w/2,h/2+18);
    return;
  }
  const data=S.dbot.chartData;
  const min=Math.min.apply(null,data);
  const max=Math.max.apply(null,data);
  const range=max-min||1;
  const pad=40;
  const cw=w-pad*2;
  const ch=h-pad*2;
  ctx.strokeStyle='rgba(255,255,255,.05)';ctx.lineWidth=1;
  for(let i=0;i<=5;i++){const y=pad+(i/5)*ch;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke();}
  ctx.strokeStyle='rgba(59,130,246,.6)';ctx.lineWidth=2;ctx.beginPath();
  data.forEach(function(v,i){
    const x=pad+(i/(data.length-1))*cw;
    const y=h-pad-((v-min)/range)*ch;
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  });
  ctx.stroke();
  const grad=ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,'rgba(59,130,246,.25)');
  grad.addColorStop(1,'rgba(59,130,246,0)');
  ctx.lineTo(pad+cw,h-pad);ctx.lineTo(pad,h-pad);ctx.closePath();
  ctx.fillStyle=grad;ctx.fill();
  ctx.fillStyle='#8B95A8';ctx.font='10px JetBrains Mono';
  ctx.fillText(min.toFixed(4),4,h-pad+12);
  ctx.fillText(max.toFixed(4),4,pad+4);
  ctx.fillText(S.sym,w-pad-30,pad-8);
}
function updateDBotChart(){
  if(S.page!=='dbot'||!S.last)return;
  if(!S.dbot.chartData)S.dbot.chartData=[];
  S.dbot.chartData.push(S.last);
  if(S.dbot.chartData.length>120)S.dbot.chartData.shift();
  const canvas=document.querySelector('#dbotChart canvas');
  if(canvas){
    canvas.width=canvas.parentElement.offsetWidth||600;
    canvas.height=canvas.parentElement.offsetHeight||400;
    const ctx=canvas.getContext('2d');
    drawDBotChart(ctx,canvas.width,canvas.height);
  }
}

function renderDBot(){
  if(S.dbot&&S.dbot.loaded){
    if(!$('dbotChart').querySelector('canvas'))initDBotChart();
  }
  if(S.dbot){
    updateDBotStats();
    renderTransactions();
    renderJournal();
  }
}

// ===== SETTINGS =====
function openModal(t,b){$('mtitle').textContent=t;$('mbody').innerHTML=b;$('modal').style.display='flex';}
function closeModal(){$('modal').style.display='none';}
function openConn(){
  openModal('Connect Deriv',
    '<p style="font-size:11px;color:var(--td);margin-bottom:10px">Get a free token at api.deriv.com</p>'+
    '<input type="password" class="input" id="tIn" placeholder="Deriv API Token" value="'+(S.cfg.token||'')+'" style="margin-bottom:10px">'+
    '<button class="btn b1 big" onclick="doConn()" style="width:100%">⚡ Connect</button>'
  );
  setTimeout(function(){$('tIn')&&$('tIn').focus();},100);
}
function doConn(){
  const t=$('tIn').value.trim();
  if(!t){toast('Enter token','error');return;}
  S.cfg.token=t;$('st').value=t;save();closeModal();
  if(S.ready){send({authorize:t});}
  else{conn();setTimeout(function(){if(S.ready)send({authorize:t});},1500);}
}
$('modal').addEventListener('click',function(e){if(e.target.id==='modal')closeModal();});
function applyS(){$('st').value=S.cfg.token||'';$('ss').value=S.cfg.sym;$('stake').value='1';}
function saveS(){
  S.cfg.token=$('st').value.trim();
  S.cfg.sym=$('ss').value;
  save();
  if(S.cfg.sym!==S.sym)setSym(S.cfg.sym);
  if(S.cfg.token&&S.ready&&!S.auth)send({authorize:S.cfg.token});
}
function setSym(s){
  S.sym=s;$('sym').textContent=s;$('ss').value=s;S.cfg.sym=s;save();
  S.ticks=[];S.df=Array(10).fill(0);S.last=null;
  if(S.ready)subTicks();
}
function clrH(){if(confirm('Clear history?')){S.hist=[];save();renderH();renderHome();}}
function reset(){
  if(confirm('Reset ALL?')){
    S.hist=[];S.acc.pl=0;
    S.cfg={maxStake:10,token:'',sym:'R_100'};
    S.savedBots=[];S.dbot=null;
    save();applyS();renderH();renderHome();renderDBot();
    toast('Reset','success');
  }
}

// ===== INIT =====
function init(){
  load();applyS();
  S.auto.lad=buildL();
  aUpdate();
  setSym(S.cfg.sym||'R_100');
  renderHome();
  mgUpdate();
  conn();
  setInterval(function(){if(S.ready&&S.auth)reqProp();},5000);
  setInterval(function(){renderHome();},2000);
}

// START
runBoot();
