const STORE='math_lessons_mobile_v4';
const LEGACY_STORE='math_lessons_mobile_v3';
const HISTORY_STORE='math_lessons_safety_history_v4';
const MAX_HISTORY=20;

const days=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
const months=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const RATE_PRICES={collective:10,individual:20,regular:15,monthly:0};
const RATE_LABELS={collective:'Collettiva',individual:'Individuale',regular:'Cliente abituale',monthly:'Mensile'};

function defaultData(){
  return {
    students:[],
    lessons:[],
    payments:{},
    settings:{start:'14:00',end:'21:00',step:30,dadLink:'https://meet.google.com/'},
    meta:{schema:6,createdAt:new Date().toISOString(),lastBackupAt:null,migratedLegacy:false}
  };
}

function loadHistory(){
  try{return JSON.parse(localStorage.getItem(HISTORY_STORE)||'[]')||[]}catch{return []}
}
function writeHistory(items){
  try{localStorage.setItem(HISTORY_STORE,JSON.stringify(items.slice(-MAX_HISTORY)))}catch{}
}
function saveRawSnapshot(raw,label='Salvataggio automatico'){
  if(!raw)return;
  try{
    const parsed=JSON.parse(raw);
    const items=loadHistory();
    const last=items[items.length-1];
    if(last && JSON.stringify(last.data)===JSON.stringify(parsed))return;
    items.push({id:uid(),at:new Date().toISOString(),label,data:parsed});
    writeHistory(items);
  }catch{}
}
function loadDataSafely(){
  const current=localStorage.getItem(STORE);
  if(current){
    try{return JSON.parse(current)}catch{}
  }
  const legacy=localStorage.getItem(LEGACY_STORE);
  if(legacy){
    try{
      const obj=JSON.parse(legacy);
      obj.meta=obj.meta||{};
      obj.meta.schema=4;
      obj.meta.migratedLegacy=true;
      obj.meta.migratedAt=new Date().toISOString();
      return obj;
    }catch{}
  }
  const hist=loadHistory();
  if(hist.length)return structuredClone(hist[hist.length-1].data);
  return defaultData();
}

let data=loadDataSafely();
let agendaMode='today';
let selectedPayMonth=monthKey(new Date());
let wizard={step:0,studentIds:[],date:'',time:'',duration:60,mode:'presence',rateType:null};
let currentPage='home';
let pageStack=[];
let modalStack=[];

function migrateData(){
  data.students=Array.isArray(data.students)?data.students:[];
  data.lessons=Array.isArray(data.lessons)?data.lessons:[];
  data.payments=data.payments&&typeof data.payments==='object'?data.payments:{};
  data.settings=Object.assign({start:'14:00',end:'21:00',step:30,dadLink:'https://meet.google.com/'},data.settings||{});
  data.meta=Object.assign({schema:6,lastBackupAt:null},data.meta||{});
  data.students.forEach(s=>{
    if(typeof s.active==='undefined')s.active=true;
    if(!s.billingType)s.billingType='lesson';
    if(typeof s.monthlyAmount==='undefined')s.monthlyAmount='';
    if(!s.monthlyMode)s.monthlyMode='presence';
    if(!Number(s.monthlyDuration))s.monthlyDuration=60;
  });

  // Prima migrazione: tutto ciò che nella vecchia versione era già passato
  // veniva conteggiato automaticamente. Lo trasformiamo in "svolto" per non perdere contabilità storica.
  if(!data.meta.accountingV4Migrated){
    data.lessons.forEach(l=>{
      if(!l.status)l.status='scheduled';
      if(l.status==='scheduled' && lessonHasEnded(l)){
        l.status='completed';
        l.completedAt=l.completedAt||new Date().toISOString();
        l.migratedCompleted=true;
      }
      l.updatedAt=l.updatedAt||l.createdAt||new Date().toISOString();
    });
    data.meta.accountingV4Migrated=true;
    data.meta.accountingV4MigratedAt=new Date().toISOString();
    persistNow();
  } else {
    data.lessons.forEach(l=>{
      if(!l.status)l.status='scheduled';
      l.updatedAt=l.updatedAt||l.createdAt||new Date().toISOString();
    });
  }
  // Tariffe e piani mensili. Le lezioni storiche senza tariffa restano da completare:
  // non inventiamo importi per dati già registrati.
  data.lessons.forEach(l=>{
    l.monthlyStudentIds=Array.isArray(l.monthlyStudentIds)?l.monthlyStudentIds:[];
    l.monthlyAmountsByStudent=l.monthlyAmountsByStudent&&typeof l.monthlyAmountsByStudent==='object'?l.monthlyAmountsByStudent:{};
    const billableIds=(l.studentIds||[]).filter(id=>!l.monthlyStudentIds.includes(id));
    if(billableIds.length===0 && l.monthlyStudentIds.length){
      l.rateType='monthly';
      l.pricePerStudent=0;
      l.pricingMissing=false;
    }else if(l.rateType && RATE_PRICES[l.rateType]>0){
      l.pricePerStudent=Number(l.pricePerStudent)||RATE_PRICES[l.rateType];
      l.pricingMissing=false;
    }else{
      l.rateType=l.rateType||null;
      l.pricePerStudent=Number(l.pricePerStudent)||null;
      l.pricingMissing=billableIds.length>0 && !l.pricePerStudent;
    }
  });
  data.meta.schema=Math.max(Number(data.meta.schema)||4,6);
  if(!data.meta.pricingV5Migrated){
    data.meta.pricingV5Migrated=true;
    data.meta.pricingV5MigratedAt=new Date().toISOString();
    persistNow();
  }
  if(!data.meta.monthlyV6Migrated){
    data.meta.monthlyV6Migrated=true;
    data.meta.monthlyV6MigratedAt=new Date().toISOString();
    persistNow();
  }
}

function persistNow(){
  try{localStorage.setItem(STORE,JSON.stringify(data))}catch(e){toast('Spazio dati insufficiente: fai subito un backup')}
}
function save(label='Salvataggio automatico'){
  const old=localStorage.getItem(STORE);
  if(old)saveRawSnapshot(old,label);
  persistNow();
  renderAll();
}

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function pad(n){return String(n).padStart(2,'0')}
function dateKey(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function monthKey(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}`}
function parseLocalDate(k){let [y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d)}
function fmtDate(k){let d=parseLocalDate(k);return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()].toLowerCase()}`}
function fmtMonth(k){let [y,m]=k.split('-').map(Number);return `${months[m-1]} ${y}`}
function fmtDateTime(iso){if(!iso)return 'Mai';let d=new Date(iso);return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`}
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function studentById(id){return data.students.find(s=>s.id===id)}
function lessonStudentNames(l){return l.studentIds.map(id=>studentById(id)?.name).filter(Boolean).join(', ')}
function normalizePhone(p){return (p||'').replace(/[^\d+]/g,'').replace(/^00/,'+')}
function toast(msg){let t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1900)}
function lessonStartDate(l){return new Date(`${l.date}T${l.time}:00`)}
function lessonEndDate(l){return new Date(lessonStartDate(l).getTime()+(Number(l.duration)||60)*60000)}
function lessonHasEnded(l){return lessonEndDate(l)<new Date()}
function isPastLesson(l){return lessonHasEnded(l)}
function isAccountingLesson(l){return l.status==='completed'}
function pendingPastLessons(){return data.lessons.filter(l=>l.status==='scheduled'&&lessonHasEnded(l)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))}
function lessonStatusText(l){
  if(l.status==='completed')return 'Svolta';
  if(l.status==='cancelled')return 'Annullata';
  if(lessonHasEnded(l))return 'Da verificare';
  return 'Programmata';
}
function lessonStatusClass(l){
  if(l.status==='completed')return 's-paid';
  if(l.status==='cancelled')return 's-due';
  if(lessonHasEnded(l))return 's-requested';
  return 's-scheduled';
}
function activeStudents(){return data.students.filter(s=>s.active!==false)}
function archivedStudents(){return data.students.filter(s=>s.active===false)}

function studentBillingType(s){return s?.billingType==='monthly'?'monthly':'lesson'}
function isMonthlyStudent(id){return studentBillingType(studentById(id))==='monthly'}
function monthlyAmountForStudent(s){const n=Number(String(s?.monthlyAmount??'').replace(',','.'));return Number.isFinite(n)&&n>=0?n:0}
function billingFormHtml(prefix,s={}){
  const type=studentBillingType(s),amount=esc(s.monthlyAmount??''),dur=Number(s.monthlyDuration)||60;
  return `<div class="field"><label>Tipo pagamento</label><select class="input" id="${prefix}Billing" onchange="toggleBillingFields('${prefix}')"><option value="lesson" ${type==='lesson'?'selected':''}>A lezione</option><option value="monthly" ${type==='monthly'?'selected':''}>Mensile</option></select></div><div id="${prefix}MonthlyBox" style="${type==='monthly'?'':'display:none'}"><div class="field"><label>Quota mensile</label><input class="input" id="${prefix}MonthlyAmount" inputmode="decimal" value="${amount}" placeholder="Es. 120"></div><div class="field"><label>Durata abituale</label><select class="input" id="${prefix}MonthlyDuration">${[30,60,90,120,150,180].map(v=>`<option value="${v}" ${dur===v?'selected':''}>${durationLabel(v)}</option>`).join('')}</select></div><div class="note"><b>Mensile:</b> la quota non verrà richiesta a ogni lezione. Data, ora e modalità (DAD o presenza) verranno invece scelte ogni volta. La durata usa questo valore abituale.</div></div>`;
}
function toggleBillingFields(prefix){
  const type=document.getElementById(prefix+'Billing')?.value||'lesson',box=document.getElementById(prefix+'MonthlyBox');
  if(box)box.style.display=type==='monthly'?'':'none';
}
function readBillingForm(prefix,base={}){
  const billingType=document.getElementById(prefix+'Billing')?.value||'lesson';
  const monthlyAmountRaw=(document.getElementById(prefix+'MonthlyAmount')?.value||'').trim().replace(',','.');
  if(billingType==='monthly'){
    const n=Number(monthlyAmountRaw);
    if(!Number.isFinite(n)||n<=0)throw new Error('Inserisci una quota mensile valida');
  }
  return {
    billingType,
    monthlyAmount:billingType==='monthly'?monthlyAmountRaw:'',
    monthlyMode:base.monthlyMode||'presence',
    monthlyDuration:Number(document.getElementById(prefix+'MonthlyDuration')?.value||base.monthlyDuration||60)
  };
}
function lessonMonthlyIds(l){return Array.isArray(l?.monthlyStudentIds)?l.monthlyStudentIds:[]}
function studentIsMonthlyInLesson(l,sid){return lessonMonthlyIds(l).includes(sid)}
function ensureMonthlyPayment(sid,mk,amount){
  const key=`${sid}_${mk}`,p=Object.assign({},data.payments[key]||{});
  if(p.planType!=='monthly'){
    p.planType='monthly';
    p.monthlyAmount=Number(amount)||0;
    p.amount=p.amount??'';
    p.status=p.status||'due';
    p.planLockedAt=new Date().toISOString();
  }else if(!Number.isFinite(Number(p.monthlyAmount)))p.monthlyAmount=Number(amount)||0;
  data.payments[key]=p;
}
function lessonPricingShort(l){
  const monthly=lessonMonthlyIds(l),billable=(l.studentIds||[]).filter(id=>!monthly.includes(id));
  if(!billable.length && monthly.length)return `Mensile${monthly.length>1?' · '+monthly.length+' alunni':''}`;
  if(hasValidPricing(l)){
    const base=`${rateLabel(l.rateType)} · ${fmtEuro(l.pricePerStudent)}${l.studentIds.length>1?'/alunno':''}`;
    return monthly.length?`${base} · ${monthly.length} mensile${monthly.length>1?'i':''}`:base;
  }
  return '⚠ Tariffa da impostare';
}
function paymentBreakdownItems(x){
  if(x.planType==='monthly')return [{label:'Mensile',count:x.ls.length,unit:x.monthlyAmount,total:x.autoAmount,monthly:true}];
  const map=new Map();
  x.ls.forEach(l=>{
    if(studentIsMonthlyInLesson(l,x.student.id))return;
    const unit=lessonPriceForStudent(l,x.student.id);
    if(unit<=0)return;
    const key=`${l.rateType||'lesson'}_${unit}`;
    const cur=map.get(key)||{label:rateLabel(l.rateType),count:0,unit,total:0,monthly:false};
    cur.count++;cur.total+=unit;map.set(key,cur);
  });
  return [...map.values()];
}
function paymentBreakdownHtml(x){
  if(x.planType==='monthly')return `<div class="note price-note"><b>Conteggio mensile:</b> ${x.ls.length} ${x.ls.length===1?'lezione svolta':'lezioni svolte'} (${fmtHours(x.hours)}).<br><b>Quota mensile:</b> ${fmtEuro(x.monthlyAmount)}.</div>`;
  const items=paymentBreakdownItems(x);
  const lines=items.length?items.map(i=>`${i.count} ${i.count===1?'lezione':'lezioni'} ${i.label.toLowerCase()} × ${fmtEuro(i.unit)} = <b>${fmtEuro(i.total)}</b>`).join('<br>'):'Nessuna lezione valorizzata.';
  return `<div class="note price-note"><b>Conteggio per lezioni:</b><br>${lines}<br><small>La durata è informativa: anche 1,5 ore conta come una sola lezione al prezzo scelto.</small></div>`;
}
function paymentBreakdownText(x){
  if(x.planType==='monthly')return `${x.ls.length} ${x.ls.length===1?'lezione svolta':'lezioni svolte'} (${fmtHours(x.hours)}). Mensile concordato: ${fmtEuro(x.monthlyAmount)}.`;
  const items=paymentBreakdownItems(x);
  return items.map(i=>`${i.count} ${i.count===1?'lezione':'lezioni'} ${i.label.toLowerCase()} x ${fmtEuro(i.unit)} = ${fmtEuro(i.total)}`).join('; ');
}


function go(id,fromBack=false){
  if(id===currentPage){
    if(id==='students')renderStudents();
    if(id==='agenda')renderAgenda();
    if(id==='payments')renderPayments();
    return;
  }
  if(!fromBack && currentPage)pageStack.push(currentPage);
  currentPage=id;
  document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===id));
  document.querySelectorAll('.navbtn').forEach(x=>x.classList.toggle('active',x.dataset.page===id));
  if(id==='students')renderStudents();
  if(id==='agenda')renderAgenda();
  if(id==='payments')renderPayments();
  window.scrollTo({top:0,behavior:'smooth'});
}
function appBack(){
  const modal=document.getElementById('modal');
  if(modal?.classList.contains('show')){modalBack();return}
  if(pageStack.length){go(pageStack.pop(),true);return}
  if(currentPage!=='home'){go('home',true);return}
}
function modalShell(html){return `<button class="sheet-back" onclick="modalBack()" aria-label="Indietro">‹</button><div class="handle"></div>${html}`}
function showModal(html){
  const modal=document.getElementById('modal'),sheet=document.getElementById('sheet');
  if(modal.classList.contains('show'))modalStack.push(sheet.innerHTML);
  sheet.innerHTML=modalShell(html);
  modal.classList.add('show');
  sheet.scrollTop=0;
}
function replaceModal(html){
  const modal=document.getElementById('modal'),sheet=document.getElementById('sheet');
  sheet.innerHTML=modalShell(html);
  modal.classList.add('show');
  sheet.scrollTop=0;
}
function modalBack(){
  const sheet=document.getElementById('sheet');
  if(modalStack.length){sheet.innerHTML=modalStack.pop();sheet.scrollTop=0;return}
  closeModal();
}
function closeModal(){document.getElementById('modal').classList.remove('show');modalStack=[]}

function renderAll(){renderHome();renderStudents();renderAgenda();renderPayments()}
function renderHome(){
  const now=new Date(),k=dateKey(now);
  document.getElementById('todayLabel').textContent=`📅 ${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()].toLowerCase()}`;
  const ls=data.lessons.filter(l=>l.date===k&&l.status!=='cancelled').sort((a,b)=>a.time.localeCompare(b.time));
  const weekDays=[];
  for(let i=0;i<7;i++){
    const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i),dk=dateKey(d);
    const dayLessons=data.lessons.filter(l=>l.date===dk&&l.status!=='cancelled').sort((a,b)=>a.time.localeCompare(b.time));
    weekDays.push({d,dk,lessons:dayLessons});
  }
  const weekCount=weekDays.reduce((n,x)=>n+x.lessons.length,0);
  document.getElementById('todayCount').textContent=`${weekCount} ${weekCount===1?'lezione':'lezioni'} nei prossimi 7 gg`;
  document.getElementById('statToday').textContent=ls.length;
  document.getElementById('statWeek').textContent=weekCount;
  document.getElementById('statStudents').textContent=activeStudents().length;

  const alertBox=document.getElementById('accountingAlert');
  if(alertBox){
    const pending=pendingPastLessons();
    const needsBackup=shouldRemindBackup();
    const missingPricing=data.lessons.filter(l=>l.status==='completed'&&!hasValidPricing(l));
    let html='';
    if(pending.length)html+=`<button class="account-alert warning" onclick="openReconciliation()"><span class="alert-icon">!</span><span><b>${pending.length} ${pending.length===1?'lezione da verificare':'lezioni da verificare'}</b><small>Conferma cosa è stato svolto prima della contabilità.</small></span><span class="arrow">›</span></button>`;
    if(missingPricing.length)html+=`<button class="account-alert warning" onclick="openMissingPricing()"><span class="alert-icon">€</span><span><b>${missingPricing.length} ${missingPricing.length===1?'lezione senza tariffa':'lezioni senza tariffa'}</b><small>Le vecchie lezioni restano salvate, ma vanno valorizzate per il totale automatico.</small></span><span class="arrow">›</span></button>`;
    if(needsBackup)html+=`<button class="account-alert backup" onclick="openSettings()"><span class="alert-icon">↥</span><span><b>Backup consigliato</b><small>I dati sono solo sul telefono: salva una copia esterna.</small></span><span class="arrow">›</span></button>`;
    alertBox.innerHTML=html;
  }

  const box=document.getElementById('todayLessons');
  if(!ls.length)box.innerHTML=`<div class="compact-empty"><span>✓</span><div><strong>Oggi è libero</strong><br>Nessuna lezione programmata.</div></div>`;
  else box.innerHTML=ls.map(l=>lessonCard(l)).join('');

  const weekBox=document.getElementById('homeWeekList');
  weekBox.innerHTML=weekDays.map((x,i)=>{
    const first=x.lessons[0],names=first?lessonStudentNames(first):'';
    const detail=first?`${first.time} · ${names}${x.lessons.length>1?` · +${x.lessons.length-1} altra/e`:''}`:'Nessuna lezione';
    const mode=first?`${first.mode==='dad'?'DAD':'Presenza'}${first.studentIds.length>1?' · cumulativa':''}`:'Tocca per vedere il giorno';
    return `<button class="week-row ${i===0?'today-row':''} ${x.lessons.length?'has-lessons':''}" onclick="renderSummaryModal('${x.dk}')"><span class="week-date"><b>${x.d.getDate()}</b><small>${days[x.d.getDay()].slice(0,3)}</small></span><span class="week-info"><b>${esc(detail)}</b><small>${esc(mode)}</small></span><span class="week-count">${x.lessons.length||'–'}</span></button>`;
  }).join('');
}
function lessonCard(l){
  const names=lessonStudentNames(l),group=l.studentIds.length>1?`<span class="pill group">${l.studentIds.length} alunni</span>`:'',status=lessonStatusText(l),price=lessonPricingShort(l);
  return `<div class="card lesson" onclick="openLesson('${l.id}')"><div class="timebox">${l.time}</div><div><h3>${esc(names||'Alunno archiviato')}</h3><p>${l.duration} min · ${l.studentIds.length>1?'Lezione cumulativa':'Lezione singola'} · <b>${status}</b><br>${price}</p></div><div>${group}<span class="pill ${l.mode==='dad'?'dad':'presence'}">${l.mode==='dad'?'DAD':'Presenza'}</span></div></div>`;
}
function openStudentForm(id,resume=false){
  const st=id?studentById(id):{name:'',phone:'',parentPhone:'',billingType:'lesson',monthlyAmount:'',monthlyMode:'presence',monthlyDuration:60};
  showModal(`<h2>${id?'Modifica alunno':'Nuovo alunno'}</h2><p class="sub">Contatti e piano di pagamento dell'alunno.</p><div class="field"><label>Nome e cognome</label><input class="input" id="sfName" value="${esc(st.name)}" placeholder="Es. Mario Rossi"></div><div class="field"><label>Telefono alunno</label><input class="input" id="sfPhone" value="${esc(st.phone||'')}" inputmode="tel" placeholder="+39..."></div><div class="field"><label>Telefono genitore (facoltativo)</label><input class="input" id="sfParent" value="${esc(st.parentPhone||'')}" inputmode="tel" placeholder="+39..."></div>${billingFormHtml('sf',st)}<button class="cta" onclick="saveStudent('${id||''}',${resume})">${id?'Salva modifiche':'Aggiungi alunno'}</button>${id?`<button class="cta danger" onclick="archiveStudent('${id}')">Archivia alunno</button>`:''}`);
}
function saveStudent(id,resume=false){
  const name=document.getElementById('sfName').value.trim();if(!name){toast('Inserisci nome e cognome');return}
  const old=id?studentById(id):null;
  let billing;try{billing=readBillingForm('sf',old||{})}catch(e){toast(e.message);return}
  const obj=Object.assign({},old||{},billing,{id:id||uid(),name,phone:document.getElementById('sfPhone').value.trim(),parentPhone:document.getElementById('sfParent').value.trim(),active:id?(old?.active!==false):true});
  if(id){const i=data.students.findIndex(x=>x.id===id);data.students[i]=obj}else data.students.push(obj);
  save(id?'Modifica alunno':'Nuovo alunno');
  if(resume&&!id){wizard.studentIds=[obj.id];wizard.step=1;if(obj.billingType==='monthly'){wizard.mode=null;wizard.duration=Number(obj.monthlyDuration)||60;wizard.rateType='monthly'}modalStack=[];renderWizard();toast('Alunno salvato e selezionato')} else {closeModal();toast('Alunno salvato')}
}
function archiveStudent(id){
  const s=studentById(id);if(!s)return;
  if(!confirm(`Archiviare ${s.name}? Lo storico lezioni e la contabilità resteranno intatti.`))return;
  s.active=false;s.archivedAt=new Date().toISOString();save('Archiviazione alunno');closeModal();toast('Alunno archiviato');
}
function restoreStudent(id){const s=studentById(id);if(!s)return;s.active=true;delete s.archivedAt;save('Ripristino alunno');openArchivedStudents();toast('Alunno ripristinato')}
function renderStudents(){
  const q=(document.getElementById('studentSearch')?.value||'').toLowerCase();
  const list=activeStudents().filter(st=>st.name.toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
  const box=document.getElementById('studentsList');if(!box)return;
  let html=list.length?list.map(st=>`<div class="card student" onclick="openStudent('${st.id}')"><div class="avatar">${esc(st.name.slice(0,1).toUpperCase())}</div><div class="main"><h3>${esc(st.name)}</h3><p>${esc(st.phone||'Nessun telefono')}${studentBillingType(st)==='monthly'?` · <b>Mensile ${fmtEuro(monthlyAmountForStudent(st))}</b>`:''}</p></div><span class="arrow">›</span></div>`).join(''):`<div class="card empty"><span class="big">👩‍🎓</span>${activeStudents().length?'Nessun risultato':'Aggiungi il primo alunno.'}</div>`;
  if(archivedStudents().length)html+=`<button class="cta secondary compact-cta" onclick="openArchivedStudents()">Archivio alunni (${archivedStudents().length})</button>`;
  box.innerHTML=html;
}
function openArchivedStudents(){
  const list=archivedStudents().sort((a,b)=>a.name.localeCompare(b.name));
  replaceModal(`<h2>Alunni archiviati</h2><p class="sub">Lo storico resta sempre disponibile e può essere ripristinato.</p>${list.length?list.map(s=>`<div class="card student"><div class="avatar">${esc(s.name.slice(0,1).toUpperCase())}</div><div class="main"><h3>${esc(s.name)}</h3><p>${esc(s.phone||'Nessun telefono')}</p></div><button class="smallbtn" onclick="restoreStudent('${s.id}')">Ripristina</button></div>`).join(''):'<div class="empty">Nessun alunno archiviato.</div>'}`);
}
function openStudent(id){
  const st=studentById(id);if(!st)return;
  const ls=data.lessons.filter(l=>l.studentIds.includes(id)&&l.status==='completed').sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  const dad=ls.filter(l=>l.mode==='dad').reduce((a,l)=>a+l.duration/60,0),pr=ls.filter(l=>l.mode==='presence').reduce((a,l)=>a+l.duration/60,0);
  const missing=ls.filter(l=>!studentIsMonthlyInLesson(l,id)&&!hasValidPricing(l)).length;
  const perLessonRevenue=ls.reduce((a,l)=>a+lessonPriceForStudent(l,id),0),monthly=studentBillingType(st)==='monthly';
  showModal(`<h2>${esc(st.name)}</h2><p class="sub">${esc(st.phone||'Telefono non inserito')}${st.parentPhone?` · Genitore ${esc(st.parentPhone)}`:''}</p><div class="note price-note"><b>Piano:</b> ${monthly?`Mensile · ${fmtEuro(monthlyAmountForStudent(st))}/mese · modalità scelta a ogni lezione · ${durationLabel(Number(st.monthlyDuration)||60)}`:'Pagamento a lezione'}</div>${missing?`<div class="note warning-note"><b>${missing} lezioni senza tariffa:</b> apri le lezioni storiche e assegna il prezzo per completare la contabilità.</div>`:''}<div class="statrow"><div class="stat"><b>${ls.length}</b><small>Lezioni svolte</small></div><div class="stat"><b>${fmtHours(dad+pr)}</b><small>Ore totali</small></div><div class="stat"><b>${monthly?'Mensile':fmtEuro(perLessonRevenue)}</b><small>${monthly?'Piano attivo':'Totale lezioni'}</small></div></div><div class="section-title"><h2>Storico contabile</h2><button class="textbtn" onclick="openStudentForm('${id}')">Modifica</button></div>${ls.length?ls.map(l=>`<div class="card lesson" onclick="openLesson('${l.id}')"><div class="timebox">${l.time}</div><div><h3>${fmtDate(l.date)}</h3><p>${l.duration} min · ${l.studentIds.length>1?'Cumulativa':'Singola'}<br>${studentIsMonthlyInLesson(l,id)?'Mensile':hasValidPricing(l)?`${rateLabel(l.rateType)} · ${fmtEuro(lessonPriceForStudent(l,id))}`:'⚠ Tariffa mancante'}</p></div><span class="pill ${l.mode==='dad'?'dad':'presence'}">${l.mode==='dad'?'DAD':'Presenza'}</span></div>`).join(''):`<div class="empty">Nessuna lezione svolta registrata.</div>`}`);
}
function startLessonWizard(){
  wizard={step:0,studentIds:[],date:'',time:'',duration:60,mode:'presence',rateType:null};
  modalStack=[];
  if(!activeStudents().length){openStudentForm('',true);return}
  renderWizard();
}
function wizardMonthlyIds(){return wizard.studentIds.filter(id=>isMonthlyStudent(id))}
function wizardNonMonthlyIds(){return wizard.studentIds.filter(id=>!isMonthlyStudent(id))}
function isSingleMonthlyWizard(){return wizard.studentIds.length===1&&wizardMonthlyIds().length===1}
function allWizardStudentsMonthly(){return wizard.studentIds.length>0&&wizardNonMonthlyIds().length===0}
function wizardDots(){
  const seq=isSingleMonthlyWizard()?[0,1,2,3,5]:(allWizardStudentsMonthly()?[0,1,2,3,5]:[0,1,2,3,4,5]);
  const idx=Math.max(0,seq.indexOf(wizard.step));
  return `<div class="stepdots">${seq.map((_,i)=>`<span class="dot ${i<=idx?'on':''}"></span>`).join('')}</div>`;
}
function wizardBack(){
  if(wizard.step===0){modalBack();return}
  if(isSingleMonthlyWizard()&&wizard.step===5){wizard.step=3;renderWizard();return}
  if(allWizardStudentsMonthly()&&wizard.step===5){wizard.step=3;renderWizard();return}
  wizard.step--;renderWizard();
}
function renderWizard(){
  if(wizard.step===0){
    replaceModal(`${wizardDots()}<h2>Scegli gli alunni</h2><p class="sub">Puoi selezionarne anche più di uno per la stessa lezione.</p>${activeStudents().sort((a,b)=>a.name.localeCompare(b.name)).map(st=>`<label class="studentpick"><input type="checkbox" ${wizard.studentIds.includes(st.id)?'checked':''} onchange="toggleWizardStudent('${st.id}',this.checked)"><span>${esc(st.name)}${studentBillingType(st)==='monthly'?` · <b>Mensile ${fmtEuro(monthlyAmountForStudent(st))}</b>`:''}</span></label>`).join('')}<button class="cta secondary" onclick="openStudentFormFromWizard()">＋ Aggiungi alunno</button><div class="sticky-actions"><button class="cta" onclick="wizardNextStudents()">Continua</button></div>`);
  } else if(wizard.step===1){
    const opts=[],now=new Date();
    for(let i=0;i<7;i++){const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i),k=dateKey(d);opts.push(`<button class="choice daychoice ${wizard.date===k?'selected':''}" onclick="wizard.date='${k}';renderWizard()"><b>${i===0?'Oggi':days[d.getDay()]}</b><small>${d.getDate()} ${months[d.getMonth()].slice(0,3)}</small></button>`)}
    replaceModal(`${wizardDots()}<h2>Scegli il giorno</h2><p class="sub">${isSingleMonthlyWizard()?'Alunno mensile: quota già impostata. Dopo giorno e ora sceglierai sempre DAD o presenza.':'Puoi anche registrare una lezione dimenticata scegliendo una data passata.'}</p><div class="choices">${opts.join('')}</div><div class="field"><label>Altra data / lezione passata</label><input class="input" type="date" value="${wizard.date}" onchange="wizard.date=this.value"></div><button class="cta" onclick="wizardNextDate()">Continua</button>`);
  } else if(wizard.step===2){
    const times=makeTimes(data.settings.start,data.settings.end,data.settings.step),monthlySingle=isSingleMonthlyWizard(),st=monthlySingle?studentById(wizard.studentIds[0]):null;
    replaceModal(`${wizardDots()}<h2>Scegli l'orario</h2><p class="sub">${monthlySingle?`Piano mensile: la quota è già impostata. Dopo l’orario scegli DAD o presenza. Durata abituale: ${durationLabel(Number(st?.monthlyDuration)||60)}.`:'Fasce ogni 30 minuti. Gli slot occupati restano selezionabili per lezioni cumulative o parallele.'}</p><div class="choices">${times.map(t=>{const count=data.lessons.filter(l=>l.date===wizard.date&&l.time===t&&l.status!=='cancelled').length;return `<button class="choice timechoice ${wizard.time===t?'selected':''}" onclick="wizard.time='${t}';renderWizard()"><b>${t}</b><small>${count?count+' già inserita/e':'libero'}</small></button>`}).join('')}</div>${monthlySingle?'':`<div class="field"><label>Durata lezione</label><select class="input" onchange="wizard.duration=Number(this.value)">${[30,60,90,120,150,180].map(v=>`<option value="${v}" ${wizard.duration===v?'selected':''}>${durationLabel(v)}</option>`).join('')}</select></div>`}<button class="cta" onclick="wizardNextTime()">Continua</button>`);
  } else if(wizard.step===3){
    replaceModal(`${wizardDots()}<h2>DAD o presenza?</h2><p class="sub">${allWizardStudentsMonthly()?'Per gli alunni mensili la modalità va scelta a ogni lezione.':'La modalità verrà riportata nel registro e nei messaggi.'}</p><div class="choices"><button class="choice ${wizard.mode==='presence'?'selected':''}" onclick="wizard.mode='presence';renderWizard()">🏠<br>Presenza</button><button class="choice ${wizard.mode==='dad'?'selected':''}" onclick="wizard.mode='dad';renderWizard()">💻<br>DAD</button></div>${wizard.mode==='dad'?`<div class="field"><label>Link DAD</label><input class="input" value="${esc(data.settings.dadLink||'')}" oninput="data.settings.dadLink=this.value"></div>`:''}<button class="cta" onclick="wizardNextMode()">Continua</button>`);
  } else if(wizard.step===4){
    const count=wizard.studentIds.length,monthlyCount=wizardMonthlyIds().length;
    if(count>1&&(!wizard.rateType||wizard.rateType!=='collective'))wizard.rateType='collective';
    if(count===1&&wizard.rateType==='collective')wizard.rateType=null;
    replaceModal(`${wizardDots()}<h2>Tariffa lezione</h2><p class="sub">Il prezzo è per lezione, non per ora: anche 1,5h vale una sola lezione.</p><div class="price-grid">${rateChoicesHtml(wizard.rateType,count,"wizard.rateType='{RATE}';renderWizard()")}</div>${count>1?`<div class="note"><b>Lezione cumulativa:</b> €10 per ogni alunno non mensile.${monthlyCount?` ${monthlyCount} ${monthlyCount===1?'alunno mensile non aggiunge':'alunni mensili non aggiungono'} costi alla singola lezione.`:''}</div>`:''}<button class="cta" onclick="wizardNextRate()">Continua</button>`);
  } else {
    const names=wizard.studentIds.map(id=>studentById(id)?.name).filter(Boolean).join(', '),past=isWizardPast(),monthlyIds=wizardMonthlyIds(),nonMonthlyIds=wizardNonMonthlyIds(),price=nonMonthlyIds.length?rateAmount(wizard.rateType):0,lessonTotal=price*nonMonthlyIds.length;
    const monthlyDetails=monthlyIds.map(id=>{const st=studentById(id);return `${st?.name||'Alunno'}: mensile ${fmtEuro(monthlyAmountForStudent(st))}/mese`}).join('<br>');
    replaceModal(`${wizardDots()}<h2>Conferma lezione</h2><p class="sub">${past?'Data già trascorsa: sarà registrata direttamente come lezione svolta.':'Controlla prima di salvare.'}</p><div class="card"><b>${esc(names)}</b><p style="color:var(--muted);line-height:1.7">${fmtDate(wizard.date)} · ore ${wizard.time}<br>${wizard.duration} min · ${wizard.mode==='dad'?'💻 DAD':'🏠 Presenza'} · ${wizard.studentIds.length>1?'Cumulativa ('+wizard.studentIds.length+')':'Singola'}<br>${nonMonthlyIds.length?`💶 ${rateLabel(wizard.rateType)} · <b>${fmtEuro(price)}${wizard.studentIds.length>1?' per alunno non mensile':''}</b>${wizard.studentIds.length>1?` · Totale singola lezione ${fmtEuro(lessonTotal)}`:''}`:'💶 <b>Nessun costo a lezione: piano mensile</b>'}${monthlyDetails?`<br>${monthlyDetails}`:''}<br><b>${past?'✓ Svolta':'◷ Programmata'}</b></p></div><button class="cta" onclick="confirmWizard()">✓ Conferma lezione</button><button class="cta secondary" onclick="wizard.step=0;renderWizard()">Modifica</button>`);
  }
  const back=document.querySelector('#sheet .sheet-back');if(back)back.setAttribute('onclick','wizardBack()');
}
function toggleWizardStudent(id,on){if(on&&!wizard.studentIds.includes(id))wizard.studentIds.push(id);if(!on)wizard.studentIds=wizard.studentIds.filter(x=>x!==id)}
function openStudentFormFromWizard(){
  const fresh={billingType:'lesson',monthlyAmount:'',monthlyMode:'presence',monthlyDuration:60};
  showModal(`<h2>Nuovo alunno</h2><p class="sub">Dopo il salvataggio torni alla lezione.</p><div class="field"><label>Nome e cognome</label><input class="input" id="wfName"></div><div class="field"><label>Telefono alunno</label><input class="input" id="wfPhone" inputmode="tel"></div><div class="field"><label>Telefono genitore (facoltativo)</label><input class="input" id="wfParent" inputmode="tel"></div>${billingFormHtml('wf',fresh)}<button class="cta" onclick="saveStudentFromWizard()">Salva e seleziona</button>`);
}
function saveStudentFromWizard(){
  const name=document.getElementById('wfName').value.trim();if(!name){toast('Inserisci nome e cognome');return}
  let billing;try{billing=readBillingForm('wf',{})}catch(e){toast(e.message);return}
  const st=Object.assign({id:uid(),name,phone:document.getElementById('wfPhone').value.trim(),parentPhone:document.getElementById('wfParent').value.trim(),active:true},billing);
  data.students.push(st);wizard.studentIds.push(st.id);if(st.billingType==='monthly'&&wizard.studentIds.length===1){wizard.mode=null;wizard.duration=Number(st.monthlyDuration)||60;wizard.rateType='monthly'}save('Nuovo alunno durante lezione');if(modalStack.length)modalStack.pop();renderWizard();
}
function wizardNextStudents(){
  if(!wizard.studentIds.length){toast('Seleziona almeno un alunno');return}
  if(wizardMonthlyIds().length){
    wizard.mode=null; // per qualsiasi lezione con un mensile, DAD/Presenza va scelto esplicitamente ogni volta
    if(isSingleMonthlyWizard()){const st=studentById(wizard.studentIds[0]);wizard.duration=Number(st?.monthlyDuration)||60;wizard.rateType='monthly'}
  }else if(!wizard.mode){wizard.mode='presence'}
  wizard.step=1;renderWizard();
}
function wizardNextDate(){if(!wizard.date){toast('Scegli un giorno');return}wizard.step=2;renderWizard()}
function wizardNextTime(){
  if(!wizard.time){toast('Scegli un orario');return}
  wizard.step=3;renderWizard();
}
function wizardNextMode(){
  if(wizard.mode!=='presence'&&wizard.mode!=='dad'){toast('Scegli DAD o presenza');return}
  wizard.step=allWizardStudentsMonthly()?5:4;renderWizard();
}
function wizardNextRate(){
  const nonMonthly=wizardNonMonthlyIds().length;
  if(!nonMonthly){wizard.rateType='monthly';wizard.step=5;renderWizard();return}
  if(!wizard.rateType){toast('Scegli una tariffa');return}
  const n=wizard.studentIds.length;
  if(wizard.rateType==='collective'&&n<2){toast('La tariffa collettiva richiede almeno 2 alunni');return}
  if((wizard.rateType==='individual'||wizard.rateType==='regular')&&n!==1){toast('Questa tariffa richiede 1 alunno');return}
  wizard.step=5;renderWizard();
}
function isWizardPast(){if(!wizard.date||!wizard.time)return false;const temp={date:wizard.date,time:wizard.time,duration:wizard.duration};return lessonHasEnded(temp)}
function confirmWizard(){
  const past=isWizardPast(),monthlyIds=wizardMonthlyIds(),nonMonthlyIds=wizardNonMonthlyIds(),price=nonMonthlyIds.length?rateAmount(wizard.rateType):0;
  if(nonMonthlyIds.length&&!price){toast('Tariffa non valida');return}
  const monthlyAmountsByStudent={};
  for(const id of monthlyIds){const st=studentById(id),amt=monthlyAmountForStudent(st);if(amt<=0){toast(`Quota mensile non valida per ${st?.name||'alunno'}`);return}monthlyAmountsByStudent[id]=amt}
  const l={id:uid(),studentIds:[...wizard.studentIds],date:wizard.date,time:wizard.time,duration:wizard.duration,mode:wizard.mode,rateType:nonMonthlyIds.length?wizard.rateType:'monthly',pricePerStudent:price,monthlyStudentIds:[...monthlyIds],monthlyAmountsByStudent,pricingMissing:false,status:past?'completed':'scheduled',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  if(past)l.completedAt=new Date().toISOString();
  data.lessons.push(l);
  monthlyIds.forEach(id=>ensureMonthlyPayment(id,wizard.date.slice(0,7),monthlyAmountsByStudent[id]));
  save(past?'Recupero lezione passata':'Nuova lezione');closeModal();toast(past?'Lezione passata registrata':'Lezione aggiunta');if(!past)setTimeout(()=>openSendForLesson(l.id),250);
}
function makeTimes(start,end,step){let [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number),a=[],m=sh*60+sm,e=eh*60+em;for(;m<=e;m+=step)a.push(`${pad(Math.floor(m/60))}:${pad(m%60)}`);return a}
function durationLabel(v){if(v<60)return `${v} min`;const h=Math.floor(v/60),m=v%60;return m?`${h}h ${m}m`:`${h} ${h===1?'ora':'ore'}`}
function fmtHours(v){return `${Number(v.toFixed(2)).toString().replace('.',',')}h`}
function rateLabel(type){return RATE_LABELS[type]||'Tariffa da impostare'}
function rateAmount(type){return Number(RATE_PRICES[type]||0)}
function hasValidPricing(l){
  const monthly=lessonMonthlyIds(l),billable=(l?.studentIds||[]).filter(id=>!monthly.includes(id));
  if(!billable.length&&monthly.length)return true;
  return billable.length>0&&Number(l?.pricePerStudent)>0;
}
function lessonPriceForStudent(l,sid=null){
  if(sid&&studentIsMonthlyInLesson(l,sid))return 0;
  if(!sid&&(l?.studentIds||[]).length===1&&studentIsMonthlyInLesson(l,l.studentIds[0]))return 0;
  return Number(l?.pricePerStudent)>0?Number(l.pricePerStudent):0;
}
function lessonRevenue(l){return (l?.studentIds||[]).reduce((sum,id)=>sum+lessonPriceForStudent(l,id),0)}
function fmtEuro(v){return `€${Number(Number(v||0).toFixed(2)).toString().replace('.',',')}`}
function effectivePaymentAmount(x){
  const manual=String(x.p?.amount??'').trim();
  if(manual!==''){const n=parseFloat(manual.replace(',','.'));if(Number.isFinite(n))return n}
  return x.autoAmount;
}
function rateChoicesHtml(selected,studentCount,onpick){
  const defs=[['collective','👥','Collettiva','10 €','per alunno'],['individual','👤','Individuale','20 €','per lezione'],['regular','⭐','Cliente abituale','15 €','per lezione']];
  return defs.map(([key,ico,label,price,sub])=>{
    const invalid=(key==='collective'&&studentCount<2)||((key==='individual'||key==='regular')&&studentCount!==1);
    const note=invalid?(key==='collective'?'Serve almeno 2 alunni':'Solo con 1 alunno'):sub;
    return `<button class="choice pricechoice ${selected===key?'selected':''} ${invalid?'disabled':''}" ${invalid?'disabled':''} onclick="${onpick.replace('{RATE}',key)}"><span class="price-ico">${ico}</span><b>${label}</b><strong>${price}</strong><small>${note}</small></button>`;
  }).join('');
}
function openLesson(id,replace=false){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  const status=lessonStatusText(l),pastPending=l.status==='scheduled'&&lessonHasEnded(l),pricing=hasValidPricing(l),monthly=lessonMonthlyIds(l),billable=l.studentIds.filter(id=>!monthly.includes(id));
  const value=billable.length?fmtEuro(lessonRevenue(l)):'Mensile';
  const lessonHtml=`<h2>${esc(lessonStudentNames(l))}</h2><p class="sub">${fmtDate(l.date)} · ${l.time}</p><div class="lesson-status-line"><span class="status ${lessonStatusClass(l)}">${status.toUpperCase()}</span></div>${!pricing?`<div class="note warning-note"><b>Tariffa mancante:</b> questa lezione non può essere valorizzata automaticamente. Premi “Modifica lezione” e scegli la tariffa.</div>`:''}<div class="statrow"><div class="stat"><b>${l.duration}</b><small>minuti</small></div><div class="stat"><b>${l.studentIds.length}</b><small>alunni</small></div><div class="stat"><b>${value}</b><small>${billable.length?'valore lezione':'piano'}</small></div></div><div class="note price-note"><b>${l.mode==='dad'?'💻 DAD':'🏠 Presenza'}</b> · ${lessonPricingShort(l)}</div>${pastPending?`<div class="note warning-note"><b>Contabilità:</b> questa lezione è passata ma non è stata ancora confermata. Non viene conteggiata finché non scegli “Svolta”.</div><div class="choices"><button class="choice selected" onclick="setLessonStatus('${id}','completed')">✅ Svolta</button><button class="choice" onclick="setLessonStatus('${id}','cancelled')">✕ Annullata</button></div>`:''}<button class="cta secondary" onclick="openLessonEdit('${id}')">✎ Modifica lezione</button>${l.status!=='cancelled'?`<button class="cta" onclick="openSendForLesson('${id}')">📲 Messaggi WhatsApp</button>`:''}${l.status==='completed'?`<button class="cta danger" onclick="setLessonStatus('${id}','cancelled')">Segna come annullata</button>`:''}${l.status==='cancelled'?`<button class="cta secondary" onclick="setLessonStatus('${id}',${lessonHasEnded(l)?"'completed'":"'scheduled'"})">Ripristina lezione</button>`:''}`;
  if(replace)replaceModal(lessonHtml);else showModal(lessonHtml);
}
function setLessonStatus(id,status){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  l.status=status;l.updatedAt=new Date().toISOString();
  if(status==='completed')l.completedAt=new Date().toISOString();else delete l.completedAt;
  if(status==='cancelled')l.cancelledAt=new Date().toISOString();else delete l.cancelledAt;
  save(`Stato lezione: ${status}`);openLesson(id,true);toast(status==='completed'?'Lezione conteggiata':'Lezione annullata');
}
function openLessonEdit(id){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  const times=makeTimes('08:00','22:00',30),allMonthly=lessonMonthlyIds(l).length===l.studentIds.length&&l.studentIds.length>0;
  showModal(`<h2>Modifica lezione</h2><p class="sub">Ogni modifica resta recuperabile dalla cronologia di sicurezza.</p><div class="field"><label>Alunni</label>${activeStudents().concat(archivedStudents().filter(st=>l.studentIds.includes(st.id))).filter((st,i,a)=>a.findIndex(x=>x.id===st.id)===i).sort((a,b)=>a.name.localeCompare(b.name)).map(st=>`<label class="studentpick"><input type="checkbox" name="editStudent" value="${st.id}" ${l.studentIds.includes(st.id)?'checked':''}><span>${esc(st.name)}${studentBillingType(st)==='monthly'?' · Mensile':''}${st.active===false?' · archiviato':''}</span></label>`).join('')}</div><div class="row"><div class="field"><label>Data</label><input class="input" id="editDate" type="date" value="${l.date}"></div><div class="field"><label>Ora</label><select class="input" id="editTime">${times.map(t=>`<option ${t===l.time?'selected':''}>${t}</option>`).join('')}</select></div></div><div class="row"><div class="field"><label>Durata</label><select class="input" id="editDuration">${[30,60,90,120,150,180].map(v=>`<option value="${v}" ${v===l.duration?'selected':''}>${durationLabel(v)}</option>`).join('')}</select></div><div class="field"><label>Modalità</label><select class="input" id="editMode"><option value="presence" ${l.mode==='presence'?'selected':''}>Presenza</option><option value="dad" ${l.mode==='dad'?'selected':''}>DAD</option></select></div></div><div class="field"><label>Tariffa per gli alunni non mensili</label><select class="input" id="editRate"><option value="" ${allMonthly?'selected':''}>${allMonthly?'Mensile · nessun costo a lezione':'— Seleziona tariffa —'}</option><option value="collective" ${l.rateType==='collective'?'selected':''}>Collettiva · €10 per alunno</option><option value="individual" ${l.rateType==='individual'?'selected':''}>Individuale · €20</option><option value="regular" ${l.rateType==='regular'?'selected':''}>Cliente abituale · €15</option></select></div><button class="cta" onclick="saveLessonEdit('${id}')">Salva modifiche</button>`);
}
function saveLessonEdit(id){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  const ids=[...document.querySelectorAll('input[name="editStudent"]:checked')].map(x=>x.value);if(!ids.length){toast('Seleziona almeno un alunno');return}
  const oldMonthly=lessonMonthlyIds(l),monthlyIds=ids.filter(sid=>oldMonthly.includes(sid)||isMonthlyStudent(sid)),billableIds=ids.filter(sid=>!monthlyIds.includes(sid));
  let rate=document.getElementById('editRate').value;
  if(!billableIds.length)rate='monthly';
  if(billableIds.length&&!rate){toast('Seleziona la tariffa');return}
  if(rate==='collective'&&ids.length<2){toast('La tariffa collettiva richiede almeno 2 alunni');return}
  if((rate==='individual'||rate==='regular')&&ids.length!==1){toast('Questa tariffa richiede 1 alunno');return}
  const newDate=document.getElementById('editDate').value,monthlyAmountsByStudent={};
  monthlyIds.forEach(sid=>{monthlyAmountsByStudent[sid]=Number(l.monthlyAmountsByStudent?.[sid])||monthlyAmountForStudent(studentById(sid));ensureMonthlyPayment(sid,newDate.slice(0,7),monthlyAmountsByStudent[sid])});
  l.studentIds=ids;l.monthlyStudentIds=monthlyIds;l.monthlyAmountsByStudent=monthlyAmountsByStudent;l.date=newDate;l.time=document.getElementById('editTime').value;l.duration=Number(document.getElementById('editDuration').value);l.mode=document.getElementById('editMode').value;l.rateType=billableIds.length?rate:'monthly';l.pricePerStudent=billableIds.length?rateAmount(rate):0;l.pricingMissing=false;l.updatedAt=new Date().toISOString();
  if(l.status==='completed'&&!lessonHasEnded(l)){l.status='scheduled';delete l.completedAt}
  save('Modifica lezione');modalStack.pop();openLesson(id,true);toast('Lezione aggiornata');
}
function buildMessage(l,s){const kind=l.mode==='dad'?'in modalità DAD':'in presenza',group=l.studentIds.length>1?' La lezione sarà di gruppo.':'',link=l.mode==='dad'&&data.settings.dadLink?` Link: ${data.settings.dadLink}`:'';return `Ciao ${s.name.split(' ')[0]}, confermo la lezione di matematica per ${fmtDate(l.date)} alle ore ${l.time}, ${kind}.${group}${link}`}
function waUrl(phone,msg){const p=normalizePhone(phone);return `https://wa.me/${p.replace('+','')}?text=${encodeURIComponent(msg)}`}
function sendWhatsApp(lid,sid,target='student'){const l=data.lessons.find(x=>x.id===lid),s=studentById(sid);if(!l||!s)return;const phone=target==='parent'?(s.parentPhone||s.phone):s.phone;if(!phone){toast('Numero non inserito');return}window.location.href=waUrl(phone,buildMessage(l,s))}
function openSendForLesson(id){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  showModal(`<h2>Invia conferme</h2><p class="sub">${fmtDate(l.date)} · ${l.time} · ${l.mode==='dad'?'DAD':'Presenza'} · ${l.studentIds.length>1?'Cumulativa':'Singola'}</p>${l.studentIds.map(sid=>{const s=studentById(sid);if(!s)return'';return `<div class="card"><b>${esc(s.name)}</b><p style="color:var(--muted);font-size:12px">${esc(buildMessage(l,s))}</p><div class="sendgrid"><button class="smallbtn wa" onclick="sendWhatsApp('${l.id}','${sid}','student')">WhatsApp alunno</button>${s.parentPhone?`<button class="smallbtn wa" onclick="sendWhatsApp('${l.id}','${sid}','parent')">WhatsApp genitore</button>`:'<button class="smallbtn" disabled>Nessun genitore</button>'}</div></div>`}).join('')}<button class="cta secondary" onclick="modalBack()">Indietro</button>`);
}

function renderAgenda(){
  document.getElementById('agendaTodayBtn')?.classList.toggle('active',agendaMode==='today');
  document.getElementById('agendaAllBtn')?.classList.toggle('active',agendaMode==='all');
  document.getElementById('agendaPendingBtn')?.classList.toggle('active',agendaMode==='pending');
  let ls=[];
  if(agendaMode==='today')ls=data.lessons.filter(l=>l.date===dateKey(new Date())&&l.status!=='cancelled').sort((a,b)=>a.time.localeCompare(b.time));
  else if(agendaMode==='pending')ls=pendingPastLessons();
  else ls=[...data.lessons].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  const box=document.getElementById('agendaList');if(!box)return;
  box.innerHTML=ls.length?ls.map(l=>lessonCard(l)).join(''):`<div class="card empty"><span class="big">📐</span>${agendaMode==='pending'?'Nessuna lezione da verificare.':'Nessuna lezione.'}</div>`;
}

function openSummary(){const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);renderSummaryModal(dateKey(tomorrow))}
function renderSummaryModal(k){
  const ls=data.lessons.filter(l=>l.date===k&&l.status!=='cancelled').sort((a,b)=>a.time.localeCompare(b.time));
  const ended=ls.filter(l=>l.status==='scheduled'&&lessonHasEnded(l)),dayRevenue=ls.filter(l=>l.status==='completed').reduce((a,l)=>a+lessonRevenue(l),0),missing=ls.filter(l=>l.status==='completed'&&!hasValidPricing(l)).length;
  replaceModal(`<h2>Riepilogo</h2><p class="sub">Conferme agli alunni e chiusura contabile della giornata.</p><div class="row"><button class="choice ${k===dateKey(new Date())?'selected':''}" onclick="renderSummaryModal('${dateKey(new Date())}')">Oggi</button><button class="choice ${k===dateKey(new Date(Date.now()+86400000))?'selected':''}" onclick="renderSummaryModal('${dateKey(new Date(Date.now()+86400000))}')">Domani</button></div><div class="field"><label>Oppure scegli una data</label><input class="input" type="date" value="${k}" onchange="renderSummaryModal(this.value)"></div>${ended.length?`<div class="account-alert warning static-alert"><span class="alert-icon">!</span><span><b>${ended.length} da verificare</b><small>Conferma le lezioni svolte prima di chiudere il giorno.</small></span></div>`:''}${missing?`<div class="account-alert warning static-alert"><span class="alert-icon">€</span><span><b>${missing} senza tariffa</b><small>Apri i dettagli e assegna il prezzo per completare la contabilità.</small></span></div>`:''}<div class="section-title"><h2>${fmtDate(k)}</h2><span style="color:var(--muted);font-size:12px">${ls.length} lezioni${dayRevenue?` · ${fmtEuro(dayRevenue)}`:''}</span></div>${ls.length?ls.map(l=>`<div class="card summary-card"><div class="summary-head"><div><h3>${l.time} · ${l.duration} min</h3><p>${esc(lessonStudentNames(l))}<br>${l.mode==='dad'?'💻 DAD':'🏠 Presenza'} · ${l.studentIds.length>1?'👥 Cumulativa · '+l.studentIds.length+' alunni':'👤 Singola'} · <b>${lessonStatusText(l)}</b><br>${lessonPricingShort(l)}</p></div><span class="pill ${l.mode==='dad'?'dad':'presence'}">${l.mode==='dad'?'DAD':'Presenza'}</span></div><div class="sendgrid">${l.status==='scheduled'&&!lessonHasEnded(l)?`<button class="smallbtn wa" onclick="openSendForLesson('${l.id}')">Invia messaggi</button>`:`<button class="smallbtn" onclick="openLesson('${l.id}')">Contabilità</button>`}<button class="smallbtn" onclick="openLesson('${l.id}')">Dettagli</button></div></div>`).join(''):`<div class="card empty">Nessuna lezione per questa data.</div>`}${ended.length?`<button class="cta" onclick="closeDay('${k}')">✓ Chiudi giornata</button>`:''}${ls.length?`<button class="cta secondary" onclick="copyDaySummary('${k}')">Copia riepilogo completo</button>`:''}`);
}
function closeDay(k){
  const pending=data.lessons.filter(l=>l.date===k&&l.status==='scheduled'&&lessonHasEnded(l));
  if(!pending.length){toast('Giornata già verificata');return}
  if(!confirm(`Segnare come svolte tutte le ${pending.length} lezioni ancora da verificare? Potrai correggerle in seguito.`))return;
  pending.forEach(l=>{l.status='completed';l.completedAt=new Date().toISOString();l.updatedAt=new Date().toISOString()});save('Chiusura giornata');renderSummaryModal(k);toast('Giornata chiusa e conteggiata');
}
async function copyDaySummary(k){const ls=data.lessons.filter(l=>l.date===k&&l.status!=='cancelled').sort((a,b)=>a.time.localeCompare(b.time));const txt=`Riepilogo lezioni - ${fmtDate(k)}\n\n`+ls.map(l=>`${l.time} - ${lessonStudentNames(l)} - ${l.mode==='dad'?'DAD':'Presenza'} - ${l.studentIds.length>1?'Cumulativa':'Singola'} - ${l.duration} min - ${lessonPricingShort(l)} - ${lessonStatusText(l)}`).join('\n');try{await navigator.clipboard.writeText(txt);toast('Riepilogo copiato')}catch{prompt('Copia il riepilogo:',txt)}}
function openReconciliation(push=false){
  const pending=pendingPastLessons();
  if(!pending.length){toast('Contabilità aggiornata: nulla da verificare');return}
  const html=`<h2>Verifica lezioni</h2><p class="sub">Queste lezioni sono passate ma non ancora confermate. Finché restano qui non entrano nei conteggi.</p><div class="note"><b>Regola di sicurezza:</b> solo le lezioni segnate “Svolta” vengono conteggiate nei pagamenti.</div>${pending.map(l=>`<div class="card"><div class="summary-head"><div><h3>${fmtDate(l.date)} · ${l.time}</h3><p>${esc(lessonStudentNames(l))}<br>${l.duration} min · ${l.mode==='dad'?'DAD':'Presenza'} · ${lessonPricingShort(l)}</p></div><span class="status s-requested">DA VERIFICARE</span></div><div class="sendgrid"><button class="smallbtn wa" onclick="reconcileOne('${l.id}','completed')">✅ Svolta</button><button class="smallbtn" onclick="reconcileOne('${l.id}','cancelled')">✕ Annullata</button></div></div>`).join('')}<button class="cta" onclick="reconcileAllCompleted()">Segna tutte come svolte</button>`;
  if(push)showModal(html);else replaceModal(html);
}
function reconcileOne(id,status){const l=data.lessons.find(x=>x.id===id);if(!l)return;l.status=status;l.updatedAt=new Date().toISOString();if(status==='completed')l.completedAt=new Date().toISOString();else l.cancelledAt=new Date().toISOString();save('Verifica lezione');if(pendingPastLessons().length)openReconciliation();else {if(modalStack.length)modalBack();else closeModal();toast('Tutto verificato')}}
function reconcileAllCompleted(){const p=pendingPastLessons();if(!p.length)return;if(!confirm(`Confermare come svolte tutte le ${p.length} lezioni?`))return;p.forEach(l=>{l.status='completed';l.completedAt=new Date().toISOString();l.updatedAt=new Date().toISOString()});save('Verifica massiva lezioni');if(modalStack.length)modalBack();else closeModal();toast('Tutte le lezioni sono state conteggiate')}

function buildMonthRange(){const arr=[],d=new Date();for(let i=-11;i<=1;i++)arr.push(monthKey(new Date(d.getFullYear(),d.getMonth()+i,1)));return arr}
function paymentInfo(sid,mk){
  const st=studentById(sid),key=`${sid}_${mk}`,p=data.payments[key]||{amount:'',status:'due'};
  const ls=data.lessons.filter(l=>l.studentIds.includes(sid)&&l.date.startsWith(mk)&&l.status==='completed');
  const pending=data.lessons.filter(l=>l.studentIds.includes(sid)&&l.date.startsWith(mk)&&l.status==='scheduled'&&lessonHasEnded(l));
  const dad=ls.filter(l=>l.mode==='dad').reduce((a,l)=>a+l.duration/60,0),presence=ls.filter(l=>l.mode==='presence').reduce((a,l)=>a+l.duration/60,0);
  const monthlyLesson=[...ls,...pending].find(l=>studentIsMonthlyInLesson(l,sid));
  const planType=p.planType==='monthly'||!!monthlyLesson?'monthly':'lesson';
  let monthlyAmount=0;
  if(planType==='monthly'){
    monthlyAmount=Number(p.monthlyAmount);
    if(!Number.isFinite(monthlyAmount)||monthlyAmount<=0)monthlyAmount=Number(monthlyLesson?.monthlyAmountsByStudent?.[sid])||monthlyAmountForStudent(st);
  }
  const missingPrice=planType==='monthly'?[]:ls.filter(l=>!studentIsMonthlyInLesson(l,sid)&&!hasValidPricing(l));
  const autoAmount=planType==='monthly'?monthlyAmount:ls.reduce((a,l)=>a+lessonPriceForStudent(l,sid),0);
  return {student:st,ls,pending,missingPrice,dad,presence,hours:dad+presence,autoAmount,p,key,planType,monthlyAmount};
}
function paymentChanged(x){
  if(x.p.status!=='paid')return false;
  const currentIds=x.ls.map(l=>l.id).sort().join('|'),oldIds=(x.p.lessonIdsAtPayment||[]).slice().sort().join('|');
  const currentAmount=effectivePaymentAmount(x),oldAmount=Number(x.p.amountAtPayment??currentAmount);
  return Math.abs(x.hours-Number(x.p.hoursAtPayment||0))>.001||currentIds!==oldIds||Math.abs(currentAmount-oldAmount)>.001;
}
function renderPayments(){
  const line=document.getElementById('monthLine'),box=document.getElementById('paymentsList'),summary=document.getElementById('paymentSummary');if(!line||!box)return;
  line.innerHTML=buildMonthRange().map(k=>`<button class="monthbtn ${k===selectedPayMonth?'active':''}" onclick="selectedPayMonth='${k}';renderPayments()">${fmtMonth(k)}</button>`).join('');
  const rows=data.students.map(st=>paymentInfo(st.id,selectedPayMonth)).filter(x=>x.hours>0||x.pending.length||x.p.amount||x.planType==='monthly'&&Number(x.monthlyAmount)>0&&(x.ls.length||x.pending.length));
  const totalHours=rows.reduce((a,x)=>a+x.hours,0),autoEuro=rows.reduce((a,x)=>a+x.autoAmount,0),paidEuro=rows.filter(x=>x.p.status==='paid').reduce((a,x)=>a+effectivePaymentAmount(x),0),pendingN=rows.reduce((a,x)=>a+x.pending.length,0),missingN=rows.reduce((a,x)=>a+x.missingPrice.length,0);
  if(summary)summary.innerHTML=`<div class="statrow accounting-stats"><div class="stat"><b>${fmtHours(totalHours)}</b><small>Ore svolte</small></div><div class="stat"><b>${fmtEuro(autoEuro)}</b><small>Maturato</small></div><div class="stat"><b>${fmtEuro(paidEuro)}</b><small>Incassato</small></div></div>${missingN?`<button class="account-alert warning static-alert" onclick="openMissingPricing('${selectedPayMonth}')"><span class="alert-icon">€</span><span><b>${missingN} ${missingN===1?'lezione senza tariffa':'lezioni senza tariffa'}</b><small>Vanno completate per avere un totale automatico corretto.</small></span><span class="arrow">›</span></button>`:''}${pendingN?`<button class="account-alert warning static-alert" onclick="openReconciliation(true)"><span class="alert-icon">!</span><span><b>${pendingN} da verificare</b><small>Non sono ancora conteggiate.</small></span><span class="arrow">›</span></button>`:''}<div class="sendgrid"><button class="smallbtn" onclick="startLessonWizard()">＋ Recupera lezione</button><button class="smallbtn" onclick="exportMonthCSV('${selectedPayMonth}')">⬇ Esporta CSV</button></div>`;
  if(!rows.length){box.innerHTML=`<div class="card empty"><span class="big">€</span>Nessuna lezione conteggiata per ${fmtMonth(selectedPayMonth)}.</div>`;return}
  box.innerHTML=rows.sort((a,b)=>a.student.name.localeCompare(b.student.name)).map(x=>{
    const changed=paymentChanged(x),status=x.p.status||'due',label=changed?'⚠ MODIFICATO':status==='paid'?'PAGATO':status==='requested'?'NON PAGATO':'DA INVIARE',amount=effectivePaymentAmount(x);
    const detail=x.planType==='monthly'?`${x.ls.length} lezioni · <b>Mensile ${fmtEuro(x.monthlyAmount)}</b>${String(x.p.amount??'').trim()!==''?` · finale ${fmtEuro(amount)}`:''}`:`${x.ls.length} lezioni · <b>${fmtEuro(amount)}</b>${x.p.amount?` · manuale`:' · automatico'}`;
    return `<div class="card payrow ${changed?'changed-payment':''}" onclick="openPayment('${x.student.id}','${selectedPayMonth}')"><div><h3>${esc(x.student.name)}${x.student.active===false?' · archiviato':''}</h3><p>${fmtHours(x.hours)} · ${detail}${x.pending.length?` · ⚠ ${x.pending.length} da verificare`:''}${x.missingPrice.length?` · ⚠ ${x.missingPrice.length} senza tariffa`:''}</p></div><span class="status ${changed?'s-requested':'s-'+status}">${label}</span></div>`;
  }).join('');
}
function openMissingPricing(mk=null){
  const ls=data.lessons.filter(l=>(!mk||l.date.startsWith(mk))&&l.status==='completed'&&!hasValidPricing(l)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  if(!ls.length){toast('Tutte le lezioni hanno una tariffa');return}
  showModal(`<h2>Tariffe da completare</h2><p class="sub">Sono lezioni storiche salvate prima dell'introduzione dei prezzi. Non assegno importi a caso: scegli tu la tariffa corretta.</p>${ls.map(l=>`<div class="ledger-row" onclick="openLesson('${l.id}')"><span><b>${fmtDate(l.date)} · ${l.time}</b><small>${esc(lessonStudentNames(l))} · ${l.mode==='dad'?'DAD':'Presenza'} · ${l.studentIds.length>1?'Cumulativa':'Singola'}</small></span><strong>Imposta €</strong></div>`).join('')}`);
}
function openPayment(sid,mk,replace=false){
  const x=paymentInfo(sid,mk),st=x.student,p=x.p,changed=paymentChanged(x),effective=effectivePaymentAmount(x);
  const html=`<h2>${esc(st.name)}</h2><p class="sub">Pagamento ${fmtMonth(mk)} · ${x.planType==='monthly'?'Piano mensile':'A lezione'}</p>${x.pending.length?`<button class="account-alert warning static-alert" onclick="openReconciliation(true)"><span class="alert-icon">!</span><span><b>${x.pending.length} lezioni da verificare</b><small>Non sono ancora incluse nei conteggi qui sotto.</small></span><span class="arrow">›</span></button>`:''}${x.missingPrice.length?`<button class="account-alert warning static-alert" onclick="openMissingPricing('${mk}')"><span class="alert-icon">€</span><span><b>${x.missingPrice.length} lezioni senza tariffa</b><small>Il totale automatico è incompleto finché non assegni il prezzo.</small></span><span class="arrow">›</span></button>`:''}${changed?`<div class="note warning-note"><b>Attenzione:</b> il mese è stato modificato dopo che era stato segnato pagato. Verifica lezioni e importo.</div>`:''}<div class="statrow"><div class="stat"><b>${fmtHours(x.hours)}</b><small>Ore</small></div><div class="stat"><b>${x.ls.length}</b><small>Lezioni</small></div><div class="stat"><b>${fmtEuro(x.autoAmount)}</b><small>${x.planType==='monthly'?'Mensile':'Calcolato'}</small></div></div>${paymentBreakdownHtml(x)}<div class="field"><label>Totale finale manuale (facoltativo)</label><input class="input" id="payAmount" inputmode="decimal" value="${esc(p.amount||'')}" placeholder="Lascia vuoto per usare ${fmtEuro(x.autoAmount)}"></div><button class="cta secondary" onclick="savePaymentAmount('${sid}','${mk}')">Salva sconto / cifra particolare</button><div class="payment-total-big"><span>Da richiedere</span><b>${fmtEuro(effective)}</b></div><div class="sendgrid"><button class="smallbtn wa" onclick="sendPayment('${sid}','${mk}','student')">WhatsApp alunno</button>${st.parentPhone?`<button class="smallbtn wa" onclick="sendPayment('${sid}','${mk}','parent')">WhatsApp genitore</button>`:'<button class="smallbtn" disabled>Nessun genitore</button>'}</div><div class="choices" style="margin-top:10px"><button class="choice ${p.status==='requested'?'selected':''}" onclick="setPaymentStatus('${sid}','${mk}','requested')">🟡 Non pagato</button><button class="choice ${p.status==='paid'?'selected':''}" onclick="setPaymentStatus('${sid}','${mk}','paid')">🟢 Pagato</button></div><button class="cta danger" onclick="setPaymentStatus('${sid}','${mk}','due')">Segna da inviare</button><div class="section-title"><h2>Registro lezioni</h2><span style="color:var(--muted);font-size:12px">${x.ls.length} svolte</span></div>${x.ls.length?x.ls.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(l=>`<div class="ledger-row" onclick="openLesson('${l.id}')"><span><b>${fmtDate(l.date)}</b><small>${l.time} · ${l.duration} min · ${l.mode==='dad'?'DAD':'Presenza'} · ${l.studentIds.length>1?'Cumulativa':'Singola'} · ${studentIsMonthlyInLesson(l,sid)?'Mensile':hasValidPricing(l)?rateLabel(l.rateType):'Tariffa mancante'}</small></span><strong>${studentIsMonthlyInLesson(l,sid)?'Mensile':hasValidPricing(l)?fmtEuro(lessonPriceForStudent(l,sid)):'—'}</strong></div>`).join(''):'<div class="empty">Nessuna lezione svolta.</div>'}`;
  if(replace)replaceModal(html);else showModal(html);
}
function savePaymentAmount(sid,mk){
  const key=`${sid}_${mk}`,raw=document.getElementById('payAmount').value.trim().replace(',','.');
  if(raw!=='' && (!Number.isFinite(Number(raw))||Number(raw)<0)){toast('Inserisci un totale valido');return}
  data.payments[key]=Object.assign({},data.payments[key]||{},{amount:raw,status:data.payments[key]?.status||'due',updatedAt:new Date().toISOString()});save('Correzione totale pagamento');openPayment(sid,mk,true);toast(raw===''?'Ripristinato totale automatico':'Totale manuale salvato');
}
function setPaymentStatus(sid,mk,status){
  const x=paymentInfo(sid,mk),key=x.key,p=Object.assign({},data.payments[key]||{});
  if(status==='paid' && x.pending.length){toast('Prima verifica le lezioni in sospeso');return}
  if(status==='paid' && x.missingPrice.length && String(p.amount??'').trim()===''){toast('Prima completa le tariffe mancanti o inserisci un totale manuale');return}
  p.status=status;p.updatedAt=new Date().toISOString();p[status+'At']=new Date().toISOString();
  if(status==='paid'){p.hoursAtPayment=x.hours;p.lessonIdsAtPayment=x.ls.map(l=>l.id);p.lessonCountAtPayment=x.ls.length;p.amountAtPayment=effectivePaymentAmount({...x,p});p.autoAmountAtPayment=x.autoAmount;p.paidSnapshotAt=new Date().toISOString()}
  data.payments[key]=p;save(`Pagamento ${status}`);openPayment(sid,mk,true);toast(status==='paid'?'Segnato come pagato':status==='requested'?'Segnato come non pagato':'Segnato da inviare');
}
function sendPayment(sid,mk,targetType='student'){
  const x=paymentInfo(sid,mk),st=x.student,key=x.key;
  if(x.pending.length){toast('Prima verifica le lezioni in sospeso');return}
  const manual=document.getElementById('payAmount')?.value.trim()??String(x.p.amount||'');
  if(x.missingPrice.length&&!manual){toast('Prima completa le tariffe mancanti o inserisci un totale manuale');return}
  if(manual!==''&&(!Number.isFinite(Number(manual.replace(',','.')))||Number(manual.replace(',','.'))<0)){toast('Totale non valido');return}
  const amount=manual!==''?Number(manual.replace(',','.')):x.autoAmount,target=targetType==='parent'?st.parentPhone:st.phone;if(!target){toast('Numero non inserito');return}
  data.payments[key]=Object.assign({},data.payments[key]||{},{amount:manual,status:'requested',requestedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});save('Invio richiesta pagamento');
  const first=st.name.split(' ')[0],breakdown=paymentBreakdownText(x);
  const finalLine=manual!==''&&Math.abs(amount-x.autoAmount)>.001?` Totale calcolato: ${fmtEuro(x.autoAmount)}. Totale finale applicato: ${fmtEuro(amount)}.`:` Totale: ${fmtEuro(amount)}.`;
  const msg=`Buonasera, riepilogo lezioni di matematica di ${first} per ${fmtMonth(mk).toLowerCase()}: ${breakdown}${finalLine} Grazie.`;
  window.location.href=waUrl(target,msg);
}
function openPaymentReminder(force=false){
  const now=new Date();if(!force&&now.getDate()<2)return;const prev=monthKey(new Date(now.getFullYear(),now.getMonth()-1,1));
  const pending=data.students.map(st=>paymentInfo(st.id,prev)).filter(x=>(x.hours>0||x.planType==='monthly'&&x.ls.length)&&(force?x.p.status!=='paid':(x.p.status||'due')==='due'));
  if(!pending.length){if(force)toast('Nessun pagamento in sospeso');return}
  showModal(`<h2>🔔 Pagamenti ${fmtMonth(prev)}</h2><p class="sub">Hai ${pending.length} ${pending.length===1?'alunno':'alunni'} da controllare.</p>${pending.map(x=>`<div class="card payrow" onclick="openPayment('${x.student.id}','${prev}')"><div><h3>${esc(x.student.name)}</h3><p>${x.ls.length} lezioni · ${x.planType==='monthly'?`Mensile ${fmtEuro(x.monthlyAmount)}`:fmtEuro(effectivePaymentAmount(x))}${x.p.amount?' · totale manuale':''}${x.pending.length?` · ⚠ ${x.pending.length} da verificare`:''}${x.missingPrice.length?` · ⚠ ${x.missingPrice.length} senza tariffa`:''}</p></div><span class="status s-${x.p.status||'due'}">${x.p.status==='requested'?'NON PAGATO':'DA INVIARE'}</span></div>`).join('')}<button class="cta secondary" onclick="modalBack()">Indietro</button>`);
}
function exportMonthCSV(mk){
  const rows=[['Data','Ora','Alunno','Modalita','Durata_min','Tipo','Piano','Tariffa','Prezzo_lezione_alunno','Quota_mensile','Stato_lezione','Totale_mese_calcolato','Totale_mese_manuale','Stato_pagamento']];
  data.lessons.filter(l=>l.date.startsWith(mk)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).forEach(l=>{
    l.studentIds.forEach(sid=>{const st=studentById(sid),x=paymentInfo(sid,mk),p=x.p,monthly=studentIsMonthlyInLesson(l,sid);rows.push([l.date,l.time,st?.name||'Alunno archiviato',l.mode==='dad'?'DAD':'Presenza',l.duration,l.studentIds.length>1?'Cumulativa':'Singola',monthly?'Mensile':'A lezione',monthly?'Mensile':rateLabel(l.rateType),monthly?'':lessonPriceForStudent(l,sid),monthly?(l.monthlyAmountsByStudent?.[sid]||x.monthlyAmount):'',lessonStatusText(l),x.autoAmount,p.amount||'',p.status==='paid'?'Pagato':p.status==='requested'?'Non pagato':'Da inviare'])});
  });
  const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n');downloadBlob(csv,`registro-lezioni-${mk}.csv`,'text/csv;charset=utf-8');toast('Registro mensile esportato');
}
function openSettings(){
  const opts=makeTimes('08:00','22:00',30),hist=loadHistory(),lastBackup=data.meta?.lastBackupAt;
  showModal(`<h2>Impostazioni</h2><p class="sub">Orari, link DAD e sicurezza dei dati.</p><div class="row"><div class="field"><label>Prima fascia</label><select class="input" id="setStart">${opts.map(t=>`<option ${t===data.settings.start?'selected':''}>${t}</option>`).join('')}</select></div><div class="field"><label>Ultima fascia</label><select class="input" id="setEnd">${opts.map(t=>`<option ${t===data.settings.end?'selected':''}>${t}</option>`).join('')}</select></div></div><div class="field"><label>Link fisso DAD</label><input class="input" id="setDad" value="${esc(data.settings.dadLink||'')}" placeholder="https://..."></div><button class="cta" onclick="saveSettings()">Salva impostazioni</button><div class="section-title"><h2>Sicurezza dati</h2></div><div class="note"><b>Ultimo backup esterno:</b> ${lastBackup?fmtDateTime(lastBackup):'mai'}.<br>I salvataggi automatici sul telefono aiutano contro errori, ma non proteggono da perdita/guasto del telefono.</div><div class="sendgrid"><button class="smallbtn" onclick="exportBackup()">⬇ Esporta backup</button><button class="smallbtn" onclick="shareBackup()">↗ Condividi backup</button></div><div class="sendgrid"><button class="smallbtn" onclick="document.getElementById('importFile').click()">⬆ Importa backup</button><button class="smallbtn" onclick="openSafetyHistory()">↶ Cronologia (${hist.length})</button></div>`);
}
function saveSettings(){const start=document.getElementById('setStart').value,end=document.getElementById('setEnd').value;if(start>end){toast('La prima fascia deve precedere l’ultima');return}data.settings.start=start;data.settings.end=end;data.settings.step=30;data.settings.dadLink=document.getElementById('setDad').value.trim();save('Impostazioni');closeModal();toast('Impostazioni salvate')}
function backupPayload(){return JSON.stringify(data,null,2)}
function markBackupDone(){data.meta=data.meta||{};data.meta.lastBackupAt=new Date().toISOString();persistNow();renderHome()}
function downloadBlob(content,name,type){const blob=content instanceof Blob?content:new Blob([content],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
function exportBackup(){try{downloadBlob(backupPayload(),`backup-ripetizioni-${dateKey(new Date())}.json`,'application/json');markBackupDone();toast('Backup creato')}catch{toast('Impossibile creare il backup')}}
async function shareBackup(){
  try{
    const file=new File([backupPayload()],`backup-ripetizioni-${dateKey(new Date())}.json`,{type:'application/json'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({title:'Backup Lezioni Matematica',files:[file]});markBackupDone();toast('Backup condiviso')}else exportBackup();
  }catch(e){if(e?.name!=='AbortError')toast('Condivisione non disponibile')}
}
function importBackup(input){
  const file=input.files&&input.files[0];if(!file)return;const r=new FileReader();
  r.onload=()=>{try{const obj=JSON.parse(r.result);if(!Array.isArray(obj.students)||!Array.isArray(obj.lessons)||!obj.payments||!obj.settings)throw new Error('bad');const old=localStorage.getItem(STORE);if(old)saveRawSnapshot(old,'Prima di importare backup');data=obj;data.meta=Object.assign({schema:4},data.meta||{});migrateData();persistNow();renderAll();closeModal();toast('Backup importato correttamente')}catch{toast('Backup non valido')}finally{input.value=''}};r.readAsText(file);
}
function openSafetyHistory(){
  const hist=loadHistory().slice().reverse();
  showModal(`<h2>Cronologia sicurezza</h2><p class="sub">Fino a ${MAX_HISTORY} versioni precedenti salvate automaticamente sul telefono.</p>${hist.length?hist.map((h,i)=>`<div class="ledger-row"><span><b>${fmtDateTime(h.at)}</b><small>${esc(h.label||'Salvataggio')}</small></span><button class="smallbtn" onclick="restoreSnapshot('${h.id}')">Ripristina</button></div>`).join(''):'<div class="empty">Non ci sono ancora versioni precedenti.</div>'}`);
}
function restoreSnapshot(id){
  const h=loadHistory().find(x=>x.id===id);if(!h)return;if(!confirm(`Ripristinare i dati del ${fmtDateTime(h.at)}? Lo stato attuale verrà salvato in cronologia.`))return;
  const old=localStorage.getItem(STORE);if(old)saveRawSnapshot(old,'Prima di ripristino cronologia');data=structuredClone(h.data);migrateData();persistNow();renderAll();closeModal();toast('Versione ripristinata');
}
function shouldRemindBackup(){
  if(!data.students.length&&!data.lessons.length)return false;const last=data.meta?.lastBackupAt;if(!last)return true;return (Date.now()-new Date(last).getTime())>7*86400000;
}

function checkAccountingReminder(){
  const pending=pendingPastLessons();if(!pending.length)return false;
  const key=`accounting_pending_${dateKey(new Date())}`;
  if(!sessionStorage.getItem(key)){sessionStorage.setItem(key,'1');setTimeout(()=>{if(!document.getElementById('modal').classList.contains('show'))openReconciliation()},550);return true}
  return false;
}
function checkPaymentReminder(){
  const now=new Date(),key=`reminder_${now.getFullYear()}_${now.getMonth()+1}`;
  if(now.getDate()>=2&&!sessionStorage.getItem(key)){sessionStorage.setItem(key,'1');setTimeout(()=>{if(!document.getElementById('modal').classList.contains('show'))openPaymentReminder(false)},1200)}
}

migrateData();
document.addEventListener('DOMContentLoaded',()=>{renderAll();checkAccountingReminder();checkPaymentReminder()});
