import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

import { firebaseConfig } from './firebase-config.js';


const DB_ROOT = 'tournament';
const DEFAULT_MAPS=[
  'Miasto Aniołów',
  'Wybuchowo',
  'Kolonia',
  'Kompleks',
  'Miejsce Katastrofy',
  'Suchy Dok',
  'Eden',
  'Egzoplaneta',
  'Błąd',
  'Gry Wojenne'
];
const DEFAULT_STATE={players:[],teams:[],maps:[...DEFAULT_MAPS],matches:[],settings:{version:'v24-admin-mode'}};
let state=structuredClone(DEFAULT_STATE);
let db=null;
let firebaseReady=false;
let isRemoteRendering=false;
const ADMIN_PASSWORD='admin';
let isAdmin=sessionStorage.getItem('tf2_lts_admin')==='1';

function hasFirebaseConfig(){return firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('WKLEJ_TUTAJ') && firebaseConfig.databaseURL && !firebaseConfig.databaseURL.includes('WKLEJ_TUTAJ')}
function cleanState(input){return {players:Array.isArray(input?.players)?input.players:[],teams:Array.isArray(input?.teams)?input.teams:[],maps:Array.isArray(input?.maps)&&input.maps.length?input.maps:[...DEFAULT_MAPS],matches:Array.isArray(input?.matches)?input.matches:[],settings:input?.settings||{version:'v24-admin-mode'},undoByMatch:input?.undoByMatch||{}}}
function exportState(){return cleanState(state)}
async function persistState(){
  if(firebaseReady&&db){
    try{
      await set(ref(db,DB_ROOT),exportState());
      return true;
    }catch(err){
      console.error('Firebase save error:',err);
      alert('Nie udało się zapisać zmian w Firebase. Sprawdź Rules i databaseURL.');
      return false;
    }
  }
  return true;
}
function save(){
  syncTeamSlots();
  render();
  if(!isRemoteRendering)persistState();
}
function uid(p){return p+'_'+Date.now()+'_'+Math.random().toString(16).slice(2)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function applyAdminMode(){
  document.body.classList.toggle('admin',isAdmin);
  const badge=document.getElementById('adminBadge');
  if(badge){badge.textContent=isAdmin?'Tryb administratora':'Tryb gracza';badge.classList.toggle('on',isAdmin)}
  const btn=document.getElementById('adminToggleBtn');
  if(btn)btn.textContent=isAdmin?'Wyloguj admina':'Panel administratora';
}
function requireAdmin(){if(isAdmin)return true;alert('Ta funkcja jest dostępna tylko dla administratora.');return false}
function openAdminModal(){
  if(isAdmin){isAdmin=false;sessionStorage.removeItem('tf2_lts_admin');applyAdminMode();render();return}
  document.getElementById('adminModal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('adminPasswordInput')?.focus(),0);
}
function closeAdminModal(){document.getElementById('adminModal').classList.add('hidden')}
function loginAdmin(){
  const input=document.getElementById('adminPasswordInput');
  if((input?.value||'')!==ADMIN_PASSWORD){alert('Nieprawidłowe hasło administratora.');return}
  isAdmin=true;sessionStorage.setItem('tf2_lts_admin','1');
  if(input)input.value='';
  closeAdminModal();applyAdminMode();render();
}
const TAB_DESCRIPTIONS={
  draft:'Draft kapitański: organizator wybiera kapitanów na bazie umiejętności, a następnie kapitanowie wybierają graczy z puli pozostałych zawodników do swoich zespołów, zaczynając od najsłabszego kapitana i kończąc na najlepszym. Po drafcie przejdź do rozstawienia, gdzie ustawisz seedy drużyn metodą drag & drop przed wygenerowaniem drabinki.',
  bracket:'Drabinka działa w systemie podwójnej eliminacji: pierwsza porażka przenosi drużynę do drabinki przegranych, a druga eliminuje ją z turnieju. Mapy, na których będzie grany dany mecz, są wypisane pod każdą komórką turniejową.',
  maps:'Mapy są losowane automatycznie z przygotowanej puli. System ogranicza powtarzalność: mapa, która była już użyta, ma mniejszą szansę ponownego wylosowania, dopóki nie zostanie wykorzystana cała pula, po czym cykl zaczyna się od nowa.',
  rules:'',
  seeding:'Ustaw seedy drużyn metodą drag & drop. Wyższy seed oznacza korzystniejsze rozstawienie w drabince, w tym możliwy wolny awans przy liczbie drużyn niebędącej potęgą dwójki.'
};
function setTab(id){
  document.querySelectorAll('.tabView').forEach(x=>x.classList.add('hidden'));
  const view=document.getElementById('view-'+id);
  if(view)view.classList.remove('hidden');
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));
  const tab=document.getElementById('tab-'+id);
  if(tab)tab.classList.add('active');
  const desc=document.getElementById('tabDescription');
  if(desc){
    desc.textContent=TAB_DESCRIPTIONS[id]||'';
    desc.classList.toggle('hidden',!TAB_DESCRIPTIONS[id]);
  }
}

function openSeedingStage(){
  if(!requireAdmin())return;
  if(validTeams().length<2){alert('Potrzebujesz minimum 2 pełnych teamów.');return}
  setTab('seeding');
  renderSeeding();
}
function syncTeamSlots(){let need=Math.ceil(state.players.length/2);while(state.teams.length<need)state.teams.push({id:uid('t'),name:'Team '+(state.teams.length+1),players:[]});while(state.teams.length>need){let t=state.teams.pop();t.players.forEach(pid=>{let p=state.players.find(x=>x.id===pid);if(p)p.teamId=null})}}
function addPlayer(){if(!requireAdmin())return;let el=document.getElementById('playerName'),name=el.value.trim();if(!name)return;state.players.push({id:uid('p'),name,teamId:null});el.value='';save()}
function removePlayer(id){if(!requireAdmin())return;state.players=state.players.filter(p=>p.id!==id);state.teams.forEach(t=>t.players=t.players.filter(pid=>pid!==id));save()}
function setTeamName(id,val){let t=state.teams.find(x=>x.id===id);if(t){t.name=val.trim()||'Team';save()}}
function movePlayer(pid,teamId){if(!requireAdmin())return;let p=state.players.find(x=>x.id===pid);if(!p)return;state.teams.forEach(t=>t.players=t.players.filter(id=>id!==pid));if(teamId==='free'){p.teamId=null;save();return}let t=state.teams.find(x=>x.id===teamId);if(!t||t.players.length>=2){save();return}p.teamId=teamId;t.players.push(pid);save()}
function teamDisplay(t){return (t.name||'Team')+' — '+t.players.map(id=>state.players.find(p=>p.id===id)?.name||'?').join(' + ')}
function validTeams(){return state.teams.filter(t=>t.players.length===2).map(t=>({id:t.id,name:teamDisplay(t)}))}
function shuffle(a){return a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(x=>x[1])}
function normalizeMatches(){state.matches.forEach(m=>{if(!m.maps)m.maps=m.map?[m.map]:drawMaps(3);while(m.maps.length<3)m.maps.push(drawMap(m.maps));delete m.map})}
function playedMapCount(m){if(!m.done)return 0;let a=parseInt(m.scoreA,10),b=parseInt(m.scoreB,10);if(Number.isNaN(a)||Number.isNaN(b))return 3;if((a===2&&b===0)||(b===2&&a===0))return 2;if((a===2&&b===1)||(b===2&&a===1))return 3;return 3}
function mapUsage(){let u={};state.maps.forEach(m=>u[m]=0);state.matches.forEach(m=>{(m.maps||[]).slice(0,playedMapCount(m)).forEach(mp=>u[mp]=(u[mp]||0)+1)});return u}
function drawMap(exclude=[]){if(!state.maps.length)return 'Brak map';let u=mapUsage(),available=state.maps.filter(m=>!exclude.includes(m));if(!available.length)available=[...state.maps];let min=Math.min(...available.map(m=>u[m]||0));let pool=available.filter(m=>(u[m]||0)===min);return pool[Math.floor(Math.random()*pool.length)]}
function drawMaps(count=3){let picked=[];for(let i=0;i<count;i++)picked.push(drawMap(picked));return picked}
function getTeamObj(id){let t=state.teams.find(x=>x.id===id);return t?{id:t.id,name:teamDisplay(t)}:null}
function nextPowerOfTwo(n){let p=1;while(p<n)p*=2;return p}
function bracketSeedOrder(size){
  let order=[1,2];
  while(order.length<size){
    const next=order.length*2+1;
    order=order.flatMap(x=>[x,next-x]);
  }
  return order;
}
function makeParticipant(team){return team?{kind:'team',id:team.id,name:team.name}:null}
function participantName(part){
  if(!part)return 'Oczekuje';
  if(part.kind==='team')return part.name;
  if(part.kind==='source')return (part.type==='loser'?'Przegrany':'Zwycięzca')+' meczu '+part.no;
  return 'Oczekuje';
}
function participantId(part){return part&&part.kind==='team'?part.id:null}
function makeSource(match,type='winner'){return match?{kind:'source',matchId:match.id,no:match.no,type}:null}
function addRoute(sourceId,type,targetId,slot){
  const source=state.matches.find(x=>x.id===sourceId);
  if(!source)return;
  source.routes ||= [];
  if(!source.routes.some(r=>r.type===type&&r.targetId===targetId&&r.slot===slot)){
    source.routes.push({type,targetId,slot});
  }
}
function setMatchSideFromParticipant(m,side,part){
  const id=participantId(part);
  if(side==='a'){
    m.a=id;
    m.aName=participantName(part);
    m.aSource=part&&part.kind==='source'?part.matchId:null;
    m.aSourceType=part&&part.kind==='source'?part.type:null;
  }else{
    m.b=id;
    m.bName=participantName(part);
    m.bSource=part&&part.kind==='source'?part.matchId:null;
    m.bSourceType=part&&part.kind==='source'?part.type:null;
  }
  if(part&&part.kind==='source')addRoute(part.matchId,part.type,m.id,side);
}
function createMatch(bracket,round,aPart,bPart){
  const no=state.matches.length+1;
  let m={id:uid('m'),no,bracket,round,a:null,b:null,aName:'Oczekuje',bName:'Oczekuje',aSource:null,bSource:null,aSourceType:null,bSourceType:null,routes:[],scoreA:'',scoreB:'',winner:null,loser:null,maps:drawMaps(3),done:false};
  state.matches.push(m);
  setMatchSideFromParticipant(m,'a',aPart);
  setMatchSideFromParticipant(m,'b',bPart);
  return m;
}
function generateBracket(){
  if(!requireAdmin())return;
  let teams=validTeams();
  if(teams.length<2){alert('Potrzebujesz minimum 2 pełnych teamów.');return}
  state.matches=[];
  state.undoByMatch={};
  const size=nextPowerOfTwo(teams.length);
  generateWinnerBracket(teams,size);
  generateLoserBracket(size);
  generateGrandFinalShell();
  setTab('bracket');
  save();
}
function generateWinnerBracket(teams,size){
  const seedOrder=bracketSeedOrder(size);
  const bySeed={};
  teams.forEach((t,i)=>bySeed[i+1]=t);
  let slots=seedOrder.map(seed=>makeParticipant(bySeed[seed]||null));
  let round=1;
  while(slots.length>1){
    let nextSlots=[];
    for(let i=0;i<slots.length;i+=2){
      let a=slots[i], b=slots[i+1];
      if(!a&&!b){nextSlots.push(null);continue;}
      if(a&&!b){nextSlots.push(a);continue;}
      if(!a&&b){nextSlots.push(b);continue;}
      let m=createMatch('WB',round,a,b);
      nextSlots.push(makeSource(m,'winner'));
    }
    slots=nextSlots;
    round++;
  }
}
function matchesByRound(bracket){
  const out={};
  state.matches.filter(m=>m.bracket===bracket).forEach(m=>(out[m.round] ||= []).push(m));
  Object.values(out).forEach(arr=>arr.sort((a,b)=>a.no-b.no));
  return out;
}
function generateLoserBracket(size){
  const wb=matchesByRound('WB');
  const wbRounds=Object.keys(wb).map(Number).sort((a,b)=>a-b);
  if(!wbRounds.length)return;
  const wbFinal=wb[wbRounds.at(-1)]?.[0];

  if(size<=2){return;}

  if(size===4){
    const r1=wb[1]||[];
    const r2=wb[2]||[];
    if(r1.length>=2){
      const lb1=createMatch('LB',1,makeSource(r1[0],'loser'),makeSource(r1[1],'loser'));
      if(r2[0])createMatch('LB',2,makeSource(r2[0],'loser'),makeSource(lb1,'winner'));
    }else if(r1.length===1&&r2[0]){
      createMatch('LB',1,makeSource(r2[0],'loser'),makeSource(r1[0],'loser'));
    }
    return;
  }

  if(size===8){
    const r1=wb[1]||[];
    const r2=wb[2]||[];
    const r3=wb[3]||[];
    let lbRound1=[];

    if(r1.length===1 && r2.length>=2){
      // Challonge-style for 5 teams: loser from the only R1 match meets the loser from the opposite R2 semifinal.
      lbRound1.push(createMatch('LB',1,makeSource(r2[1],'loser'),makeSource(r1[0],'loser')));
      const lb2=createMatch('LB',2,makeSource(r2[0],'loser'),makeSource(lbRound1[0],'winner'));
      if(r3[0])createMatch('LB',3,makeSource(r3[0],'loser'),makeSource(lb2,'winner'));
      return;
    }

    if(r1.length===2 && r2.length>=2){
      lbRound1.push(createMatch('LB',1,makeSource(r1[0],'loser'),makeSource(r1[1],'loser')));
      const lb2a=createMatch('LB',2,makeSource(r2[0],'loser'),makeSource(lbRound1[0],'winner'));
      const lb2b=createMatch('LB',2,makeSource(r2[1],'loser'),null);
      const lb3=createMatch('LB',3,makeSource(lb2a,'winner'),makeSource(lb2b,'winner'));
      if(r3[0])createMatch('LB',4,makeSource(r3[0],'loser'),makeSource(lb3,'winner'));
      return;
    }

    if(r1.length>=4){
      lbRound1.push(createMatch('LB',1,makeSource(r1[0],'loser'),makeSource(r1[1],'loser')));
      lbRound1.push(createMatch('LB',1,makeSource(r1[2],'loser'),makeSource(r1[3],'loser')));
      const lb2a=createMatch('LB',2,makeSource(r2[0],'loser'),makeSource(lbRound1[0],'winner'));
      const lb2b=createMatch('LB',2,makeSource(r2[1],'loser'),makeSource(lbRound1[1],'winner'));
      const lb3=createMatch('LB',3,makeSource(lb2a,'winner'),makeSource(lb2b,'winner'));
      if(r3[0])createMatch('LB',4,makeSource(r3[0],'loser'),makeSource(lb3,'winner'));
      return;
    }
  }

  // Fallback for larger brackets: create a sane, complete losers bracket skeleton.
  let carry=[];
  for(let r=1;r<wbRounds.length;r++){
    const losers=(wb[r]||[]).map(m=>makeSource(m,'loser'));
    const entries=[...carry,...losers].filter(Boolean);
    carry=[];
    for(let i=0;i<entries.length;i+=2){
      if(entries[i+1])carry.push(makeSource(createMatch('LB',r,entries[i],entries[i+1]),'winner'));
      else carry.push(entries[i]);
    }
  }
  const finalLoser=wbFinal?makeSource(wbFinal,'loser'):null;
  if(finalLoser&&carry[0])createMatch('LB',wbRounds.length,finalLoser,carry[0]);
}
function generateGrandFinalShell(){
  const wb=matchesByRound('WB');
  const lb=matchesByRound('LB');
  const wbRounds=Object.keys(wb).map(Number).sort((a,b)=>a-b);
  const lbRounds=Object.keys(lb).map(Number).sort((a,b)=>a-b);
  const wbFinal=wb[wbRounds.at(-1)]?.[0];
  const lbFinal=lb[lbRounds.at(-1)]?.[0];
  if(wbFinal&&lbFinal){
    createMatch('GF',1,makeSource(wbFinal,'winner'),makeSource(lbFinal,'winner'));
  }
}
function placeTeamInTargets(match,type,team){
  if(!match||!team||!match.routes)return;
  match.routes.filter(r=>r.type===type).forEach(r=>{
    const target=state.matches.find(x=>x.id===r.targetId);
    if(!target)return;
    if(r.slot==='a'){
      target.a=team.id;
      target.aName=team.name;
      // Zachowujemy źródło slotu nawet po wstawieniu drużyny.
      // Dzięki temu reset wcześniejszego meczu wie, które dalsze komórki wyczyścić.
      target.aSource=match.id;
      target.aSourceType=type;
    }else{
      target.b=team.id;
      target.bName=team.name;
      target.bSource=match.id;
      target.bSourceType=type;
    }
    autoAdvanceIfSolo(target);
  });
}
function autoAdvanceIfSolo(m){
  if(!m||m.done)return;
  const hasA=!!m.a, hasB=!!m.b;
  const waitsA=!!m.aSource, waitsB=!!m.bSource;
  if(hasA&&!hasB&&!waitsB&&m.bName==='Oczekuje'){
    m.done=true;m.winner=m.a;m.loser=null;
    placeTeamInTargets(m,'winner',getTeamObj(m.a));
  }else if(hasB&&!hasA&&!waitsA&&m.aName==='Oczekuje'){
    m.done=true;m.winner=m.b;m.loser=null;
    placeTeamInTargets(m,'winner',getTeamObj(m.b));
  }
}
function updateScore(id,side,val){let m=state.matches.find(x=>x.id===id);if(m)m['score'+side]=val;save()}
function snapshotState(){let copy=JSON.parse(JSON.stringify(state));delete copy.undoByMatch;return JSON.stringify(copy)}
function rememberUndo(id){state.undoByMatch ||= {};state.undoByMatch[id]=snapshotState()}
function undoMatch(id){if(!state.undoByMatch||!state.undoByMatch[id])return;let restore=JSON.parse(state.undoByMatch[id]);state=restore;save()}
function submitMatch(id,winnerId,fromModal=false,scoreA=null,scoreB=null){if(!requireAdmin())return;
  let m=state.matches.find(x=>x.id===id);
  if(!m||!m.a||!m.b)return;
  rememberUndo(id);
  if(m.done){
    resetMatchAndDescendants(id);
    m=state.matches.find(x=>x.id===id);
    if(!m||!m.a||!m.b)return;
  }
  let loserId=winnerId===m.a?m.b:m.a;
  m.scoreA=scoreA!==null?scoreA:(m.scoreA||'');
  m.scoreB=scoreB!==null?scoreB:(m.scoreB||'');
  m.winner=winnerId;
  m.loser=loserId;
  m.done=true;
  let winner=getTeamObj(winnerId),loser=getTeamObj(loserId);
  placeTeamInTargets(m,'winner',winner);
  placeTeamInTargets(m,'loser',loser);
  if(m.bracket==='GF')handleGrandFinal(m,winner,loser);
  save();
}
function handleGrandFinal(m,winner,loser){
  // In double elimination, the LB team must beat the unbeaten WB team twice.
  if(m.round===1&&winner&&winner.id===m.b&&!state.matches.some(x=>x.bracket==='GF'&&x.round===2)){
    createMatch('GF',2,makeParticipant(getTeamObj(m.a)),makeParticipant(getTeamObj(m.b)));
  }
}
function maybeGrandFinal(){}
function lastWinner(bracket){let done=state.matches.filter(m=>m.bracket===bracket&&m.done&&m.winner).sort((a,b)=>b.round-a.round);return done[0]?getTeamObj(done[0].winner):null}
function addMap(){if(!requireAdmin())return;let el=document.getElementById('mapName'),n=el.value.trim();if(n&&!state.maps.includes(n))state.maps.push(n);el.value='';save()}
function bulkAddMaps(){if(!requireAdmin())return;document.getElementById('bulkMaps').value.split('\n').map(x=>x.trim()).filter(Boolean).forEach(m=>{if(!state.maps.includes(m))state.maps.push(m)});document.getElementById('bulkMaps').value='';save()}
function removeMap(m){if(!requireAdmin())return;state.maps=state.maps.filter(x=>x!==m);save()}
async function resetAll(){
  if(!requireAdmin())return;
  if(!confirm('Na pewno zresetować cały turniej? Tej operacji nie da się cofnąć.'))return;
  state=structuredClone(DEFAULT_STATE);
  render();
  const ok=await persistState();
  if(ok)alert('Turniej został zresetowany.');
}

function fullTeamInfo(teamId){
  const t=state.teams.find(x=>x.id===teamId);
  if(!t)return null;
  const players=t.players.map(pid=>state.players.find(p=>p.id===pid)?.name).filter(Boolean);
  return {team:t,players};
}
function seedingDragStart(ev,teamId){
  if(!isAdmin)return;
  ev.dataTransfer.setData('application/x-seed-team-id',teamId);
  ev.dataTransfer.effectAllowed='move';
}
function seedingDragOver(ev){
  if(!isAdmin)return;
  if(!ev.dataTransfer.types.includes('application/x-seed-team-id'))return;
  ev.preventDefault();
  ev.currentTarget.classList.add('seedDropHover');
}
function seedingDragLeave(ev){ev.currentTarget.classList.remove('seedDropHover')}
function seedingDrop(ev,targetTeamId){
  if(!isAdmin)return;
  if(!ev.dataTransfer.types.includes('application/x-seed-team-id'))return;
  ev.preventDefault();
  ev.currentTarget.classList.remove('seedDropHover');
  const sourceTeamId=ev.dataTransfer.getData('application/x-seed-team-id');
  if(!sourceTeamId||sourceTeamId===targetTeamId)return;
  const a=state.teams.findIndex(t=>t.id===sourceTeamId);
  const b=state.teams.findIndex(t=>t.id===targetTeamId);
  if(a<0||b<0)return;
  const tmp=state.teams[a];
  state.teams[a]=state.teams[b];
  state.teams[b]=tmp;
  save();
  renderSeeding();
}
function dragStart(ev,pid){if(!isAdmin)return;ev.dataTransfer.setData('text/plain',pid);ev.dataTransfer.effectAllowed='move'}
function allowDrop(ev){if(!isAdmin)return;ev.preventDefault();ev.currentTarget.classList.add('dropHover')}
function leaveDrop(ev){ev.currentTarget.classList.remove('dropHover')}
function dropTo(ev,teamId){if(!isAdmin)return;ev.preventDefault();ev.currentTarget.classList.remove('dropHover');let pid=ev.dataTransfer.getData('text/plain');movePlayer(pid,teamId)}
function renderPlayers(){
  syncTeamSlots();
  let free=state.players.filter(p=>!p.teamId);
  document.getElementById('freePlayers').innerHTML=(free.map(p=>{
    const drag=isAdmin?` draggable="true" ondragstart="dragStart(event,'${p.id}')"`:'';
    const remove=isAdmin?` <button class="danger" style="float:right;padding:1px 6px" onclick="removePlayer('${p.id}')">×</button>`:'';
    return `<div class="playerCard"${drag}>${esc(p.name)}${remove}</div>`;
  }).join('')||'<p class="small">Brak wolnych graczy.</p>');
  const freeBox=document.getElementById('freePlayers');
  freeBox.ondragover=isAdmin?allowDrop:null;
  freeBox.ondragleave=isAdmin?leaveDrop:null;
  freeBox.ondrop=isAdmin?(e=>dropTo(e,'free')):null;
}

function renderSeeding(){
  const box=document.getElementById('seedingList');
  if(!box)return;
  const full=state.teams.filter(t=>t.players.length===2);
  if(full.length<2){box.innerHTML='<p class="small">Potrzebujesz minimum 2 pełnych teamów.</p>';return}
  const size=nextPowerOfTwo(full.length);
  const byeCount=size-full.length;
  box.innerHTML=full.map((t,idx)=>{
    const players=t.players.map(pid=>state.players.find(p=>p.id===pid)?.name).filter(Boolean).join(' / ');
    const bye=idx<byeCount?'<span class="seedByeHint">prawdopodobny wolny awans</span>':'<span class="seedByeHint">start w pierwszej rundzie</span>';
    const drag=isAdmin?` draggable="true" ondragstart="seedingDragStart(event,'${t.id}')" ondragover="seedingDragOver(event)" ondragleave="seedingDragLeave(event)" ondrop="seedingDrop(event,'${t.id}')"`:'';
    return `<div class="seedRowCard"${drag}><div class="seedIndex">Seed ${idx+1}</div><div><div class="seedTeamName">${esc(t.name||'Team')}</div><div class="seedPlayers">${esc(players)}</div></div>${bye}</div>`;
  }).join('');
}
function renderTeams(){
  document.getElementById('teams').innerHTML=state.teams.map((t,idx)=>`<div class="team"><input class="teamName" value="${esc(t.name)}" onchange="setTeamName('${t.id}',this.value)">${[0,1].map(i=>{let p=state.players.find(x=>x.id===t.players[i]);let slotHandlers=isAdmin?` ondragover="allowDrop(event)" ondragleave="leaveDrop(event)" ondrop="dropTo(event,'${t.id}')"`:'';if(p){let drag=isAdmin?` draggable="true" ondragstart="dragStart(event,'${p.id}')"`:'';let remove=isAdmin?`<button class="remove" onclick="movePlayer('${p.id}','free')">×</button>`:'';return `<div class="slot dropZone full"${slotHandlers}><span${drag} class="${i===0?'captain':''}">${esc(p.name)}</span>${remove}</div>`}return `<div class="slot dropZone"${slotHandlers}><span>Slot ${i+1}</span></div>`}).join('')}<span class="status">${t.players.length}/2</span></div>`).join('')
}
function groupRounds(bracket){let rounds={};state.matches.filter(m=>m.bracket===bracket).forEach(m=>{(rounds[m.round] ||= []).push(m)});return Object.keys(rounds).map(Number).sort((a,b)=>a-b).map(r=>({round:r,matches:rounds[r]}))}
function matchConnectInfo(match, bracket){
  const sameBoardRoutes=(match.routes||[]).filter(r=>{
    const target=state.matches.find(x=>x.id===r.targetId);
    return target&&target.bracket===bracket&&target.round>match.round;
  });
  const route=sameBoardRoutes[0]||null;
  const hasNext=!!route;
  let nextClass='';
  if(route){
    const target=state.matches.find(x=>x.id===route.targetId);
    const sources=[target.aSource,target.bSource].filter(Boolean);
    const siblingCount=sources.filter(id=>{
      const src=state.matches.find(x=>x.id===id);
      return src&&src.bracket===bracket&&src.round===match.round;
    }).length;
    if(siblingCount>=2){
      nextClass = route.slot==='a' ? 'pairTop' : 'pairBottom';
    }else{
      nextClass = 'singleNext';
    }
  }
  const hasPrev=[match.aSource,match.bSource].some(id=>{
    const src=state.matches.find(x=>x.id===id);
    return src&&src.bracket===bracket&&src.round<match.round;
  });
  return {hasNext,hasPrev,nextClass};
}
function renderBoard(bracket,el,prefix){let rounds=groupRounds(bracket);let board=document.getElementById(el);if(!rounds.length){board.innerHTML='<p class="small">Brak meczów.</p>';return}let cols='<div class="bracketBoard" data-board="'+bracket+'"><svg class="bracketSvg"></svg>'+rounds.map((r,i)=>`<div class="round r${Math.min(i+1,5)}"><div class="roundTitle">${prefix} ${r.round}</div><div class="roundMatches">${r.matches.map((m,mi)=>renderMatch(m,matchConnectInfo(m,bracket))).join('')}</div></div>`).join('')+'</div>';board.innerHTML=cols}
function renderFinalArea(){let gfRounds=groupRounds('GF');let sec=document.getElementById('gfSection');let top=document.getElementById('top3Board');top.innerHTML='';if(!gfRounds.length){sec.classList.add('hidden');return}sec.classList.remove('hidden');let board=document.getElementById('gfBoard');let cols='<div class="bracketBoard" data-board="GF"><svg class="bracketSvg"></svg>'+gfRounds.map((r,i)=>`<div class="round r${Math.min(i+1,5)}"><div class="roundTitle">Mecz finałowy ${r.round}</div><div class="roundMatches">${r.matches.map((m,mi)=>renderMatch(m,matchConnectInfo(m,'GF'))).join('')}${i===gfRounds.length-1?renderTop3():''}</div></div>`).join('')+'</div>';board.innerHTML=cols}
function finalMatch(){let gfs=state.matches.filter(m=>m.bracket==='GF'&&m.done&&m.winner).sort((a,b)=>b.round-a.round);if(!gfs.length)return null;let last=gfs[0];if(last.round===1&&last.winner===last.b)return null;return last}
function renderTop3(){let fm=finalMatch();if(!fm)return '';let thirdMatch=state.matches.filter(m=>m.bracket==='LB'&&m.done&&m.loser).sort((a,b)=>b.round-a.round)[0];let rows=[['1',getTeamObj(fm.winner)?.name||''],['2',getTeamObj(fm.loser)?.name||''],['3',thirdMatch?(getTeamObj(thirdMatch.loser)?.name||''):'' ]].filter(r=>r[1]);return `<div class="top3Box"><h3>🏆 Zwycięzcy turnieju</h3>${rows.map(r=>`<div class="podiumRow"><span class="podiumPlace">${r[0]}.</span><span>${esc(r[1])}</span></div>`).join('')}</div>`}
function teamCellHtml(id,fallback){let t=state.teams.find(x=>x.id===id);if(t){let players=t.players.map(pid=>state.players.find(p=>p.id===pid)?.name).filter(Boolean).join(' / ');return `<span class="teamCellName">${esc(t.name||'Team')}</span>${players?`<span class="teamCellPlayers">${esc(players)}</span>`:''}`}let txt=String(fallback||'Oczekuje');let parts=txt.split(' — ');if(parts.length>1){return `<span class="teamCellName">${esc(parts[0])}</span><span class="teamCellPlayers">${esc(parts.slice(1).join(' — ').replace(/\s*\+\s*/g,' / '))}</span>`}return `<span class="teamCellName">${esc(txt)}</span>`}
let activeModalMatchId=null;
let activeModalWinnerSide=null;
function openMatchModal(id){
  if(!requireAdmin())return;
  const m=state.matches.find(x=>x.id===id);
  if(!m||!m.a||!m.b)return;
  activeModalMatchId=id;
  activeModalWinnerSide=m.winner===m.a?'a':(m.winner===m.b?'b':null);
  document.getElementById('modalMatchNo').textContent=m.no||'';
  document.getElementById('modalTeamA').innerHTML=teamCellHtml(m.a,m.aName);
  document.getElementById('modalTeamB').innerHTML=teamCellHtml(m.b,m.bName);
  document.getElementById('modalScoreA').value=m.scoreA??'';
  document.getElementById('modalScoreB').value=m.scoreB??'';
  document.getElementById('modalMaps').innerHTML='Mapy: '+(m.maps||[]).map((mp,i)=>`<b>${i+1}. ${esc(mp)}</b>`).join(' &nbsp; ');
  updateWinnerButtons();
  document.getElementById('matchModal').classList.remove('hidden');
}
function closeMatchModal(){document.getElementById('matchModal').classList.add('hidden');activeModalMatchId=null;activeModalWinnerSide=null}
function pickModalWinner(side){activeModalWinnerSide=side;updateWinnerButtons()}
function updateWinnerButtons(){
  document.getElementById('modalWinnerA').classList.toggle('active',activeModalWinnerSide==='a');
  document.getElementById('modalWinnerB').classList.toggle('active',activeModalWinnerSide==='b');
}
function saveMatchModal(){
  if(!requireAdmin())return;
  const m=state.matches.find(x=>x.id===activeModalMatchId);
  if(!m)return;
  let scoreA=document.getElementById('modalScoreA').value.trim();
  let scoreB=document.getElementById('modalScoreB').value.trim();
  let aNum=parseInt(scoreA,10), bNum=parseInt(scoreB,10);
  let side=activeModalWinnerSide;
  if(!side && !Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum!==bNum)side=aNum>bNum?'a':'b';
  if(!side){alert('Wybierz zwycięzcę meczu.');return;}
  submitMatch(m.id,side==='a'?m.a:m.b,true,scoreA,scoreB);
  closeMatchModal();
}
async function resetModalMatchCascade(){
  if(!requireAdmin())return;
  if(!activeModalMatchId)return;
  if(!confirm('Zresetować ten mecz i wszystkie późniejsze mecze zależne od niego?'))return;
  resetMatchAndDescendants(activeModalMatchId);
  closeMatchModal();
  render();
  const ok=await persistState();
  if(ok)alert('Mecz został zresetowany.');
}
function resetMatchOnly(m){
  if(!m)return;
  m.done=false;m.winner=null;m.loser=null;m.scoreA='';m.scoreB='';
}
function clearSlot(target,slot,sourceId=null,type='winner'){
  const source=state.matches.find(x=>x.id===sourceId);
  const placeholder=source?participantName({kind:'source',matchId:source.id,no:source.no,type}):'Oczekuje';
  if(slot==='a'){
    target.a=null;
    target.aName=placeholder;
    target.aSource=sourceId;
    target.aSourceType=type;
  }else{
    target.b=null;
    target.bName=placeholder;
    target.bSource=sourceId;
    target.bSourceType=type;
  }
}
function resetMatchAndDescendants(id,seen=new Set()){
  if(seen.has(id))return;
  seen.add(id);
  const m=state.matches.find(x=>x.id===id);
  if(!m)return;

  let foundChild=false;

  // Czyścimy wszystkie komórki, które biorą wynik z tego meczu.
  (m.routes||[]).forEach(r=>{
    const target=state.matches.find(x=>x.id===r.targetId);
    if(!target)return;
    foundChild=true;
    clearSlot(target,r.slot,m.id,r.type);
    resetMatchAndDescendants(target.id,seen);
  });

  // Zabezpieczenie dla zapisów/starych struktur bez routes.
  state.matches.forEach(target=>{
    let depends=false;
    if(target.aSource===id){clearSlot(target,'a',id,target.aSourceType||'winner');depends=true;}
    if(target.bSource===id){clearSlot(target,'b',id,target.bSourceType||'winner');depends=true;}
    if(depends){
      foundChild=true;
      resetMatchAndDescendants(target.id,seen);
    }
  });

  // Awaryjny tryb dla starych danych z Firebase: jeżeli mecz nie ma poprawnych routes,
  // czyścimy wszystkie późniejsze rozegrane mecze z większym numerem.
  if(!foundChild && m.no){
    state.matches.forEach(target=>{
      if(target.id!==m.id && target.no && target.no>m.no && (target.done||target.winner||target.scoreA||target.scoreB)){
        resetMatchOnly(target);
      }
    });
  }

  resetMatchOnly(m);
}
function renderSeedRow(m,side){let id=side==='A'?m.a:m.b;let fallback=side==='A'?m.aName:m.bName;let score=side==='A'?m.scoreA:m.scoreB;let status=(m.done&&m.winner===id?'win ':'')+(m.done&&m.loser===id?'lose':'');return `<div class="seedRow ${status}"><div class="seedCell num">${id?seedNum(id):'-'}</div><div class="seedCell name">${teamCellHtml(id,fallback)}</div><div class="seedCell scoreBox">${m.done?esc(score):''}</div></div>`}
function matchButtonLabel(id,fallback){let t=state.teams.find(x=>x.id===id);return t?teamDisplay(t):fallback}
function renderMatch(m,connect={hasNext:false,hasPrev:false,nextClass:''}){let cls=`match ${connect.hasNext?'hasNext':''} ${connect.hasPrev?'hasPrev':''} ${connect.nextClass||''}`;let maps=(m.maps||[]).map((mp,i)=>`<b>${i+1}. ${esc(mp)}</b>`).join(' &nbsp; ');let edit=(isAdmin&&m.a&&m.b)?`<button class="editMatchBtn" title="Wpisz wynik meczu" onclick="openMatchModal('${m.id}')">✎</button>`:'';return `<div class="${cls}" data-match-id="${m.id}"><span class="matchNo">${m.no||''}</span>${edit}<div class="matchRows">${renderSeedRow(m,'A')}${renderSeedRow(m,'B')}</div><div class="matchMeta">Mapy: ${maps}</div></div>`}
function seedNum(id){let idx=state.teams.findIndex(t=>t.id===id);return idx>=0?idx+1:''}

function drawBracketSvgs(){
  document.querySelectorAll('.bracketBoard').forEach(board=>{
    const svg=board.querySelector('.bracketSvg');
    if(!svg)return;
    svg.innerHTML='';
    const boardType=board.dataset.board;
    const boardRect=board.getBoundingClientRect();
    svg.setAttribute('viewBox',`0 0 ${board.scrollWidth} ${board.scrollHeight}`);
    svg.setAttribute('width',board.scrollWidth);
    svg.setAttribute('height',board.scrollHeight);
    state.matches.forEach(source=>{
      (source.routes||[]).forEach(route=>{
        const target=state.matches.find(m=>m.id===route.targetId);
        if(!target||target.bracket!==boardType||target.round<=source.round)return;
        const from=board.querySelector(`[data-match-id="${CSS.escape(source.id)}"] .matchRows`);
        const to=board.querySelector(`[data-match-id="${CSS.escape(target.id)}"] .matchRows`);
        if(!from||!to)return;
        const a=from.getBoundingClientRect();
        const b=to.getBoundingClientRect();
        const x1=a.right-boardRect.left;
        const y1=a.top-boardRect.top+a.height/2;
        const x2=b.left-boardRect.left;
        const y2=b.top-boardRect.top+b.height/2;
        if(x2<=x1)return;
        const mid=x1+(x2-x1)/2;
        const d=`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',d);
        svg.appendChild(path);
      });
    });
  });
}
function scheduleBracketSvgDraw(){
  requestAnimationFrame(()=>{drawBracketSvgs();setTimeout(drawBracketSvgs,60)});
}
window.addEventListener('resize',scheduleBracketSvgDraw);
function renderMaps(){let u=mapUsage();document.getElementById('maps').innerHTML=state.maps.map(m=>`<div class="mapItem"><b>${esc(m)}</b><span><span class="status">użycia: ${u[m]||0}</span> <button class="danger adminOnly" onclick="removeMap('${esc(m)}')">Usuń</button></span></div>`).join('')||'<p>Brak map.</p>'}
function render(){applyAdminMode();normalizeMatches();renderPlayers();renderTeams();renderSeeding();renderBoard('WB','wbBoard','Runda');renderBoard('LB','lbBoard','Runda przegranych');renderFinalArea();renderMaps();scheduleBracketSvgDraw()}
function initFirebase(){
  if(!hasFirebaseConfig()){
    console.warn('Firebase nie jest jeszcze skonfigurowany. Wklej dane firebaseConfig z Firebase Console. Strona działa tymczasowo tylko w pamięci tej karty.');
    render();
    return;
  }
  const app=initializeApp(firebaseConfig);
  db=getDatabase(app);
  firebaseReady=true;
  onValue(ref(db,DB_ROOT),snap=>{
    isRemoteRendering=true;
    if(snap.exists()){
      state=cleanState(snap.val());
    }else{
      state=structuredClone(DEFAULT_STATE);
      set(ref(db,DB_ROOT),exportState()).catch(err=>console.error('Firebase initial write error:',err));
    }
    render();
    isRemoteRendering=false;
  },err=>{
    console.error('Firebase read error:',err);
    alert('Nie udało się odczytać danych z Firebase. Sprawdź firebaseConfig oraz Rules w Realtime Database.');
    render();
  });
}
Object.assign(window,{setTab,openAdminModal,closeAdminModal,loginAdmin,resetAll,addPlayer,removePlayer,setTeamName,movePlayer,generateBracket,updateScore,undoMatch,submitMatch,addMap,bulkAddMaps,removeMap,dragStart,allowDrop,leaveDrop,dropTo,openSeedingStage,seedingDragStart,seedingDragOver,seedingDragLeave,seedingDrop,openMatchModal,closeMatchModal,pickModalWinner,saveMatchModal,resetModalMatchCascade});
initFirebase();