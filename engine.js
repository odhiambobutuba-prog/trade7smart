// ============================================
// TRADE7SMART AI v3.0 — ENGINE
// ============================================

// STATE
const S={
  page:'home',ws:null,ready:false,auth:false,rec:false,hb:null,
  ticks:[],df:Array(10).fill(0),sym:'R_100',pid:null,pdata:null,
  sel:{c:'DIGITOVER',b:'0'},oid:null,odata:null,hist:[],
  cfg:{maxStake:10,token:'',sym:'R_100'},
  acc:{bal:0,cur:'USD',login:'',pl:0},last:null,rid:1,stake:1,
  auto:{on:false,arrows:0,need:3,dir:1,lvl:0,base:1,lad:[],buf:.91,busy:false,cd:false,c:'DIGITOVER',b:'1',scan:false},
  mode:'triple',modeActive:false,savedBots:[],
  dbot:{running:false,blocks:[],logs:[]}
};

// STORAGE
function save(){try{localStorage.setItem('t7s_cfg',JSON.stringify(S.cfg));localStorage.setItem('t7s_h',JSON.stringify(S.hist.slice(0,500)));localStorage.setItem('t7s_modes',JSON.stringify(S.modeHistory||{}));localStorage.setItem('t7s_bots',JSON.stringify(S.savedBots));}catch(e){}}
function load(){try{var c=JSON.parse(localStorage.getItem('t7s_cfg'));if(c)Object.assign(S.cfg,c);var h=JSON.parse(localStorage.getItem('t7s_h')||'[]');if(Array.isArray(h))S.hist=h;var m=JSON.parse(localStorage.getItem('t7s_modes')||'{}');if(m)S.modeHistory=m;var b=JSON.parse(localStorage.getItem('t7s_bots')||'[]');if(Array.isArray(b))S.savedBots=b;}catch(e){}}

// HELPERS
function $(id){return document.getElementById(id);}
function fmt(n,d){d=d||2;return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function $f(n){return '$'+fmt(n);}
function toast(m,t,ms){t=t||'info';ms=ms||3000;var d=document.createElement('div');d.className='toast '+t;d.innerHTML='<span>'+(t==='success'?'✓':t==='error'?'✕':'ⓘ')+'</span><span>'+m+'</span>';$('toasts').appendChild(d);setTimeout(function(){d.remove();},ms);}

// ============================================
// BOOT ANIMATION (8 SCREENS)
// ============================================
const BOOT_SCREENS=[
  {n:1,title:'AI SCAN',color:'#22C55E',icon:'shield',msg:'Scanning market data...',pct:20},
  {n:2,title:'DATA STREAM',color:'#8B5CF6',icon:'wave',msg:'Processing live tick data...',pct:45},
  {n:3,title:'ANALYZING',color:'#22D3EE',icon:'brain',msg:'AI is analyzing patterns...',pct:70},
  {n:4,title:'CALCULATING',color:'#F59E0B',icon:'math',msg:'Calculating probabilities...',pct:85},
  {n:5,title:'OPTIMIZING',color:'#22C55E',icon:'gear',msg:'Optimizing strategy model...',pct:92},
  {n:6,title:'CONNECTING',color:'#3B82F6',icon:'globe',msg:'Connecting to market server...',pct:96},
  {n:7,title:'PREPARING INSIGHTS',color:'#EC4899',icon:'chart',msg:'Preparing AI insights...',pct:99},
  {n:8,title:'ALMOST READY',color:'#22C55E',icon:'shield',msg:'Almost ready...',pct:100}
];

function getIcon(name){
  const icons={
    shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L3 7v6c0 5 4 9 9 10 5-1 9-5 9-10V7l-9-5z"/><path d="M9 12l2 2 4-4"/></svg>',
    wave:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/></svg>',
    brain:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a4 4 0 0 0-4 4v1a3 3 0 0 0-3 3v3a3 3 0 0 0 1 2v3a3 3 0 0 0 3 3v1a4 4 0 0 0 8 0v-1a3 3 0 0 0 3-3v-3a3 3 0 0 0 1-2v-3a3 3 0 0 0-3-3V6a4 4 0 0 0-4-4z"/></svg>',
    math:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 8h8M8 12h8M8 16h8M12 4v16"/></svg>',
    gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    globe:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>',
    chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>'
  };
  return icons[name]||icons.shield;
}

function runBoot(){
  // If already shown this session, skip
  if(sessionStorage.getItem('t7s_booted')){
    $('boot').style.display='none';
    document.querySelector('.app').style.display='grid';
    setTimeout(init,100);
    return;
  }
  
  // Build particles bg
  var bg=$('bootBg');
  for(var i=0;i<25;i++){
    var s=document.createElement('span');
    s.style.left=Math.random()*100+'%';
    s.style.animationDelay=(Math.random()*15)+'s';
    s.style.animationDuration=(10+Math.random()*10)+'s';
    bg.appendChild(s);
  }
  
  // Build 8 screens
  var content=$('bootContent');
  BOOT_SCREENS.forEach(function(sc,i){
    var div=document.createElement('div');
    div.className='boot-screen';
    div.dataset.idx=i;
    div.style.color=sc.color;
    div.innerHTML='<div class="boot-num" style="color:'+sc.color+'"><span>'+sc.n+'</span> '+sc.title+'</div>'+
      '<div class="boot-icon">'+getIcon(sc.icon)+'</div>'+
      '<div class="boot-title" style="color:'+sc.color+'">'+sc.title+'</div>'+
      '<div class="boot-sub">Trade7Smart AI ANALYZER</div>'+
      '<div class="boot-msg">'+sc.msg+'</div>'+
      '<div class="boot-bar"><div class="boot-fill" style="background:'+sc.color+';color:'+sc.color+'"></div></div>'+
      '<div class="boot-pct" style="color:'+sc.color+'">0%</div>';
    content.appendChild(div);
  });
  
  // Final screen
  var fin=document.createElement('div');
  fin.className='boot-final';
  fin.id='bootFinal';
  fin.innerHTML='<div class="boot-rocket">🚀</div><h2>Trade7Smart AI Ready</h2><div class="welcome">Welcome to Trade7Smart AI Analyzer</div><div class="tagline">Smart Data. Smarter Decisions.</div><div class="boot-check">✓</div>';
  content.appendChild(fin);
  
  // Run sequence
  var idx=0;
  function next(){
    if(idx>=BOOT_SCREENS.length){
      // Show final
      document.querySelectorAll('.boot-screen').forEach(function(s){s.classList.remove('active');});
      $('bootFinal').classList.add('show');
      setTimeout(finishBoot,1500);
      return;
    }
    document.querySelectorAll('.boot-screen').forEach(function(s){s.classList.remove('active');});
    var cur=$('.boot-screen[data-idx="'+idx+'"]');
    cur.classList.add('active');
    var sc=BOOT_SCREENS[idx];
    setTimeout(function(){
      cur.querySelector('.boot-fill').style.width=sc.pct+'%';
      cur.querySelector('.boot-pct').textContent=sc.pct+'%';
    },100);
    idx++;
    setTimeout(next,1000);
  }
  next();
}

function finishBoot(){
  sessionStorage.setItem('t7s_booted','1');
  $('boot').classList.add('off');
  document.querySelector('.app').style.display='grid';
  setTimeout(function(){$('boot').style.display='none';init();},800);
}

// ============================================
// NAVIGATION
// ============================================
function go(p){S.page=p;document.querySelectorAll('.page').forEach(function(x){x.classList.remove('on');});document.querySelectorAll('.nav,.bi').forEach(function(n){n.classList.toggle('on',n.dataset.p===p);});$('p-'+p).classList.add('on');document.querySelector('.main').scrollTop=0;if(p==='history')renderH();if(p==='home')renderHome();if(p==='modes')renderModes();if(p==='dbot')renderDBot();}

// ============================================
// DERIV WEBSOCKET
// ============================================
const WS='wss://ws.binaryws.com/websockets/v3?app_id=1089';
function conn(){
  if(S.ws){try{S.ws.close();}catch(e){}}
  S.ws=null;S.ready=false;S.auth=false;S.pid=null;S.pdata=null;updConn('connecting');
  try{S.ws=new WebSocket(WS);}catch(e){recon();return;}
  S.ws.onopen=function(){
    S.ready=true;try{S.ws.send(JSON.stringify({forget_all:'all'}));}catch(e){}
    if(S.cfg.token&&S.cfg.token.length>5){send({authorize:S.cfg.token});}else{subTicks();updConn('live');}hb();
  };
  S.ws.onmessage=function(e){try{handle(JSON.parse(e.data));}catch(err){}};
  S.ws.onerror=function(){};S.ws.onclose=function(){S.ready=false;S.auth=false;S.pid=null;updConn('off');shb();recon();};
}
function recon(){if(S.rec)return;S.rec=true;setTimeout(function(){S.rec=false;conn();},4000);}
function hb(){shb();S.hb=setInterval(function(){if(S.ready){try{S.ws.send(JSON.stringify({ping:1}));}catch(e){}}},30000);}
function shb(){if(S.hb){clearInterval(S.hb);}S.hb=null;}
function send(o){if(!S.ready||!S.ws)return;o.req_id=S.rid++;try{S.ws.send(JSON.stringify(o));}catch(e){}}

function handle(d){
  if(d.msg_type==='ping'){send({pong:1});return;}
  if(d.error){var c=d.error.code||'';if(c==='InvalidToken'||c==='AuthorizationRequired'){S.auth=false;toast('Invalid token','error');}else if(['AlreadySubscribed','ContractWon','ContractLost','RateLimit','MarketIsClosed','ContractBuyPriceError','PriceMoved'].indexOf(c)===-1){toast(d.error.message||'Error','error',3000);}if(['ContractBuyPriceError','PriceMoved'].indexOf(c)>=0){S.pid=null;S.pdata=null;setTimeout(function(){if(S.ready&&S.auth)reqProp();},800);}return;}
  if(d.msg_type==='authorize'){S.auth=true;S.acc.login=d.authorize.loginid;S.acc.cur=d.authorize.currency||'USD';subTicks();send({balance:1,subscribe:1});updConn('live');toast('✓ '+d.authorize.loginid,'success');}
  if(d.msg_type==='balance'){S.acc.bal=Number(d.balance.balance);if(d.balance.currency)S.acc.cur=d.balance.currency;renderBal();}
  if(d.msg_type==='tick')onTick(d.tick);
  if(d.msg_type==='proposal'){S.pid=d.proposal.id;S.pdata=d.proposal;renderProp();}
  if(d.msg_type==='buy'){if(d.buy){toast('✓ Bought $'+d.buy.buy_price,'success');S.oid=d.buy.contract_id;S.odata=null;send({proposal_open_contract:1,contract_id:d.buy.contract_id,subscribe:1});renderMon();}else toast('Buy failed','error');}
  if(d.msg_type==='proposal_open_contract'){var c=d.proposal_open_contract;S.odata=c;var done=c.is_sold===1||c.status==='lost'||c.status==='won';if(done)settle(c);else renderMon();}
}

function settle(c){
  var prof=Number(c.profit);var buy=Number(c.buy_price);var pay=Number(c.payout||prof+buy);
  var ex=c.exit_tick_display||c.exit_tick||c.current_spot_display||c.current_spot||0;
  var en=c.entry_tick_display||c.entry_tick||0;var w=prof>0;
  S.acc.pl+=prof;
  // Track mode stats
  if(S.modeHistory){S.modeHistory[S.mode]=S.modeHistory[S.mode]||{trades:0,wins:0,pl:0};S.modeHistory[S.mode].trades++;if(w)S.modeHistory[S.mode].wins++;S.modeHistory[S.mode].pl+=prof;}
  S.hist.unshift({time:c.date_start||Math.floor(Date.now()/1000),contract:c.contract_type+' '+c.barrier,entry:en,exit:ex,stake:buy,payout:pay,profit:prof,win:w,mode:S.mode});
  if(S.hist.length>500)S.hist=S.hist.slice(0,500);
  save();renderH();renderHome();renderBal();renderModes();
  setTimeout(function(){send({balance:1,subscribe:1});},500);
  // Smart Recovery (Option C)
  if(!w && S.modeActive){
    var lostDigit=c.entry_tick_display?parseInt(c.entry_tick_display.toString().slice(-1),10):0;
    setTimeout(function(){recoverySwitch(lostDigit,c.contract_type);},1000);
  }
  showRes({contract:c.contract_type+' '+c.barrier,entry:en,exit:ex,stake:buy,payout:pay,profit:prof,win:w});
  S.oid=null;S.odata=null;
}

function recoverySwitch(digit,prevContract){
  var newContract,newBarrier,dir;
  if(prevContract==='DIGITOVER'){
    if(digit===0){newContract='DIGITOVER';newBarrier='1';}
    else if(digit===1){newContract='DIGITUNDER';newBarrier='8';}
    else{newContract='DIGITUNDER';newBarrier='8';}
  } else {
    if(digit===8){newContract='DIGITOVER';newBarrier='0';}
    else if(digit===9){newContract='DIGITUNDER';newBarrier='8';}
    else{newContract='DIGITOVER';newBarrier='0';}
  }
  toast('Recovery: '+newContract+' '+newBarrier,'info');
  S.sel.c=newContract;S.sel.b=newBarrier;
  document.querySelectorAll('.cbtn').forEach(function(b){b.classList.toggle('on',b.dataset.c===newContract&&b.dataset.b===newBarrier);});
  reqProp();
}

function updConn(s){
  var d=$('cd'),t=$('ct'),h=$('hcd'),ht=$('hct');
  if(s==='live'){d.className='dot live';t.textContent=S.auth?'Connected':'Live';h.className='dot live';ht.textContent=S.auth?'Authorized':'Connected';$('hmkt').textContent='Open';$('sbWs').textContent='● Online';$('sbWs').className='ok';}
  else if(s==='connecting'){d.className='dot';t.textContent='Connecting';h.className='dot';ht.textContent='Connecting';$('hmkt').textContent='...';}
  else{d.className='dot';t.textContent='Offline';h.className='dot';ht.textContent='Offline';$('hmkt').textContent='Off';$('sbWs').textContent='● Off';$('sbWs').className='r';}
}

function subTicks(){if(!S.ready)return;send({forget_all:'ticks'});send({ticks_history:S.sym,adjust_start_time:1,count:100,end:'latest',start:1,style:'ticks'});send({ticks:S.sym,subscribe:1});}

function onTick(t){
  var p=Number(t.quote);var pr=S.last;var dir=pr!==null?(p>pr?1:p<pr?-1:0):0;var ch=pr!==null?p-pr:0;var dig=parseInt(t.quote.toString().slice(-1),10);
  S.last=p;var sp=$('px');sp.textContent=fmt(p,4);sp.classList.remove('up','down');if(dir>0)sp.classList.add('up');else if(dir<0)sp.classList.add('down');
  S.ticks.unshift({p:p,dir:dir,ch:ch,dig:dig,time:t.epoch});if(S.ticks.length>200)S.ticks.pop();S.df[dig]++;
  renderHomeLive();autoChk();runMode();
}

function renderBal(){
  var tx=S.auth?$f(S.acc.bal):'$—';$('bal').textContent=tx;$('hbal').textContent=tx;
  $('hacc').textContent=S.acc.login||'—';$('hpl').textContent=S.auth?(S.acc.pl>=0?'+':'')+$f(S.acc.pl):'$0.00';$('hpl').className='val '+(S.acc.pl>=0?'g':'r');
}

function renderHome(){
  var t=S.hist.length;var w=S.hist.filter(function(h){return h.win;}).length;
  $('htc').textContent=t;$('hwr').textContent=t?Math.round(w/t*100)+'%':'0%';$('hwrs').textContent=t?w+'W/'+(t-w)+'L':'No trades';
  var rt=$('rTrades');rt.innerHTML=t?S.hist.slice(0,4).map(function(h){var dt=new Date((h.time||0)*1000);return '<div class="row between" style="padding:6px;background:rgba(255,255,255,.02);border-radius:6px;border:1px solid var(--b);margin-bottom:4px"><div><div class="mono fw fz">'+h.contract+'</div><div class="dim fz">'+dt.toLocaleTimeString()+'</div></div><span class="mono fw '+(h.win?'g':'r')+'">'+(h.win?'+':'')+fmt(h.profit)+'</span></div>';}).join(''):'<div class="empty">No trades</div>';
  var rn=$('rNews');rn.innerHTML=[{t:'Mode',s:S.mode||'none'},{t:'Symbol',s:S.sym},{t:'Ticks',s:S.ticks.length+' received'},{t:'Status',s:S.auth?'Trading ready':'Connect to trade'}].map(function(it){return '<div style="padding:6px;background:rgba(255,255,255,.02);border-radius:6px;border:1px solid var(--b);margin-bottom:4px"><div class="fw fz">'+it.t+'</div><div class="dim fz">'+it.s+'</div></div>';}).join('');
  $('aiHome').textContent=S.modeActive?S.mode.toUpperCase():'Pick Mode';$('aiHome').className='cv '+(S.modeActive?'cy':'');$('aiSub').textContent=S.modeActive?'ACTIVE · '+S.ticks.length+' ticks':'Click Modes tab';
}

function renderHomeLive(){
  var d=S.ticks[0]?S.ticks[0].dig:undefined;
  if(d!==undefined){$('md').textContent=d;$('mp').textContent=S.last?fmt(S.last,4):'—';var s=S.last,p=S.ticks[1]?S.ticks[1].p:s;$('reg').textContent=s>p?'BEAR':s<p?'BULL':'—';}
}

function renderH(){
  var tb=$('hb'),em=$('he');
  if(!S.hist.length){tb.innerHTML='';em.style.display='block';$('hs').textContent='0 trades';return;}
  em.style.display='none';
  tb.innerHTML=S.hist.slice(0,100).map(function(h){var dt=new Date((h.time||0)*1000);return '<tr><td class="dim">'+dt.toLocaleString()+'</td><td>'+h.contract+'</td><td>'+$f(h.stake)+'</td><td class="'+(h.win?'win':'loss')+'">'+(h.win?'+':'')+fmt(h.profit)+'</td></tr>';}).join('');
  var w=S.hist.filter(function(h){return h.win;}).length;$('hs').textContent=S.hist.length+' · '+w+'W/'+(S.hist.length-w)+'L';
}

// ============================================
// MODES (6 MODES + SCANNER)
// ============================================
S.modeHistory={};

function selMode(m){S.mode=m;S.modeActive=false;document.querySelectorAll('.mode-card').forEach(function(c){c.classList.toggle('on',c.dataset.mode===m);});renderModes();}

function renderModes(){
  // Update mode stats
  ['triple','momentum','smart','sniper','custom','hybrid'].forEach(function(m){
    var stat=S.modeHistory[m]||{trades:0,wins:0,pl:0};
    var el=$('stat-'+m);
    if(!el)return;
    if(m==='hybrid'){el.textContent='AUTO';el.className='mono fw cy mt';}
    else if(m==='custom'){el.textContent='Setup';el.className='mono fw am mt';}
    else if(stat.trades>0){var pct=Math.round(stat.wins/stat.trades*100);el.textContent=pct+'% ('+stat.trades+')';el.className='mono fw '+(pct>=70?'g':pct>=50?'am':'r')+' mt';}
    else{el.textContent='—';el.className='mono fw g mt';}
  });
  
  // Mode detail
  var names={triple:'Triple Strike · Pattern 0,0,0/1,1,1',momentum:'Momentum Rider · 3 arrows',smart:'Smart Hunter · Combined',sniper:'Sniper Rush · Every tick',custom:'Custom Builder',hybrid:'Hybrid Auto · App picks'};
  var stat=S.modeHistory[S.mode]||{trades:0,wins:0,pl:0};
  var html='<h3>'+(names[S.mode]||'Mode')+'</h3>';
  html+='<div class="grid4"><div class="stat"><div class="lbl">Trades</div><div class="val">'+stat.trades+'</div></div><div class="stat"><div class="lbl">Win Rate</div><div class="val '+(stat.wins/stat.trades>=0.7?'g':'am')+'">'+(stat.trades?Math.round(stat.wins/stat.trades*100):0)+'%</div></div><div class="stat"><div class="lbl">P/L</div><div class="val '+(stat.pl>=0?'g':'r')+'">'+(stat.pl>=0?'+':'')+fmt(stat.pl)+'</div></div></div>';
  $('modeDetail').innerHTML=html;
}

function modeToggle(){
  if(!S.auth){toast('Connect Deriv first','error');openConn();return;}
  if(S.modeActive){S.modeActive=false;toast('Mode stopped','info');$('modeBtn').textContent='▶ ACTIVATE';$('modeBtn').classList.remove('red');$('modeBtn').classList.add('b1');return;}
  S.modeActive=true;$('modeBtn').textContent='⏹ STOP';$('modeBtn').classList.add('red');$('modeBtn').classList.remove('b1');
  toast(S.mode.toUpperCase()+' mode activated','success');
}

function runMode(){
  if(!S.modeActive||!S.auth||S.ticks.length<3)return;
  if(S.mode==='triple')runTripleMode();
  else if(S.mode==='momentum')runMomentumMode();
  else if(S.mode==='smart')runSmartMode();
  else if(S.mode==='sniper')runSniperMode();
  else if(S.mode==='hybrid')runHybridMode();
}

function runTripleMode(){
  var h=S.ticks.slice(0,3).map(function(t){return t.dig;});
  var pat=h.join(',');
  if(pat==='0,0,0'){S.sel.c='DIGITOVER';S.sel.b='0';executeModeTrade('Pattern 0,0,0 → OVER 0');}
  else if(pat==='1,1,1'){S.sel.c='DIGITOVER';S.sel.b='1';executeModeTrade('Pattern 1,1,1 → OVER 1');}
  else if(pat==='9,9,9'){S.sel.c='DIGITUNDER';S.sel.b='9';executeModeTrade('Pattern 9,9,9 → UNDER 9');}
  else if(pat==='8,8,8'){S.sel.c='DIGITUNDER';S.sel.b='8';executeModeTrade('Pattern 8,8,8 → UNDER 8');}
}

function runMomentumMode(){
  var h=S.ticks.slice(0,4);
  var ups=0,downs=0;h.forEach(function(t){if(t.ch>0)ups++;else if(t.ch<0)downs++;});
  if(ups>=3){S.sel.c='DIGITOVER';S.sel.b='0';executeModeTrade('Momentum UP → OVER 0');}
  else if(downs>=3){S.sel.c='DIGITUNDER';S.sel.b='8';executeModeTrade('Momentum DOWN → UNDER 8');}
}

function runSmartMode(){
  // Both pattern + momentum
  var h=S.ticks.slice(0,4);
  var pat=h.slice(1,4).map(function(t){return t.dig;}).join(',');
  var ups=0,downs=0;h.slice(0,3).forEach(function(t){if(t.ch>0)ups++;else if(t.ch<0)downs++;});
  var patternOk=pat==='0,0,0'||pat==='9,9,9';
  var momentumOk=ups>=3||downs>=3;
  if(patternOk&&momentumOk){
    if(pat==='0,0,0'&&ups>=3){S.sel.c='DIGITOVER';S.sel.b='0';executeModeTrade('SMART: 0,0,0 + UP');}
    else if(pat==='9,9,9'&&downs>=3){S.sel.c='DIGITUNDER';S.sel.b='9';executeModeTrade('SMART: 9,9,9 + DOWN');}
  }
}

function runSniperMode(){
  if(!S.oid&&!S.auto.busy){
    var r=Math.random()<0.5;
    S.sel.c=r?'DIGITOVER':'DIGITUNDER';
    S.sel.b=r?'0':'8';
    executeModeTrade('SNIPER');
  }
}

function runHybridMode(){
  // Auto-pick best mode based on tick variance
  if(S.ticks.length<5)return;
  var recent=S.ticks.slice(0,10);
  var variance=0;for(var i=1;i<recent.length;i++){variance+=Math.abs(recent[i].ch);}variance/=recent.length;
  if(variance>5)S.mode='smart';
  else if(variance>2)S.mode='momentum';
  else S.mode='triple';
  renderModes();
  runMode();
}

function executeModeTrade(reason){
  if(S.oid||S.auto.busy)return;
  S.auto.busy=true;
  var stake=parseFloat($('stake').value)||1;
  if(stake>S.cfg.maxStake){toast('Max stake','error');S.auto.busy=false;return;}
  document.querySelectorAll('.cbtn').forEach(function(b){b.classList.toggle('on',b.dataset.c===S.sel.c&&b.dataset.b===S.sel.b);});
  send({proposal:1,amount:String(stake),basis:'stake',contract_type:S.sel.c,currency:S.acc.cur,duration:1,duration_unit:'t',symbol:S.sym,barrier:String(S.sel.b)});
  setTimeout(function(){
    if(S.pid){send({buy:S.pid,price:S.pdata.ask_price});toast(reason,'info');}
    S.auto.busy=false;
  },600);
}

// ============================================
// AUTO-TRADE (LEGACY FROM EARLIER)
// ============================================
function buildL(){var l=[S.auto.base];var s=S.auto.base;for(var i=1;i<8;i++){var n=+(s*2.15/S.auto.buf).toFixed(2);l.push(n);s+=n;}return l;}

function autoChk(){
  if(!S.auto.on||S.auto.cd||S.auto.busy||S.ticks.length<2)return;
  var last=S.ticks[0];var ok=S.auto.dir===1?last.ch>0:last.ch<0;
  if(ok){S.auto.arrows++;pulseA();aUpdate();if(S.auto.arrows>=S.auto.need){S.auto.arrows=0;autoBuy();}}
  else{S.auto.arrows=0;aUpdate();}
}

function autoBuy(){
  if(!S.pid||!S.pdata){reqProp();setTimeout(autoBuy,800);return;}
  var st=S.auto.lad[Math.min(S.auto.lvl,S.auto.lad.length-1)];
  if(S.acc.bal>0&&st>S.acc.bal){toast('Low balance','error');autoStop();return;}
  send({proposal:1,amount:String(st),basis:'stake',contract_type:S.auto.c,currency:S.acc.cur,duration:1,duration_unit:'t',symbol:S.sym,barrier:String(S.auto.b)});
  S.auto.busy=true;setTimeout(function(){if(S.pid){send({buy:S.pid,price:S.pdata.ask_price});toast('Auto L'+(S.auto.lvl+1)+' $'+st,'info');}$('alv').textContent=S.auto.lvl+1;$('astk').textContent=$f(st);aUpdate();S.auto.busy=false;},600);
}

function autoStart(){if(!S.auth){toast('Connect first','error');openConn();return;}if(S.auto.on){autoStop();return;}S.auto.on=true;S.auto.base=parseFloat($('stake').value)||1;S.auto.need=parseInt($('aa').value)||3;S.auto.buf=parseFloat($('ab').value)||0.91;S.auto.lad=buildL();S.auto.arrows=0;S.auto.lvl=0;S.auto.scan=true;aUpdate();toast('Auto ON','info');}
function autoStop(){S.auto.on=false;S.auto.scan=false;S.auto.cd=false;aUpdate();toast('Auto OFF','info');}
function aUpdate(){var on=S.auto.on;$('aBtn').textContent=on?'⏹ STOP':'▶ SCAN';$('aBtn').classList.toggle('red',on);$('aBtn').classList.toggle('b1',!on);$('aStat').textContent=on?'Scanning':'Stopped';$('anow').textContent=S.auto.arrows+'/'+S.auto.need;document.querySelectorAll('.arr').forEach(function(a,i){a.classList.toggle('on',on&&i<S.auto.arrows);});$('alv').textContent=S.auto.lvl+1;$('astk').textContent=$f(S.auto.lad[Math.min(S.auto.lvl,S.auto.lad.length-1)]);$('lad').innerHTML=S.auto.lad.slice(0,5).map(function(s,i){return '<div class="lrow '+(i===S.auto.lvl?'on':'')+'"><span class="dim">L'+(i+1)+'</span><span class="mono fw">'+$f(s)+'</span></div>';}).join('');}
function pulseA(){var a=document.querySelectorAll('.arr');if(a[S.auto.arrows-1]){a[S.auto.arrows-1].classList.add('pulse');setTimeout(function(){a[S.auto.arrows-1]&&a[S.auto.arrows-1].classList.remove('pulse');},400);}}

// ============================================
// TRADE ACTIONS
// ============================================
var selEl=null;
function pick(el){if(selEl)selEl.classList.remove('on');el.classList.add('on');selEl=el;S.sel.c=el.dataset.c;S.sel.b=el.dataset.b;reqProp();}
function reqProp(){if(!S.ready){toast('Not connected','error');return;}if(!S.auth){toast('Authorize first','error');openConn();return;}var st=parseFloat($('stake').value)||1;if(st>S.cfg.maxStake){toast('Max $'+S.cfg.maxStake,'error');return;}if(S.acc.bal>0&&st>S.acc.bal){toast('Insufficient','error');return;}S.stake=st;$('pst').textContent='Fetching...';$('buyBtn').disabled=true;$('pc').textContent=S.sel.c+' '+S.sel.b;$('pb').textContent=S.sel.b;$('ps').textContent=$f(st);send({proposal:1,amount:String(st),basis:'stake',contract_type:S.sel.c,currency:S.acc.cur,duration:1,duration_unit:'t',symbol:S.sym,barrier:String(S.sel.b)});}
function renderProp(){if(!S.pdata)return;var p=S.pdata;var st=Number(p.ask_price||S.stake);var po=Number(p.payout||0);var pr=po-st;$('ppo').textContent=$f(po);$('ppr').textContent='+'+fmt(pr);$('pprob').textContent=fmt(Number(p.probability)*100,1)+'%';$('prk').textContent=$f(st);var er=pr*Number(p.probability)-st*(1-Number(p.probability));$('per').textContent=(er>=0?'+':'')+$f(er);$('per').className='mono '+(er>=0?'g':'r');$('pst').textContent=S.auth?'Ready':'Authorize';$('buyBtn').disabled=!S.auth;}
function buy(){if(!S.pid||!S.auth)return;$('buyBtn').disabled=true;$('buyBtn').textContent='...';send({buy:S.pid,price:S.pdata.ask_price});setTimeout(function(){$('buyBtn').textContent='⚡ BUY';$('buyBtn').disabled=false;},2000);}
function renderMon(){var sl=$('omon');if(!S.odata||!S.oid){sl.innerHTML='';return;}var c=S.odata;var cur=c.current_spot_display?Number(c.current_spot_display):(c.current_spot||0);var en=c.entry_tick_display?Number(c.entry_tick_display):(c.entry_tick||0);var cd=cur?parseInt(cur.toString().slice(-1),10):0;var ed=en?parseInt(en.toString().slice(-1),10):0;var buy=Number(c.buy_price);var cv=Number(c.bid_price!==undefined?c.bid_price:buy);var pr=cv-buy;var wc=c.status==='won'?'up':c.status==='lost'?'down':(pr>0?'up':'down');sl.innerHTML='<div class="card glass mcard"><span class="live">● LIVE</span><div class="dim fz mt">'+c.contract_type+' '+c.barrier+'</div><div class="mdig '+wc+'">'+cd+'</div><div class="dim mono fz">Entry: '+ed+' @ '+fmt(en,4)+'</div><div class="row between mt"><div><div class="dim fz">Stake</div><div class="mono fw">'+$f(buy)+'</div></div><div><div class="dim fz">P/L</div><div class="mono fw '+wc+'">'+(pr>=0?'+':'')+fmt(pr)+'</div></div></div></div>';}
function showRes(e){$('omon').innerHTML='<div class="card glass rcard '+(e.win?'win':'loss')+'"><div class="rico">'+(e.win?'✓':'✕')+'</div><h2 style="color:'+(e.win?'var(--g)':'var(--r)')+'">'+(e.win?'PROFIT':'LOSS')+'</h2><div class="ramt">'+(e.win?'+':'')+fmt(e.profit)+'</div><div class="dim mono fz">'+e.contract+'</div><button class="btn big w mt" onclick="$(\'omon\').innerHTML=\'\'">Continue</button></div>';}

// ============================================
// DBOT (placeholder, real logic in dbot.js)
// ============================================
function renderDBot(){
  // Saved bots
  var sb=$('savedBots');
  if(S.savedBots.length===0){sb.innerHTML='<div class="dim fz">No saved bots</div>';}
  else{
    sb.innerHTML=S.savedBots.map(function(b,i){return '<div class="row between" style="padding:8px;background:rgba(255,255,255,.02);border-radius:6px;border:1px solid var(--b);margin-bottom:4px"><span class="mono fw fz">'+b.name+'</span><div class="row gap-2"><button class="btn s" onclick="loadSavedBot('+i+')">Load</button><button class="btn s red" onclick="delSavedBot('+i+')">×</button></div></div>';}).join('');
  }
  // Status
  $('botStatus').textContent=S.dbot.running?'Running · '+S.dbot.blocks.length+' blocks':'Idle';
  $('botStatus').className='dim fz '+(S.dbot.running?'cy':'');
  // Render canvas
  renderBotCanvas();
  // Logs
  $('botLogs').innerHTML=S.dbot.logs.slice(-20).map(function(l){return '<div style="color:'+(l.t==='error'?'var(--r)':l.t==='success'?'var(--g)':'var(--cy)')+'">'+l.msg+'</div>';}).join('')||'<div class="dim">No logs yet</div>';
}

function renderBotCanvas(){
  var cv=$('botCanvas');
  if(S.dbot.blocks.length===0){cv.innerHTML='<div class="dim c" style="padding:40px">Load a bot or add blocks</div>';return;}
  cv.innerHTML='<div class="col gap-2">'+S.dbot.blocks.map(function(b,i){
    var active=S.dbot.running&&i===S.dbot.currentBlock;
    return '<div class="card glass" style="padding:10px;border-color:'+(active?'var(--g)':'var(--b)')+';cursor:pointer" onclick="editBlock('+i+')">'+
      '<div class="row between"><span class="mono fw fz">'+i+'</span><div class="row gap-2">'+(active?'<span class="dot live"></span>':'')+'<button class="btn s red" onclick="delBlock('+i+')">×</button></div></div>'+
      '<div class="mono fz mt" style="color:var(--cy)">'+b.type+'</div>'+
      '<div class="dim fz" style="margin-top:4px">'+Object.keys(b.params||{}).map(function(k){return k+': '+b.params[k];}).join(' · ')+'</div>'+
    '</div>';
  }).join('')+'</div>';
}

window.editBlock=function(i){var b=S.dbot.blocks[i];var params=Object.keys(b.params||{}).map(function(k){return k+'='+b.params[k];}).join('\n');var newParams=prompt('Edit block '+i+' params:\n\n'+params+'\n\nEnter new values (key=value):');if(newParams){newParams.split('\n').forEach(function(line){var p=line.split('=');if(p.length===2)b.params[p[0].trim()]=p[1].trim();});save();renderDBot();}};

window.delBlock=function(i){S.dbot.blocks.splice(i,1);renderDBot();};

window.addBlock=function(){var t=prompt('Block type:\n- before_purchase\n- purchase\n- logic\n- math');if(!t)return;S.dbot.blocks.push({type:t,params:{},id:Date.now()});renderDBot();};

window.loadSavedBot=function(i){var b=S.savedBots[i];if(b&&b.xml){$('botXml').value=b.xml;parseBot();toast('Loaded: '+b.name,'success');}};

window.delSavedBot=function(i){if(confirm('Delete bot?')){S.savedBots.splice(i,1);save();renderDBot();}};

window.exportBot=function(){if(S.dbot.blocks.length===0){toast('No bot to export','error');return;}var xml='<xml>\n'+S.dbot.blocks.map(function(b){return '  <block type="'+b.type+'">\n    '+Object.keys(b.params||{}).map(function(k){return '<field name="'+k.toUpperCase()+'">'+b.params[k]+'</field>';}).join('\n    ')+'\n  </block>';}).join('\n')+'\n</xml>';var name=prompt('Bot name?','MyBot');if(name){S.savedBots.push({name:name,xml:xml,time:Date.now()});save();renderDBot();toast('Saved!','success');}var blob=new Blob([xml],{type:'text/xml'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name+'.xml';a.click();};

window.loadBotFile=function(e){var f=e.target.files[0];if(!f)return;var r=new FileReader();r.onload=function(ev){$('botXml').value=ev.target.result;toast('File loaded','success');};r.readAsText(f);};

function parseBot(){
  var xml=$('botXml').value.trim();
  if(!xml){toast('Paste XML first','error');return;}
  // Simple XML parser - extract blocks
  var blocks=[];
  var blockRegex=/<block\s+type="([^"]+)"[^>]*>([\s\S]*?)<\/block>/g;
  var match;
  while((match=blockRegex.exec(xml))!==null){
    var type=match[1];
    var content=match[2];
    var params={};
    var fieldRegex=/<field\s+name="([^"]+)"[^>]*>([^<]*)<\/field>/g;
    var fm;
    while((fm=fieldRegex.exec(content))!==null){params[fm[1].toLowerCase()]=fm[2];}
    blocks.push({type:type,params:params,id:Date.now()+Math.random()});
  }
  if(blocks.length===0){toast('No blocks found in XML','error');return;}
  S.dbot.blocks=blocks;
  // Auto-save
  var name=prompt('Save bot as:','ImportedBot')||'ImportedBot';
  S.savedBots=SavedBots.filter(function(b){return b.name!==name;});
  S.savedBots.push({name:name,xml:xml,time:Date.now()});
  save();
  renderDBot();
  toast('Loaded '+blocks.length+' blocks','success');
}
var SavedBots=[]; // workaround

window.runBot=function(){if(!S.auth){toast('Connect first','error');openConn();return;}if(S.dbot.running){toast('Already running','error');return;}if(S.dbot.blocks.length===0){toast('No blocks','error');return;}S.dbot.running=true;S.dbot.currentBlock=0;S.dbot.logs=[];botLog('Bot started','info');executeBotBlock();renderDBot();};

window.stopBot=function(){S.dbot.running=false;botLog('Bot stopped','info');renderDBot();};

function executeBotBlock(){
  if(!S.dbot.running)return;
  if(S.dbot.currentBlock>=S.dbot.blocks.length){botLog('Bot finished','success');S.dbot.running=false;renderDBot();return;}
  var b=S.dbot.blocks[S.dbot.currentBlock];
  botLog('Block '+S.dbot.currentBlock+': '+b.type,'info');
  if(b.type==='purchase'){
    S.sel.c=b.params.contract_type==='UNDER'?'DIGITUNDER':'DIGITOVER';
    S.sel.b=b.params.barrier||'0';
    var stake=parseFloat(b.params.amount)||1;
    if(stake>S.cfg.maxStake){botLog('Stake exceeds max','error');S.dbot.running=false;renderDBot();return;}
    if(S.acc.bal>0&&stake>S.acc.bal){botLog('Insufficient balance','error');S.dbot.running=false;renderDBot();return;}
    send({proposal:1,amount:String(stake),basis:'stake',contract_type:S.sel.c,currency:S.acc.cur,duration:1,duration_unit:'t',symbol:b.params.symbol||S.sym,barrier:String(S.sel.b)});
    setTimeout(function(){
      if(S.pid){send({buy:S.pid,price:S.pdata.ask_price});botLog('Bought '+S.sel.c+' '+S.sel.b,'success');}
      S.dbot.currentBlock++;
      setTimeout(executeBotBlock,2000);
    },800);
  } else {
    setTimeout(function(){S.dbot.currentBlock++;executeBotBlock();},500);
  }
}

function botLog(msg,type){S.dbot.logs.push({msg:msg,t:type||'info',time:Date.now()});if(S.dbot.logs.length>50)S.dbot.logs.shift();renderDBot();}

// ============================================
// SETTINGS
// ============================================
function openModal(t,b){$('mtitle').textContent=t;$('mbody').innerHTML=b;$('modal').classList.add('on');}
function closeModal(){$('modal').classList.remove('on');}
function openConn(){openModal('Connect Deriv','<p class="dim fz mb">Enter your Deriv API token</p><input type="password" class="input mb" id="tIn" placeholder="API Token" value="'+(S.cfg.token||'')+'" style="margin-bottom:10px"><button class="btn b1 big w" onclick="doConn()">⚡ Connect</button>');setTimeout(function(){$('tIn')&&$('tIn').focus();},100);}
function doConn(){var t=$('tIn').value.trim();if(!t){toast('Enter token','error');return;}S.cfg.token=t;$('st').value=t;save();closeModal();if(S.ready){send({authorize:t});}else{conn();setTimeout(function(){if(S.ready)send({authorize:t});},1500);}}
$('modal').addEventListener('click',function(e){if(e.target.id==='modal')closeModal();});
function applyS(){$('st').value=S.cfg.token||'';$('ss').value=S.cfg.sym;$('smax').value=S.cfg.maxStake;$('stake').value='1';}
function saveS(){S.cfg.token=$('st').value.trim();S.cfg.sym=$('ss').value;S.cfg.maxStake=parseFloat($('smax').value)||10;save();if(S.cfg.sym!==S.sym){setSym(S.cfg.sym);}if(S.cfg.token&&S.ready&&!S.auth)send({authorize:S.cfg.token});}
function setSym(s){S.sym=s;$('sym').textContent=s;$('ss').value=s;S.cfg.sym=s;save();S.ticks=[];S.df=Array(10).fill(0);S.last=null;if(S.ready)subTicks();}
function clrH(){if(confirm('Clear history?')){S.hist=[];save();renderH();renderHome();}}
function reset(){if(confirm('Reset ALL?')){S.hist=[];S.acc.pl=0;S.modeHistory={};S.savedBots=[];S.cfg={maxStake:10,token:'',sym:'R_100'};save();applyS();renderH();renderHome();renderModes();renderDBot();toast('Reset','success');}}

// ============================================
// INIT
// ============================================
function init(){
  load();
  SavedBots=S.savedBots; // sync
  applyS();
  S.auto.lad=buildL();
  aUpdate();
  // Pre-select triple mode
  selMode('triple');
  setSym(S.cfg.sym||'R_100');
  renderHome();
  conn();
  setInterval(function(){if(S.ready&&S.auth)reqProp();},5000);
  setInterval(function(){renderHome();},2000);
}

// START WITH BOOT
runBoot();
