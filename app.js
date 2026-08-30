const STORE='math_lessons_mobile_v4';
const LEGACY_STORE='math_lessons_mobile_v3';
const HISTORY_STORE='math_lessons_safety_history_v4';
const MAX_HISTORY=20;

const days=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
const months=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const RATE_PRICES={collective:10,individual:20,regular:15,monthly:0};
const RATE_LABELS={collective:'Collettiva',individual:'Individuale',regular:'Cliente abituale',monthly:'Mensile'};
const PREFERRED_RATE_LABELS={collective:'Collettiva · €10',individual:'Individuale · €20',regular:'Cliente abituale · €15'};

function defaultData(){
  return {
    students:[],
    lessons:[],
    payments:{},
    monthClosures:{},
    settings:{start:'09:30',end:'20:30',step:30,dadLink:'https://meet.google.com/'},
    meta:{schema:10,createdAt:new Date().toISOString(),lastBackupAt:null,migratedLegacy:false}
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
let wizard={step:0,studentIds:[],date:'',time:'',baseDuration:60,lessonUnits:1,duration:60,mode:null,rateType:null,repeatWeeks:1,recoveryOf:null,lessonType:null};
let currentPage='home';
let pageStack=[];
let modalStack=[];

function migrateData(){
  data.students=Array.isArray(data.students)?data.students:[];
  data.lessons=Array.isArray(data.lessons)?data.lessons:[];
  data.payments=data.payments&&typeof data.payments==='object'?data.payments:{};
  data.monthClosures=data.monthClosures&&typeof data.monthClosures==='object'?data.monthClosures:{};
  data.settings=Object.assign({start:'09:30',end:'20:30',step:30,dadLink:'https://meet.google.com/'},data.settings||{});data.settings.start='09:30';data.settings.end='20:30';data.settings.step=30;
  data.meta=Object.assign({schema:10,lastBackupAt:null},data.meta||{});data.meta.schema=10;
  data.students.forEach(s=>{
    if(typeof s.active==='undefined')s.active=true;
    if(!s.billingType)s.billingType='lesson';
    if(typeof s.monthlyAmount==='undefined')s.monthlyAmount='';
    if(!s.monthlyMode)s.monthlyMode='presence';
    if(!Number(s.monthlyDuration))s.monthlyDuration=60;
    if(!['individual','regular'].includes(s.preferredRate))s.preferredRate='';
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
      if(l.status==='absent'&&typeof l.countAbsent!=='boolean')l.countAbsent=false;
    });
    data.meta.accountingV4Migrated=true;
    data.meta.accountingV4MigratedAt=new Date().toISOString();
    persistNow();
  } else {
    data.lessons.forEach(l=>{
      if(!l.status)l.status='scheduled';
      l.updatedAt=l.updatedAt||l.createdAt||new Date().toISOString();
      if(l.status==='absent'&&typeof l.countAbsent!=='boolean')l.countAbsent=false;
    });
  }
  // Tariffe e piani mensili. Le lezioni storiche senza tariffa restano da completare:
  // non inventiamo importi per dati già registrati.
  data.lessons.forEach(l=>{
    l.monthlyStudentIds=Array.isArray(l.monthlyStudentIds)?l.monthlyStudentIds:[];
    // Le lezioni create prima della V7.4 restano UNA lezione, qualunque fosse la durata storica.
    // In questo modo non cambiamo retroattivamente la contabilità precedente.
    if(!Number.isFinite(Number(l.lessonUnits))||Number(l.lessonUnits)<1)l.lessonUnits=1;
    l.lessonUnits=Math.max(1,Math.min(2,Math.round(Number(l.lessonUnits)||1)));
    if(!Number.isFinite(Number(l.baseDuration))||Number(l.baseDuration)<=0)l.baseDuration=Math.round((Number(l.duration)||60)/l.lessonUnits);
    if(!Number.isFinite(Number(l.duration))||Number(l.duration)<=0)l.duration=(Number(l.baseDuration)||60)*l.lessonUnits;
    if(!['individual','collective'].includes(l.lessonType))l.lessonType=(l.rateType==='collective'||(l.studentIds||[]).length>1)?'collective':'individual';
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
  data.meta.schema=Math.max(Number(data.meta.schema)||4,10);
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
  if(!data.meta.workflowV7Migrated){
    data.meta.workflowV7Migrated=true;
    data.meta.workflowV7MigratedAt=new Date().toISOString();
    persistNow();
  }
  if(!data.meta.managementV71Migrated){
    data.meta.managementV71Migrated=true;
    data.meta.managementV71MigratedAt=new Date().toISOString();
    persistNow();
  }
  if(!data.meta.durationUnitsV74Migrated){
    data.meta.durationUnitsV74Migrated=true;
    data.meta.durationUnitsV74MigratedAt=new Date().toISOString();
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
function lessonUnitCount(l){return Math.max(1,Math.min(2,Math.round(Number(l?.lessonUnits)||1)))}
function lessonBaseMinutes(l){const units=lessonUnitCount(l);return Number(l?.baseDuration)>0?Number(l.baseDuration):Math.round((Number(l?.duration)||60)/units)}
function lessonTotalMinutes(base=60,units=1){return (Number(base)||60)*Math.max(1,Math.min(2,Math.round(Number(units)||1)))}
function minutesToClock(total){total=((Number(total)||0)%1440+1440)%1440;return `${pad(Math.floor(total/60))}:${pad(total%60)}`}
function endTimeFromStart(time,duration){return minutesToClock(timeToMinutes(time)+(Number(duration)||60))}
function lessonTimeRange(l){return `${l.time}–${endTimeFromStart(l.time,l.duration)}`}
function lessonUnitsLabel(l){const u=lessonUnitCount(l),base=lessonBaseMinutes(l);return u===1?`1 lezione · ${durationLabel(base)}`:`${u} lezioni × ${durationLabel(base)} · ${durationLabel(l.duration)} totali`}
function lessonBlockLabel(l){return `${lessonTimeRange(l)} · ${lessonUnitsLabel(l)}`}
function lessonHasEnded(l){return lessonEndDate(l)<new Date()}
function isPastLesson(l){return lessonHasEnded(l)}
function isAccountingLesson(l){return l.status==='completed'||(l.status==='absent'&&l.countAbsent===true)}
function pendingPastLessons(){return data.lessons.filter(l=>l.status==='scheduled'&&lessonHasEnded(l)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))}
function recoveryLessons(){return data.lessons.filter(l=>l.status==='recovery').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))}
function lessonStatusText(l){
  if(l.status==='completed')return 'Svolta';
  if(l.status==='absent')return l.countAbsent?'Assente · conteggiata':'Assente · non conteggiata';
  if(l.status==='recovery')return 'Da recuperare';
  if(l.status==='cancelled')return 'Annullata';
  if(lessonHasEnded(l))return 'Da verificare';
  return 'Programmata';
}
function lessonStatusClass(l){
  if(l.status==='completed')return 's-paid';
  if(l.status==='absent')return l.countAbsent?'s-requested':'s-due';
  if(l.status==='recovery')return 's-requested';
  if(l.status==='cancelled')return 's-due';
  if(lessonHasEnded(l))return 's-requested';
  return 's-scheduled';
}
function monthClosure(mk){return data.monthClosures?.[mk]||null}
function isMonthClosed(mk){return !!monthClosure(mk)?.closedAt}
function ensureMonthOpen(mk,action='modificare'){if(isMonthClosed(mk)){toast(`${fmtMonth(mk)} è chiuso: riapri il mese prima di ${action}.`);return false}return true}
function lessonMonthOpen(l,action='modificare la lezione'){return ensureMonthOpen(String(l?.date||'').slice(0,7),action)}

function activeStudents(){return data.students.filter(s=>s.active!==false)}
function archivedStudents(){return data.students.filter(s=>s.active===false)}

function studentBillingType(s){return s?.billingType==='monthly'?'monthly':'lesson'}
function isMonthlyStudent(id){return studentBillingType(studentById(id))==='monthly'}
function monthlyAmountForStudent(s){const n=Number(String(s?.monthlyAmount??'').replace(',','.'));return Number.isFinite(n)&&n>=0?n:0}
function billingFormHtml(prefix,s={}){
  const type=studentBillingType(s),amount=esc(s.monthlyAmount??''),dur=Number(s.monthlyDuration)||60,pref=['individual','regular'].includes(s.preferredRate)?s.preferredRate:'';
  return `<div class="field"><label>Tipo pagamento</label><select class="input" id="${prefix}Billing" onchange="toggleBillingFields('${prefix}')"><option value="lesson" ${type==='lesson'?'selected':''}>A lezione</option><option value="monthly" ${type==='monthly'?'selected':''}>Mensile</option></select></div><div id="${prefix}LessonBox" style="${type==='lesson'?'':'display:none'}"><div class="field"><label>Tariffa preferita (facoltativa)</label><select class="input" id="${prefix}PreferredRate"><option value="" ${!pref?'selected':''}>Chiedi ogni volta</option><option value="individual" ${pref==='individual'?'selected':''}>Individuale · €20</option><option value="regular" ${pref==='regular'?'selected':''}>Cliente abituale · €15</option></select></div><div class="note"><b>Scorciatoia:</b> con un solo alunno il gestionale propone questa tariffa, ma puoi sempre cambiarla. Nelle lezioni con più ragazzi propone automaticamente la collettiva.</div></div><div id="${prefix}MonthlyBox" style="${type==='monthly'?'':'display:none'}"><div class="field"><label>Quota mensile</label><input class="input" id="${prefix}MonthlyAmount" inputmode="decimal" value="${amount}" placeholder="Es. 120"></div><div class="field"><label>Durata abituale</label><select class="input" id="${prefix}MonthlyDuration">${([60,90].includes(dur)?[60,90]:[dur,60,90]).filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<option value="${v}" ${dur===v?'selected':''}>${[60,90].includes(v)?durationLabel(v):durationLabel(v)+' · storico'}</option>`).join('')}</select></div><div class="note"><b>Mensile:</b> la quota non verrà richiesta a ogni lezione. Data, ora e modalità (DAD o presenza) vengono scelte ogni volta. La durata abituale serve solo come preselezione: puoi scegliere 1h o 1h30 e anche +2 a ogni appuntamento.</div></div>`;
}
function toggleBillingFields(prefix){
  const type=document.getElementById(prefix+'Billing')?.value||'lesson',box=document.getElementById(prefix+'MonthlyBox');
  if(box)box.style.display=type==='monthly'?'':'none';
  const lessonBox=document.getElementById(prefix+'LessonBox');if(lessonBox)lessonBox.style.display=type==='lesson'?'':'none';
}
function readBillingForm(prefix,base={}){
  const billingType=document.getElementById(prefix+'Billing')?.value||'lesson';
  const monthlyAmountRaw=(document.getElementById(prefix+'MonthlyAmount')?.value||'').trim().replace(',','.');
  if(billingType==='monthly'){
    const n=Number(monthlyAmountRaw);
    if(!Number.isFinite(n)||n<=0)throw new Error('Inserisci una quota mensile valida');
  }
  const preferredRate=billingType==='lesson'?(document.getElementById(prefix+'PreferredRate')?.value||''):'';
  return {
    billingType,
    preferredRate:['individual','regular'].includes(preferredRate)?preferredRate:'',
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
  const monthly=lessonMonthlyIds(l),billable=(l.studentIds||[]).filter(id=>!monthly.includes(id)),units=lessonUnitCount(l);
  if(!billable.length && monthly.length)return `Mensile · ${units} ${units===1?'lezione':'lezioni'}${monthly.length>1?' · '+monthly.length+' alunni':''}`;
  if(hasValidPricing(l)){
    const perUnit=`${rateLabel(l.rateType)} · ${fmtEuro(l.pricePerStudent)}${lessonIsCollective(l)?'/alunno':''}`;
    const base=units>1?`${perUnit} × ${units} = ${fmtEuro(Number(l.pricePerStudent)*units)}${lessonIsCollective(l)?'/alunno':''}`:perUnit;
    return monthly.length?`${base} · ${monthly.length} mensile${monthly.length>1?'i':''}`:base;
  }
  return '⚠ Tariffa da impostare';
}
function paymentBreakdownItems(x){
  if(x.planType==='monthly')return [{label:'Mensile',count:x.completedCount,unit:x.monthlyAmount,total:x.autoAmount,monthly:true}];
  const map=new Map();
  x.ls.forEach(l=>{
    if(studentIsMonthlyInLesson(l,x.student.id))return;
    const unit=lessonPriceForStudent(l,x.student.id);if(unit<=0)return;
    const units=lessonUnitCount(l),absent=l.status==='absent';
    const key=`${absent?'absent':l.rateType||'lesson'}_${unit}`;
    const cur=map.get(key)||{label:absent?'Assenza conteggiata':rateLabel(l.rateType),count:0,unit,total:0,monthly:false,absent};
    cur.count+=units;cur.total+=unit*units;map.set(key,cur);
  });
  return [...map.values()];
}
function paymentBreakdownHtml(x){
  if(x.planType==='monthly')return `<div class="note price-note"><b>Conteggio mensile:</b> ${x.completedCount} ${x.completedCount===1?'lezione svolta':'lezioni svolte'} · ${x.presenceLessons} presenza · ${x.dadLessons} DAD · ${fmtHours(x.hours)}.${x.absentBilledCount?`<br>${x.absentBilledCount} assenza/e conteggiata/e nello storico.`:''}<br><b>Quota mensile:</b> ${fmtEuro(x.monthlyAmount)}.</div>`;
  const items=paymentBreakdownItems(x);
  const lines=items.length?items.map(i=>`${i.count} ${i.absent?(i.count===1?'assenza':'assenze'):(i.count===1?'lezione':'lezioni')} ${i.label.toLowerCase()} × ${fmtEuro(i.unit)} = <b>${fmtEuro(i.total)}</b>`).join('<br>'):'Nessuna voce valorizzata.';
  return `<div class="note price-note"><b>Conteggio automatico:</b><br>${lines}<br><small>1h o 1,5h valgono una lezione. Con +2 il blocco vale due lezioni consecutive e il prezzo viene conteggiato due volte.</small></div>`;
}
function paymentBreakdownText(x){
  if(x.planType==='monthly')return `Mensile concordato: ${fmtEuro(x.monthlyAmount)}.`;
  const items=paymentBreakdownItems(x);
  return items.map(i=>`${i.count} ${i.absent?(i.count===1?'assenza':'assenze'):(i.count===1?'lezione':'lezioni')} ${i.label.toLowerCase()} x ${fmtEuro(i.unit)} = ${fmtEuro(i.total)}`).join('; ');
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
  const weekCount=weekDays.reduce((n,x)=>n+x.lessons.reduce((a,l)=>a+lessonUnitCount(l),0),0),todayUnits=ls.reduce((a,l)=>a+lessonUnitCount(l),0);
  document.getElementById('todayCount').textContent=`${weekCount} ${weekCount===1?'lezione':'lezioni'} nei prossimi 7 gg`;
  document.getElementById('statToday').textContent=todayUnits;
  document.getElementById('statWeek').textContent=weekCount;
  document.getElementById('statStudents').textContent=activeStudents().length;

  const alertBox=document.getElementById('accountingAlert');
  if(alertBox){
    const pending=pendingPastLessons(),pendingUnits=pending.reduce((a,l)=>a+lessonUnitCount(l),0);
    const needsBackup=shouldRemindBackup();
    const recoveries=recoveryLessons();
    const missingPricing=data.lessons.filter(l=>isAccountingLesson(l)&&!hasValidPricing(l));
    let html='';
    if(pending.length)html+=`<button class="account-alert warning" onclick="openReconciliation()"><span class="alert-icon">!</span><span><b>${pendingUnits} ${pendingUnits===1?'lezione da verificare':'lezioni da verificare'}</b><small>Conferma cosa è stato svolto prima della contabilità.</small></span><span class="arrow">›</span></button>`;
    if(recoveries.length)html+=`<button class="account-alert recovery" onclick="openRecoveries()"><span class="alert-icon">↻</span><span><b>${recoveries.length} ${recoveries.length===1?'lezione da recuperare':'lezioni da recuperare'}</b><small>Programma il recupero senza reinserire alunno, durata e tariffa.</small></span><span class="arrow">›</span></button>`;
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
    const mode=first?`${first.mode==='dad'?'DAD':'Presenza'}${lessonIsCollective(first)?' · collettiva':''}`:'Tocca per vedere il giorno';
    const dayUnits=x.lessons.reduce((a,l)=>a+lessonUnitCount(l),0);return `<button class="week-row ${i===0?'today-row':''} ${x.lessons.length?'has-lessons':''}" onclick="renderSummaryModal('${x.dk}')"><span class="week-date"><b>${x.d.getDate()}</b><small>${days[x.d.getDay()].slice(0,3)}</small></span><span class="week-info"><b>${esc(detail)}</b><small>${esc(mode)}</small></span><span class="week-count">${dayUnits||'–'}</span></button>`;
  }).join('');
}
function lessonCard(l){
  const names=lessonStudentNames(l),group=lessonIsCollective(l)?`<span class="pill group">${l.studentIds.length} ${l.studentIds.length===1?'alunno':'alunni'}</span>`:'',status=lessonStatusText(l),price=lessonPricingShort(l);
  return `<div class="card lesson" onclick="openLesson('${l.id}')"><div class="timebox">${l.time}</div><div><h3>${esc(names||'Alunno archiviato')}</h3><p>${lessonTimeRange(l)} · ${lessonUnitsLabel(l)}<br>${lessonIsCollective(l)?'Lezione collettiva':'Lezione individuale'} · <b>${status}</b><br>${price}</p></div><div>${group}<span class="pill ${l.mode==='dad'?'dad':'presence'}">${l.mode==='dad'?'DAD':'Presenza'}</span></div></div>`;
}
function openStudentForm(id,resume=false){
  const st=id?studentById(id):{name:'',phone:'',parentPhone:'',billingType:'lesson',preferredRate:'',monthlyAmount:'',monthlyMode:'presence',monthlyDuration:60};
  showModal(`<h2>${id?'Modifica alunno':'Nuovo alunno'}</h2><p class="sub">Contatti e piano di pagamento dell'alunno.</p><div class="field"><label>Nome e cognome</label><input class="input" id="sfName" value="${esc(st.name)}" placeholder="Es. Mario Rossi"></div><div class="field"><label>Telefono alunno</label><input class="input" id="sfPhone" value="${esc(st.phone||'')}" inputmode="tel" placeholder="+39..."></div><div class="field"><label>Telefono genitore (facoltativo)</label><input class="input" id="sfParent" value="${esc(st.parentPhone||'')}" inputmode="tel" placeholder="+39..."></div>${billingFormHtml('sf',st)}<button class="cta" onclick="saveStudent('${id||''}',${resume})">${id?'Salva modifiche':'Aggiungi alunno'}</button>${id?`<button class="cta danger" onclick="deleteStudentSafe('${id}')">Elimina alunno</button>`:''}`);
}
function saveStudent(id,resume=false){
  const name=document.getElementById('sfName').value.trim();if(!name){toast('Inserisci nome e cognome');return}
  const old=id?studentById(id):null;
  let billing;try{billing=readBillingForm('sf',old||{})}catch(e){toast(e.message);return}
  const obj=Object.assign({},old||{},billing,{id:id||uid(),name,phone:document.getElementById('sfPhone').value.trim(),parentPhone:document.getElementById('sfParent').value.trim(),active:id?(old?.active!==false):true});
  if(id){const i=data.students.findIndex(x=>x.id===id);data.students[i]=obj}else data.students.push(obj);
  save(id?'Modifica alunno':'Nuovo alunno');
  if(resume&&!id){wizard.studentIds=[obj.id];wizard.step=1;if(obj.billingType==='monthly'){wizard.mode=null;wizard.baseDuration=[60,90].includes(Number(obj.monthlyDuration))?Number(obj.monthlyDuration):60;wizard.lessonUnits=1;wizard.duration=wizard.baseDuration;wizard.rateType='monthly'}modalStack=[];renderWizard();toast('Alunno salvato e selezionato')} else {closeModal();toast('Alunno salvato')}
}
function deleteStudentSafe(id){
  const st=studentById(id);if(!st)return;
  const future=data.lessons.filter(l=>l.studentIds.includes(id)&&l.status!=='cancelled'&&lessonStartDate(l)>=new Date());
  const msg=future.length?`Eliminare ${st.name} dall'elenco? Le lezioni già svolte e la contabilità resteranno intatte. Le ${future.length} lezioni future verranno annullate solo per questo alunno.`:`Eliminare ${st.name} dall'elenco? Lo storico e la contabilità resteranno intatti e potrai ripristinarlo dalla sezione “Alunni eliminati”.`;
  if(!confirm(msg))return;
  st.active=false;st.deletedAt=new Date().toISOString();st.archivedAt=st.deletedAt;
  future.forEach(l=>{
    if(isMonthClosed(l.date.slice(0,7)))return;
    cancelStudentParticipationRaw(l,id,'alunno eliminato');
  });
  save('Eliminazione alunno');closeModal();toast('Alunno eliminato dall’elenco');
}
function archiveStudent(id){deleteStudentSafe(id)}
function restoreStudent(id){const s=studentById(id);if(!s)return;s.active=true;delete s.archivedAt;delete s.deletedAt;save('Ripristino alunno');openArchivedStudents();toast('Alunno ripristinato')}
function renderStudents(){
  const q=(document.getElementById('studentSearch')?.value||'').toLowerCase();
  const list=activeStudents().filter(st=>st.name.toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
  const box=document.getElementById('studentsList');if(!box)return;
  let html=list.length?list.map(st=>`<div class="card student" onclick="openStudent('${st.id}')"><div class="avatar">${esc(st.name.slice(0,1).toUpperCase())}</div><div class="main"><h3>${esc(st.name)}</h3><p>${esc(st.phone||'Nessun telefono')}${studentBillingType(st)==='monthly'?` · <b>Mensile ${fmtEuro(monthlyAmountForStudent(st))}</b>`:st.preferredRate?` · ${PREFERRED_RATE_LABELS[st.preferredRate]||''}`:''}</p></div><span class="arrow">›</span></div>`).join(''):`<div class="card empty"><span class="big">👩‍🎓</span>${activeStudents().length?'Nessun risultato':'Aggiungi il primo alunno.'}</div>`;
  if(archivedStudents().length)html+=`<button class="cta secondary compact-cta" onclick="openArchivedStudents()">Alunni eliminati (${archivedStudents().length})</button>`;
  box.innerHTML=html;
}
function openArchivedStudents(){
  const list=archivedStudents().sort((a,b)=>a.name.localeCompare(b.name));
  replaceModal(`<h2>Alunni eliminati</h2><p class="sub">Sono nascosti dall’elenco e dalle nuove lezioni, ma storico e contabilità restano protetti. Puoi ripristinarli.</p>${list.length?list.map(s=>`<div class="card student"><div class="avatar">${esc(s.name.slice(0,1).toUpperCase())}</div><div class="main"><h3>${esc(s.name)}</h3><p>${esc(s.phone||'Nessun telefono')}</p></div><div class="sendgrid" style="grid-template-columns:1fr 1fr;margin:0"><button class="smallbtn" onclick="openStudent('${s.id}')">Storico</button><button class="smallbtn wa" onclick="restoreStudent('${s.id}')">Ripristina</button></div></div>`).join(''):'<div class="empty">Nessun alunno eliminato.</div>'}`);
}
function openStudent(id){
  const st=studentById(id);if(!st)return;
  const ls=data.lessons.filter(l=>l.studentIds.includes(id)&&l.status==='completed').sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  const dad=ls.filter(l=>l.mode==='dad').reduce((a,l)=>a+l.duration/60,0),pr=ls.filter(l=>l.mode==='presence').reduce((a,l)=>a+l.duration/60,0);
  const missing=ls.filter(l=>!studentIsMonthlyInLesson(l,id)&&!hasValidPricing(l)).length;
  const perLessonRevenue=ls.reduce((a,l)=>a+lessonChargeForStudent(l,id),0),monthly=studentBillingType(st)==='monthly',lessonCount=ls.reduce((a,l)=>a+lessonUnitCount(l),0);
  showModal(`<h2>${esc(st.name)}</h2><p class="sub">${esc(st.phone||'Telefono non inserito')}${st.parentPhone?` · Genitore ${esc(st.parentPhone)}`:''}</p><div class="note price-note"><b>Piano:</b> ${monthly?`Mensile · ${fmtEuro(monthlyAmountForStudent(st))}/mese · modalità e durata modificabili ogni volta · predefinita ${durationLabel(Number(st.monthlyDuration)||60)}`:`Pagamento a lezione${st.preferredRate?` · preferita ${PREFERRED_RATE_LABELS[st.preferredRate]}`:''}`}</div>${missing?`<div class="note warning-note"><b>${missing} lezioni senza tariffa:</b> apri le lezioni storiche e assegna il prezzo per completare la contabilità.</div>`:''}<div class="statrow"><div class="stat"><b>${lessonCount}</b><small>Lezioni svolte</small></div><div class="stat"><b>${fmtHours(dad+pr)}</b><small>Ore totali</small></div><div class="stat"><b>${monthly?'Mensile':fmtEuro(perLessonRevenue)}</b><small>${monthly?'Piano attivo':'Totale lezioni'}</small></div></div><div class="section-title"><h2>Storico contabile</h2><button class="textbtn" onclick="openStudentForm('${id}')">Modifica</button></div>${ls.length?ls.map(l=>`<div class="card lesson" onclick="openLesson('${l.id}')"><div class="timebox">${l.time}</div><div><h3>${fmtDate(l.date)}</h3><p>${lessonBlockLabel(l)} · ${lessonTypeLabel(l)}<br>${studentIsMonthlyInLesson(l,id)?'Mensile':hasValidPricing(l)?`${rateLabel(l.rateType)} · ${fmtEuro(lessonPriceForStudent(l,id))}${lessonUnitCount(l)>1?` × ${lessonUnitCount(l)} = ${fmtEuro(lessonChargeForStudent(l,id))}`:''}`:'⚠ Tariffa mancante'}</p></div><span class="pill ${l.mode==='dad'?'dad':'presence'}">${l.mode==='dad'?'DAD':'Presenza'}</span></div>`).join(''):`<div class="empty">Nessuna lezione svolta registrata.</div>`}`);
}
function startLessonWizard(){
  wizard={step:0,introStep:'students',studentIds:[],appointments:[],date:'',time:'',baseDuration:60,lessonUnits:1,duration:60,mode:null,rateType:null,repeatWeeks:1,recoveryOf:null,lessonType:null,quickDuplicate:false,duplicateSourceId:null};
  modalStack=[];
  renderWizard();
}
function lessonIsCollective(l){return l?.lessonType==='collective'||l?.rateType==='collective'||(l?.studentIds||[]).length>1}
function lessonTypeLabel(l){return lessonIsCollective(l)?'Collettiva':'Individuale'}
function renderLessonTypeChooser(){wizard.introStep='type';wizard.step=0;renderWizard()}
function selectWizardLessonType(type){chooseWizardLessonType(type)}
function wizardMonthlyIds(){return wizard.studentIds.filter(id=>isMonthlyStudent(id))}
function wizardNonMonthlyIds(){return wizard.studentIds.filter(id=>!isMonthlyStudent(id))}
function isSingleMonthlyWizard(){return wizard.studentIds.length===1&&wizardMonthlyIds().length===1}
function allWizardStudentsMonthly(){return wizard.studentIds.length>0&&wizardNonMonthlyIds().length===0}
function wizardDots(){
  if(wizard.quickDuplicate){const cur=wizard.step===5?1:0;return `<div class="stepdots">${[0,1].map((_,i)=>`<span class="dot ${i<=cur?'on':''}"></span>`).join('')}</div>`}
  const noRate=allWizardStudentsMonthly()||wizard.lessonType==='collective';
  const total=noRate?4:5;
  let current=0;
  if(wizard.step===0)current=wizard.introStep==='type'?1:0;
  else if(wizard.step===1)current=2;
  else if(wizard.step===4)current=3;
  else if(wizard.step===5)current=noRate?3:4;
  return `<div class="stepdots">${Array.from({length:total},(_,i)=>`<span class="dot ${i<=current?'on':''}"></span>`).join('')}</div>`;
}
function wizardBack(){
  if(wizard.quickDuplicate){if(wizard.step===5){wizard.step=1;renderWizard();return}modalBack();return}
  if(wizard.step===0){if(wizard.introStep==='type'){wizard.introStep='students';renderWizard();return}modalBack();return}
  if(wizard.step===1){wizard.step=0;wizard.introStep='type';renderWizard();return}
  if(wizard.step===4){wizard.step=1;renderWizard();return}
  if(wizard.step===5){wizard.step=(allWizardStudentsMonthly()||wizard.lessonType==='collective')?1:4;renderWizard();return}
  wizard.step=1;renderWizard();
}
function timeFitsAvailability(t,duration){
  const start=timeToMinutes(t),end=start+(Number(duration)||60);
  return (start>=timeToMinutes('09:30')&&end<=timeToMinutes('13:30'))||(start>=timeToMinutes('15:00')&&end<=timeToMinutes('20:30'));
}
function allowedStartTimesForDuration(duration){return allowedLessonTimes().filter(t=>timeFitsAvailability(t,duration))}
function appointmentOccurrences(ap){
  const n=Math.max(1,Number(ap.repeatWeeks)||1),seriesId=n>1?(ap.seriesId||(ap.seriesId=uid())):null;
  return Array.from({length:n},(_,i)=>({appointmentId:ap.id,date:addDaysToKey(ap.date,i*7),time:ap.time,baseDuration:Number(ap.baseDuration)||60,lessonUnits:Math.max(1,Math.min(2,Number(ap.lessonUnits)||1)),duration:Number(ap.duration)||60,mode:ap.mode,repeatWeeks:n,seriesId}));
}
function wizardQueuedOccurrences(){return (wizard.appointments||[]).flatMap(appointmentOccurrences)}
function queuedOverlap(date,t,duration){return wizardQueuedOccurrences().filter(o=>o.date===date&&timeRangesOverlap(t,duration,o.time,o.duration))}
function wizardOverlapsAt(t){
  const actual=data.lessons.filter(l=>l.date===wizard.date&&l.status!=='cancelled'&&timeRangesOverlap(t,wizard.duration,l.time,l.duration));
  return [...actual,...queuedOverlap(wizard.date,t,wizard.duration)];
}
function collectiveSlotInfo(t){
  if(queuedOverlap(wizard.date,t,wizard.duration).length)return {time:t,state:'blocked',target:null,label:'già scelto in questo flusso'};
  const dayLessons=data.lessons.filter(l=>l.date===wizard.date&&l.status!=='cancelled');
  const sameStart=dayLessons.filter(l=>l.time===t);
  if(sameStart.length===1){
    const target=sameStart[0];
    const otherOverlaps=dayLessons.filter(l=>l.id!==target.id&&timeRangesOverlap(t,target.duration,l.time,l.duration));
    if(!otherOverlaps.length){
      if(target.studentIds.some(id=>wizard.studentIds.includes(id)))return {time:t,state:'blocked',target:null,label:'alunno già presente'};
      if(wizard.quickDuplicate&&(Number(target.duration)!==Number(wizard.duration)||target.mode!==wizard.mode))return {time:t,state:'blocked',target:null,label:'slot collettivo diverso'};
      return {time:t,state:'join',target,label:`già aperta · ${target.studentIds.length} ${target.studentIds.length===1?'alunno':'alunni'} · ${lessonUnitsLabel(target)} · ${target.mode==='dad'?'DAD':'Presenza'}`};
    }
  }
  const overlaps=dayLessons.filter(l=>timeRangesOverlap(t,wizard.duration,l.time,l.duration));
  if(!overlaps.length)return {time:t,state:'free',target:null,label:'libero'};
  return {time:t,state:'blocked',target:null,label:'sovrapposizione non compatibile'};
}
function wizardTimeOptions(){
  if(!wizard.date)return [];
  if(wizard.lessonType==='individual')return allowedStartTimesForDuration(wizard.duration).filter(t=>wizardOverlapsAt(t).length===0).map(t=>({time:t,state:'free',label:`libero · fino alle ${endTimeFromStart(t,wizard.duration)}`}));
  return allowedLessonTimes().map(t=>{const info=collectiveSlotInfo(t);if(info.state==='join')return timeFitsAvailability(t,info.target?.duration||wizard.duration)?info:{...info,state:'blocked'};if(info.state==='free'&&!timeFitsAvailability(t,wizard.duration))return {...info,state:'blocked'};if(info.state==='free')info.label=`libero · fino alle ${endTimeFromStart(t,wizard.duration)}`;return info}).filter(x=>x.state!=='blocked');
}
function setWizardDate(k){wizard.date=k;wizard.time='';if(!wizard.quickDuplicate)wizard.mode=null;renderWizard()}
function selectWizardTime(t){
  wizard.time=t;
  if(wizard.lessonType==='collective'){
    const info=collectiveSlotInfo(t);
    if(info.target&&!wizard.quickDuplicate){wizard.baseDuration=lessonBaseMinutes(info.target);wizard.lessonUnits=lessonUnitCount(info.target);wizard.duration=Number(info.target.duration)||wizard.duration;wizard.mode=info.target.mode}
  }
  renderWizard();
}
function setWizardBaseDuration(v){if(wizard.quickDuplicate)return;wizard.baseDuration=[60,90].includes(Number(v))?Number(v):60;wizard.duration=lessonTotalMinutes(wizard.baseDuration,wizard.lessonUnits);wizard.time='';wizard.mode=null;renderWizard()}
function setWizardUnits(v){if(wizard.quickDuplicate)return;wizard.lessonUnits=[1,2].includes(Number(v))?Number(v):1;wizard.duration=lessonTotalMinutes(wizard.baseDuration,wizard.lessonUnits);wizard.time='';wizard.mode=null;renderWizard()}
function individualRateChoicesHtml(selected){
  const defs=[['individual','👤','Individuale','20 €'],['regular','⭐','Cliente abituale','15 €']];
  return defs.map(([key,ico,label,price])=>`<button class="choice pricechoice ${selected===key?'selected':''}" onclick="wizard.rateType='${key}';renderWizard()"><span class="price-ico">${ico}</span><b>${label}</b><strong>${price}</strong><small>per lezione</small></button>`).join('');
}
function appointmentListHtml(){
  const list=wizard.appointments||[];
  if(!list.length)return `<div class="note"><b>Nessun appuntamento aggiunto.</b><br>Scegli giorno, ora e modalità, poi premi “Aggiungi appuntamento”.</div>`;
  return `<div class="section-title"><h2>Appuntamenti (${list.length})</h2><span style="color:var(--muted);font-size:11px">puoi aggiungerne altri</span></div>${list.map(ap=>`<div class="card" style="padding:12px"><div class="summary-head"><div><h3 style="margin:0 0 4px">${fmtDate(ap.date)} · ${ap.time}–${endTimeFromStart(ap.time,ap.duration)}</h3><p style="margin:0;color:var(--muted);font-size:12px">${ap.mode==='dad'?'💻 DAD':'🏠 Presenza'} · ${ap.lessonUnits} ${ap.lessonUnits===1?'lezione':'lezioni'} × ${durationLabel(ap.baseDuration)}${ap.repeatWeeks>1?` · ↻ ogni settimana × ${ap.repeatWeeks}`:''}</p></div><button class="smallbtn danger-mini" onclick="removeWizardAppointment('${ap.id}')">Elimina</button></div></div>`).join('')}`;
}
function plannerQuickDaysHtml(){
  const now=new Date(),opts=[];
  for(let i=0;i<7;i++){const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i),k=dateKey(d);opts.push(`<button class="choice daychoice ${wizard.date===k?'selected':''}" onclick="setWizardDate('${k}')"><b>${i===0?'Oggi':days[d.getDay()]}</b><small>${d.getDate()} ${months[d.getMonth()].slice(0,3)}</small></button>`)}
  return opts.join('');
}
function renderWizardPlanner(){
  const options=wizardTimeOptions();
  const duplicateNote=wizard.quickDuplicate?`<div class="note price-note"><b>Duplicazione rapida:</b> alunni, ${wizard.lessonType==='collective'?'collettiva':'individuale'}, ${durationLabel(wizard.duration)}, ${wizard.mode==='dad'?'DAD':'presenza'} e tariffa sono già preimpostati. Devi scegliere solo giorno e ora.</div>`:'';
  const durationHtml=wizard.quickDuplicate?'':`<div class="field"><label>Durata</label><div class="choices"><button class="choice ${wizard.baseDuration===60?'selected':''}" onclick="setWizardBaseDuration(60)"><b>1 ora</b><small>lezione standard</small></button><button class="choice ${wizard.baseDuration===90?'selected':''}" onclick="setWizardBaseDuration(90)"><b>1h 30m</b><small>lezione lunga</small></button></div></div><div class="field"><label>Lezioni consecutive</label><div class="choices"><button class="choice ${wizard.lessonUnits===1?'selected':''}" onclick="setWizardUnits(1)"><b>+1</b><small>1 lezione · ${durationLabel(wizard.baseDuration)}</small></button><button class="choice ${wizard.lessonUnits===2?'selected':''}" onclick="setWizardUnits(2)"><b>+2</b><small>2 lezioni · ${durationLabel(wizard.duration)} totali</small></button></div></div>`;
  const modeHtml=wizard.quickDuplicate?'':`<div class="field"><label>Modalità di questo appuntamento</label><div class="choices"><button class="choice ${wizard.mode==='presence'?'selected':''}" onclick="wizard.mode='presence';renderWizard()"><b>🏠 Presenza</b></button><button class="choice ${wizard.mode==='dad'?'selected':''}" onclick="wizard.mode='dad';renderWizard()"><b>💻 DAD</b></button></div></div>${wizard.mode==='dad'?`<div class="field"><label>Link DAD</label><input class="input" value="${esc(data.settings.dadLink||'')}" oninput="data.settings.dadLink=this.value"></div>`:''}`;
  return `${wizardDots()}<h2>${wizard.quickDuplicate?'Duplica lezione':'Programma le lezioni'}</h2><p class="sub">${wizard.quickDuplicate?'Tutto è già pronto: scegli una nuova data e un nuovo orario.':'Puoi aggiungere più giorni e orari nello stesso flusso, anche con modalità diverse.'}</p>${duplicateNote}${durationHtml}<div class="field"><label>Giorno</label><div class="choices">${plannerQuickDaysHtml()}</div></div><div class="field"><label>Altra data</label><input class="input" type="date" value="${wizard.date}" onchange="setWizardDate(this.value)"></div>${wizard.date?`<div class="field"><label>Orario</label>${options.length?`<div class="choices">${options.map(x=>`<button class="choice timechoice ${wizard.time===x.time?'selected':''} ${x.state==='join'?'busy-slot':''}" onclick="selectWizardTime('${x.time}')"><b>${x.time}</b><small>${x.state==='join'?'👥 '+x.label:x.label}</small></button>`).join('')}</div>`:`<div class="note warning-note"><b>Nessuno slot disponibile</b><br>Cambia giorno o durata.</div>`}</div>`:`<div class="note">Seleziona un giorno per vedere gli orari disponibili.</div>`}${modeHtml}<div class="field"><label>Ricorrenza di questo appuntamento</label><select class="input" onchange="wizard.repeatWeeks=Number(this.value);renderWizard()"><option value="1" ${wizard.repeatWeeks===1?'selected':''}>Solo questa data</option><option value="4" ${wizard.repeatWeeks===4?'selected':''}>Ogni settimana · 4 appuntamenti</option><option value="8" ${wizard.repeatWeeks===8?'selected':''}>Ogni settimana · 8 appuntamenti</option><option value="12" ${wizard.repeatWeeks===12?'selected':''}>Ogni settimana · 12 appuntamenti</option></select></div><button class="cta secondary" onclick="addWizardAppointment()">＋ Aggiungi appuntamento</button>${appointmentListHtml()}<button class="cta" onclick="finishWizardPlanning()" ${(wizard.appointments||[]).length?'':'disabled'}>Continua con ${(wizard.appointments||[]).length} ${(wizard.appointments||[]).length===1?'appuntamento':'appuntamenti'}</button>`;
}
function renderWizard(){
  if(wizard.step===0){
    if(wizard.introStep!=='type'){
      replaceModal(`${wizardDots()}<h2>Seleziona alunno/i</h2><p class="sub">Scegli uno o più alunni. Se non è ancora presente, puoi aggiungerlo qui.</p>${activeStudents().sort((a,b)=>a.name.localeCompare(b.name)).map(st=>`<label class="studentpick"><input type="checkbox" ${wizard.studentIds.includes(st.id)?'checked':''} onchange="toggleWizardStudent('${st.id}',this.checked)"><span>${esc(st.name)}${studentBillingType(st)==='monthly'?` · <b>Mensile ${fmtEuro(monthlyAmountForStudent(st))}</b>`:''}</span></label>`).join('')}<button class="cta secondary" onclick="openStudentFormFromWizard()">＋ Aggiungi alunno</button><div class="sticky-actions"><button class="cta" onclick="wizardNextStudents()">Continua</button></div>`);
    }else{
      const many=wizard.studentIds.length>1;
      replaceModal(`${wizardDots()}<h2>Tipo di lezione</h2><p class="sub">${many?'Hai selezionato più alunni: la lezione sarà collettiva.':'Scegli come verranno svolti gli appuntamenti.'}</p><div class="choices"><button class="choice ${wizard.lessonType==='individual'?'selected':''} ${many?'disabled':''}" ${many?'disabled':''} onclick="chooseWizardLessonType('individual')"><b>👤 Individuale</b><small>1 alunno · solo slot liberi</small></button><button class="choice ${wizard.lessonType==='collective'?'selected':''}" onclick="chooseWizardLessonType('collective')"><b>👥 Collettiva</b><small>1 o più alunni · anche slot collettivi già aperti</small></button></div>${many?`<div class="note"><b>${wizard.studentIds.length} alunni selezionati:</b> scegli Collettiva per continuare.</div>`:''}`);
    }
  }else if(wizard.step===1){
    replaceModal(renderWizardPlanner());
  }else if(wizard.step===4){
    replaceModal(`${wizardDots()}<h2>Tariffa lezione individuale</h2><p class="sub">La tariffa verrà applicata a tutti gli appuntamenti inseriti in questo flusso.</p><div class="price-grid">${individualRateChoicesHtml(wizard.rateType)}</div><button class="cta" onclick="wizardNextRate()">Continua</button>`);
  }else if(wizard.step===5){
    const occ=wizardOccurrences(),monthlyIds=wizardMonthlyIds(),nonMonthlyIds=wizardNonMonthlyIds(),price=nonMonthlyIds.length?rateAmount(wizard.rateType):0,totalUnits=occ.reduce((a,o)=>a+(Number(o.lessonUnits)||1),0),lessonTotal=price*nonMonthlyIds.length*totalUnits,collective=wizard.lessonType==='collective';
    const names=wizard.studentIds.map(id=>studentById(id)?.name).filter(Boolean).join(', '),monthlyDetails=monthlyIds.map(id=>{const st=studentById(id);return `${st?.name||'Alunno'}: mensile ${fmtEuro(monthlyAmountForStudent(st))}/mese`}).join('<br>');
    const plan=(wizard.appointments||[]).slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(ap=>`<div class="card" style="padding:12px"><b>${fmtDate(ap.date)} · ${ap.time}–${endTimeFromStart(ap.time,ap.duration)}</b><p style="margin:5px 0 0;color:var(--muted);font-size:12px">${ap.mode==='dad'?'💻 DAD':'🏠 Presenza'} · ${ap.lessonUnits} ${ap.lessonUnits===1?'lezione':'lezioni'} × ${durationLabel(ap.baseDuration)}${ap.repeatWeeks>1?` · ↻ ${ap.repeatWeeks} settimane`:''}</p></div>`).join('');
    replaceModal(`${wizardDots()}<h2>Conferma programmazione</h2><p class="sub">${wizard.quickDuplicate?'Lezione duplicata: controlla soltanto la nuova programmazione.':`Stai registrando ${occ.length} ${occ.length===1?'appuntamento':'appuntamenti'} in un’unica operazione.`}</p><div class="note price-note"><b>${esc(names)}</b><br>${collective?'👥 Collettiva':'👤 Individuale'} · ${totalUnits} ${totalUnits===1?'lezione':'lezioni'} contabili${nonMonthlyIds.length?` · Totale automatico ${fmtEuro(lessonTotal)}`:' · Piano mensile'}${monthlyDetails?`<br>${monthlyDetails}`:''}</div>${plan}<button class="cta" onclick="confirmWizard()">✓ Conferma tutto</button><button class="cta secondary" onclick="wizard.step=1;renderWizard()">Modifica appuntamenti</button>`);
  }
  const back=document.querySelector('#sheet .sheet-back');if(back)back.setAttribute('onclick','wizardBack()');
}
function chooseWizardLessonType(type){
  if(!['individual','collective'].includes(type))return;
  if(type==='individual'&&wizard.studentIds.length!==1){toast('Per Individuale seleziona un solo alunno');return}
  wizard.lessonType=type;wizard.time='';wizard.mode=null;wizard.appointments=[];
  if(type==='collective')wizard.rateType=wizardNonMonthlyIds().length?'collective':'monthly';
  else if(wizard.studentIds.length===1&&!isMonthlyStudent(wizard.studentIds[0])){const st=studentById(wizard.studentIds[0]);wizard.rateType=st?.preferredRate||null}else wizard.rateType='monthly';
  wizard.step=1;renderWizard();
}
function toggleWizardStudent(id,on){if(on&&!wizard.studentIds.includes(id))wizard.studentIds.push(id);if(!on)wizard.studentIds=wizard.studentIds.filter(x=>x!==id)}
function openStudentFormFromWizard(){
  const fresh={billingType:'lesson',preferredRate:'',monthlyAmount:'',monthlyMode:'presence',monthlyDuration:60};
  showModal(`<h2>Nuovo alunno</h2><p class="sub">Dopo il salvataggio torni alla programmazione.</p><div class="field"><label>Nome e cognome</label><input class="input" id="wfName"></div><div class="field"><label>Telefono alunno</label><input class="input" id="wfPhone" inputmode="tel"></div><div class="field"><label>Telefono genitore (facoltativo)</label><input class="input" id="wfParent" inputmode="tel"></div>${billingFormHtml('wf',fresh)}<button class="cta" onclick="saveStudentFromWizard()">Salva e seleziona</button>`);
}
function saveStudentFromWizard(){
  const name=document.getElementById('wfName').value.trim();if(!name){toast('Inserisci nome e cognome');return}
  let billing;try{billing=readBillingForm('wf',{})}catch(e){toast(e.message);return}
  const st=Object.assign({id:uid(),name,phone:document.getElementById('wfPhone').value.trim(),parentPhone:document.getElementById('wfParent').value.trim(),active:true},billing);
  data.students.push(st);if(!wizard.studentIds.includes(st.id))wizard.studentIds.push(st.id);if(st.billingType==='monthly'&&wizard.studentIds.length===1){wizard.mode=null;wizard.baseDuration=[60,90].includes(Number(st.monthlyDuration))?Number(st.monthlyDuration):60;wizard.lessonUnits=1;wizard.duration=wizard.baseDuration;wizard.rateType='monthly'}save('Nuovo alunno durante lezione');if(modalStack.length)modalStack.pop();renderWizard();
}
function wizardNextStudents(){if(!wizard.studentIds.length){toast('Seleziona almeno un alunno');return}wizard.lessonType=null;wizard.time='';wizard.mode=null;wizard.rateType=null;wizard.appointments=[];wizard.introStep='type';wizard.step=0;renderWizard()}
function addWizardAppointment(){
  if(!wizard.date){toast('Scegli il giorno');return}
  if(!wizard.time){toast('Scegli l’orario');return}
  if(wizard.mode!=='presence'&&wizard.mode!=='dad'){toast('Scegli DAD o presenza');return}
  if(!ensureMonthOpen(wizard.date.slice(0,7),'aggiungere una lezione'))return;
  const valid=wizardTimeOptions().some(x=>x.time===wizard.time);if(!valid){wizard.time='';toast('Questo orario non è più disponibile');renderWizard();return}
  if(wizard.lessonType==='collective'){
    const info=collectiveSlotInfo(wizard.time);if(info.target&&info.target.mode!==wizard.mode){toast(`Lo slot è già ${info.target.mode==='dad'?'DAD':'in presenza'}: usa la stessa modalità`);return}
  }
  const ap={id:uid(),date:wizard.date,time:wizard.time,baseDuration:wizard.baseDuration,lessonUnits:wizard.lessonUnits,duration:wizard.duration,mode:wizard.mode,repeatWeeks:Math.max(1,Number(wizard.repeatWeeks)||1),seriesId:null};
  wizard.appointments.push(ap);
  const hard=analyzeWizardConflicts().filter(x=>x.hard);
  if(hard.length){wizard.appointments.pop();toast(`Conflitto su ${fmtDate(hard[0].date)} alle ${hard[0].time}`);renderWizard();return}
  wizard.date='';wizard.time='';wizard.repeatWeeks=1;if(!wizard.quickDuplicate)wizard.mode=null;renderWizard();toast('Appuntamento aggiunto');
}
function removeWizardAppointment(id){wizard.appointments=(wizard.appointments||[]).filter(x=>x.id!==id);renderWizard()}
function finishWizardPlanning(){
  if(!(wizard.appointments||[]).length){toast('Aggiungi almeno un appuntamento');return}
  if(wizard.quickDuplicate){wizard.step=5;renderWizard();return}
  wizard.step=(allWizardStudentsMonthly()||wizard.lessonType==='collective')?5:4;renderWizard();
}
function wizardNextRate(){if(!wizardNonMonthlyIds().length){wizard.rateType='monthly';wizard.step=5;renderWizard();return}if(!['individual','regular'].includes(wizard.rateType)){toast('Scegli Individuale €20 oppure Cliente abituale €15');return}wizard.step=5;renderWizard()}
function timeToMinutes(t){const [h,m]=String(t||'00:00').split(':').map(Number);return h*60+m}
function timeRangesOverlap(t1,d1,t2,d2){const a=timeToMinutes(t1),b=a+(Number(d1)||60),c=timeToMinutes(t2),d=c+(Number(d2)||60);return a<d&&c<b}
function addDaysToKey(k,daysToAdd){const d=parseLocalDate(k);d.setDate(d.getDate()+daysToAdd);return dateKey(d)}
function wizardOccurrences(){return (wizard.appointments||[]).flatMap(appointmentOccurrences)}
function analyzeWizardConflicts(){
  const occ=wizardOccurrences();
  return occ.map((o,idx)=>{
    const overlaps=data.lessons.filter(l=>l.status!=='cancelled'&&l.date===o.date&&timeRangesOverlap(o.time,o.duration,l.time,l.duration));
    const sameStudent=overlaps.filter(l=>l.studentIds.some(id=>wizard.studentIds.includes(id)));
    const exact=overlaps.filter(l=>l.time===o.time&&Number(l.duration)===Number(o.duration)&&l.mode===o.mode&&!l.studentIds.some(id=>wizard.studentIds.includes(id)));
    const mergeTarget=wizard.lessonType==='collective'&&!sameStudent.length&&overlaps.length===1&&exact.length===1?exact[0]:null;
    const internal=occ.filter((x,j)=>j!==idx&&x.date===o.date&&timeRangesOverlap(o.time,o.duration,x.time,x.duration));
    return {...o,overlaps,sameStudent,mergeTarget,internal,hard:internal.length>0||!!sameStudent.length||(overlaps.length>0&&!mergeTarget)};
  });
}
function conflictNames(items){return items.map(x=>`${fmtDate(x.date)} ${x.time}`).join(', ')}
function openWizardConflict(conflicts){
  const hard=conflicts.filter(x=>x.hard),mergeable=conflicts.filter(x=>x.mergeTarget);
  const html=`<h2>Controllo sovrapposizioni</h2><p class="sub">Controllo tutti gli appuntamenti e le ricorrenze prima di salvarli.</p>${hard.length?`<div class="note warning-note"><b>Da correggere:</b><br>${hard.map(x=>`${fmtDate(x.date)} · ${x.time}: ${x.internal?.length?'si sovrappone a un altro appuntamento inserito nello stesso flusso':x.sameStudent.length?'uno degli alunni è già inserito':'c’è già una lezione che si sovrappone'}`).join('<br>')}</div>`:''}${mergeable.length?`<div class="note"><b>${mergeable.length} slot collettivi già aperti.</b><br>Posso aggiungere gli alunni selezionati alle lezioni esistenti nello stesso orario.</div>`:''}${!hard.length&&mergeable.length?`<button class="cta" onclick="commitWizardLessons(true)">👥 Unisci agli slot collettivi</button>`:''}<button class="cta secondary" onclick="closeModal();wizard.step=1;renderWizard()">Modifica appuntamenti</button>`;
  showModal(html);
}
function mergeStudentsIntoLesson(target){
  target.lessonType='collective';
  const monthlyIds=wizardMonthlyIds(),newIds=wizard.studentIds.filter(id=>!target.studentIds.includes(id));
  target.studentIds=[...target.studentIds,...newIds];target.monthlyStudentIds=[...new Set([...lessonMonthlyIds(target),...monthlyIds])];target.monthlyAmountsByStudent=Object.assign({},target.monthlyAmountsByStudent||{});
  monthlyIds.forEach(id=>{const st=studentById(id),amt=monthlyAmountForStudent(st);target.monthlyAmountsByStudent[id]=amt;ensureMonthlyPayment(id,target.date.slice(0,7),amt)});
  const billable=target.studentIds.filter(id=>!target.monthlyStudentIds.includes(id));if(billable.length){target.rateType='collective';target.pricePerStudent=10;target.pricingMissing=false}else{target.rateType='monthly';target.pricePerStudent=0;target.pricingMissing=false}
  target.updatedAt=new Date().toISOString();target.mergedAt=target.updatedAt;
}
function buildLessonForOccurrence(o){
  const monthlyIds=wizardMonthlyIds(),nonMonthlyIds=wizardNonMonthlyIds(),price=nonMonthlyIds.length?rateAmount(wizard.rateType):0,monthlyAmountsByStudent={};
  monthlyIds.forEach(id=>{const st=studentById(id);monthlyAmountsByStudent[id]=monthlyAmountForStudent(st)});
  const temp={date:o.date,time:o.time,duration:o.duration},past=lessonHasEnded(temp);
  const l={id:uid(),studentIds:[...wizard.studentIds],date:o.date,time:o.time,baseDuration:o.baseDuration,lessonUnits:o.lessonUnits,duration:o.duration,mode:o.mode,lessonType:wizard.lessonType||((wizard.studentIds.length>1||wizard.rateType==='collective')?'collective':'individual'),rateType:nonMonthlyIds.length?wizard.rateType:'monthly',pricePerStudent:price,monthlyStudentIds:[...monthlyIds],monthlyAmountsByStudent,pricingMissing:false,status:past?'completed':'scheduled',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),recoveryOf:wizard.recoveryOf||null,seriesId:o.seriesId||null,duplicatedFrom:wizard.duplicateSourceId||null};
  if(past)l.completedAt=new Date().toISOString();return l;
}
function commitWizardLessons(mergeExisting=false){
  const analysis=analyzeWizardConflicts();
  if(analysis.some(x=>x.hard)){openWizardConflict(analysis.filter(x=>x.hard||x.mergeTarget));return}
  if(analysis.some(x=>x.mergeTarget)&&!mergeExisting){openWizardConflict(analysis.filter(x=>x.mergeTarget));return}
  const created=[];let merged=0;
  for(const a of analysis){if(!ensureMonthOpen(a.date.slice(0,7),'aggiungere una lezione'))return;if(a.mergeTarget){mergeStudentsIntoLesson(a.mergeTarget);merged++;continue}const l=buildLessonForOccurrence(a);data.lessons.push(l);created.push(l);lessonMonthlyIds(l).forEach(id=>ensureMonthlyPayment(id,l.date.slice(0,7),l.monthlyAmountsByStudent[id]))}
  if(wizard.recoveryOf){const orig=data.lessons.find(l=>l.id===wizard.recoveryOf);if(orig){orig.recoveryScheduledAt=new Date().toISOString();orig.recoveryLessonIds=[...(orig.recoveryLessonIds||[]),...created.map(x=>x.id)]}}
  const total=created.length+merged;save(wizard.quickDuplicate?'Duplicazione lezione':wizard.recoveryOf?'Programmazione recupero':total>1?'Programmazione multipla':'Nuova lezione');closeModal();toast(total>1?`${total} appuntamenti registrati`:merged?'Alunno aggiunto alla lezione collettiva':created[0]?.status==='completed'?'Lezione passata registrata':'Lezione aggiunta');
  if(total===1&&created.length===1&&created[0].status==='scheduled'&&!wizard.recoveryOf)setTimeout(()=>openSendForLesson(created[0].id),250);
}
function confirmWizard(){
  if(!(wizard.appointments||[]).length){toast('Nessun appuntamento da salvare');return}
  const monthlyIds=wizardMonthlyIds(),nonMonthlyIds=wizardNonMonthlyIds(),price=nonMonthlyIds.length?rateAmount(wizard.rateType):0;if(nonMonthlyIds.length&&!price){toast('Tariffa non valida');return}
  for(const id of monthlyIds){const st=studentById(id),amt=monthlyAmountForStudent(st);if(amt<=0){toast(`Quota mensile non valida per ${st?.name||'alunno'}`);return}}
  const analysis=analyzeWizardConflicts(),conflicts=analysis.filter(x=>x.hard||x.mergeTarget);if(conflicts.length){openWizardConflict(conflicts);return}commitWizardLessons(false);
}
function makeTimes(start,end,step){let [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number),a=[],m=sh*60+sm,e=eh*60+em;for(;m<=e;m+=step)a.push(`${pad(Math.floor(m/60))}:${pad(m%60)}`);return a}
function allowedLessonTimes(){return [...makeTimes('09:30','13:30',30),...makeTimes('15:00','20:30',30)]}
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
function lessonChargeForStudent(l,sid=null){return lessonPriceForStudent(l,sid)*lessonUnitCount(l)}
function lessonRevenue(l){return (l?.studentIds||[]).reduce((sum,id)=>sum+lessonChargeForStudent(l,id),0)}
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

function cloneLessonForStudent(l,sid,overrides={}){
  const c=structuredClone(l),monthly=studentIsMonthlyInLesson(l,sid);
  c.id=uid();c.studentIds=[sid];c.monthlyStudentIds=monthly?[sid]:[];
  c.monthlyAmountsByStudent=monthly?{[sid]:Number(l.monthlyAmountsByStudent?.[sid])||monthlyAmountForStudent(studentById(sid))}:{};
  c.sourceLessonId=l.id;c.sourceSeriesId=l.seriesId||null;c.seriesId=null;c.detachedFromGroup=true;
  c.createdAt=new Date().toISOString();c.updatedAt=c.createdAt;
  Object.assign(c,overrides);
  return c;
}
function removeStudentParticipationRaw(l,sid){
  l.studentIds=(l.studentIds||[]).filter(id=>id!==sid);
  l.monthlyStudentIds=lessonMonthlyIds(l).filter(id=>id!==sid);
  const nextAmounts={};l.monthlyStudentIds.forEach(id=>{nextAmounts[id]=Number(l.monthlyAmountsByStudent?.[id])||monthlyAmountForStudent(studentById(id))});
  l.monthlyAmountsByStudent=nextAmounts;
  const billable=l.studentIds.filter(id=>!l.monthlyStudentIds.includes(id));
  if(!billable.length&&l.monthlyStudentIds.length){l.rateType='monthly';l.pricePerStudent=0;l.pricingMissing=false}
  else if(billable.length){
    if(!Number(l.pricePerStudent)&&rateAmount(l.rateType))l.pricePerStudent=rateAmount(l.rateType);
    l.pricingMissing=!Number(l.pricePerStudent);
    if(l.studentIds.length===1&&l.rateType==='collective')l.collectiveAfterCancellation=true;
  }
  l.updatedAt=new Date().toISOString();
  return l.studentIds.length>0;
}
function cancelStudentParticipationRaw(l,sid,reason='disdetta'){
  if(!l.studentIds.includes(sid))return null;
  if(l.studentIds.length===1){
    l.status='cancelled';l.cancelledAt=new Date().toISOString();l.cancelReason=reason;l.updatedAt=l.cancelledAt;return l;
  }
  const copy=cloneLessonForStudent(l,sid,{status:'cancelled',cancelledAt:new Date().toISOString(),cancelReason:reason,participantCancellation:true});
  removeStudentParticipationRaw(l,sid);data.lessons.push(copy);return copy;
}
function cancelStudentFromLesson(lid,sid){
  const l=data.lessons.find(x=>x.id===lid),st=studentById(sid);if(!l||!st)return;if(!lessonMonthOpen(l,'annullare la lezione'))return;
  if(!confirm(`Annullare la lezione di ${st.name} del ${fmtDate(l.date)} alle ${l.time}? Gli altri alunni della lezione non verranno modificati.`))return;
  cancelStudentParticipationRaw(l,sid,'disdetta alunno');save('Annullamento alunno da lezione');
  const original=data.lessons.find(x=>x.id===lid);if(original&&original.studentIds.length)openLesson(lid,true);else closeModal();toast('Lezione annullata solo per l’alunno');
}
function deleteStudentFromLesson(lid,sid){
  const l=data.lessons.find(x=>x.id===lid),st=studentById(sid);if(!l||!st)return;if(!lessonMonthOpen(l,'eliminare la lezione'))return;
  if(l.studentIds.length===1){deleteLesson(lid);return}
  if(!confirm(`Eliminare ${st.name} da questa lezione? A differenza di “Annulla”, non resterà una voce di disdetta per questo appuntamento.`))return;
  removeStudentParticipationRaw(l,sid);save('Eliminazione alunno da lezione');openLesson(lid,true);toast('Alunno eliminato dalla lezione');
}
function moveStudentFromLesson(lid,sid){
  const l=data.lessons.find(x=>x.id===lid),st=studentById(sid);if(!l||!st)return;if(!lessonMonthOpen(l,'modificare la lezione'))return;
  if(l.studentIds.length===1){openLessonEdit(lid);return}
  if(!confirm(`Modificare solo la lezione di ${st.name}? Verrà separata dalla collettiva; gli altri alunni resteranno invariati.`))return;
  const copy=cloneLessonForStudent(l,sid,{detachedForEdit:true});removeStudentParticipationRaw(l,sid);data.lessons.push(copy);save('Separazione alunno da lezione collettiva');openLessonEdit(copy.id);toast('Ora modifichi solo questo alunno');
}
function deleteLesson(id){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;if(!lessonMonthOpen(l,'eliminare la lezione'))return;
  const futureSeries=l.seriesId?data.lessons.filter(x=>x.seriesId===l.seriesId&&lessonStartDate(x)>=lessonStartDate(l)).length:0;
  if(futureSeries>1){
    showModal(`<h2>Elimina lezione</h2><p class="sub">Questa lezione fa parte di una serie ricorrente. Scegli cosa eliminare.</p><div class="note warning-note"><b>${fmtDate(l.date)} · ${l.time}</b><br>${esc(lessonStudentNames(l))}</div><button class="cta danger" onclick="performDeleteLesson('${id}',false)">Elimina solo questa</button><button class="cta danger" onclick="performDeleteLesson('${id}',true)">Elimina questa e le successive</button><button class="cta secondary" onclick="modalBack()">Annulla</button>`);return;
  }
  if(!confirm(`Eliminare definitivamente questa lezione del ${fmtDate(l.date)} alle ${l.time}? Può essere recuperata solo dalla cronologia di sicurezza.`))return;
  performDeleteLesson(id,false,true);
}
function performDeleteLesson(id,includeFuture=false,skipConfirm=false){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  let targets=includeFuture&&l.seriesId?data.lessons.filter(x=>x.seriesId===l.seriesId&&lessonStartDate(x)>=lessonStartDate(l)):[l];
  if(targets.some(x=>isMonthClosed(x.date.slice(0,7)))){toast('Una delle lezioni è in un mese chiuso: riaprilo prima');return}
  if(!skipConfirm&&!confirm(includeFuture?`Eliminare ${targets.length} lezioni della serie da questa data in poi?`:'Eliminare definitivamente questa lezione?'))return;
  const ids=new Set(targets.map(x=>x.id));data.lessons=data.lessons.filter(x=>!ids.has(x.id));save(includeFuture?'Eliminazione lezioni ricorrenti':'Eliminazione lezione');closeModal();toast(includeFuture?`${targets.length} lezioni eliminate`:'Lezione eliminata');
}
function startDuplicateLesson(id){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  const billable=l.studentIds.filter(sid=>!studentIsMonthlyInLesson(l,sid));
  if(billable.length&&!hasValidPricing(l)){toast('Imposta prima la tariffa della lezione da duplicare');return}
  wizard={step:1,introStep:'type',studentIds:[...l.studentIds],appointments:[],date:'',time:'',baseDuration:lessonBaseMinutes(l),lessonUnits:lessonUnitCount(l),duration:Number(l.duration)||60,mode:l.mode,rateType:l.rateType,repeatWeeks:1,recoveryOf:null,lessonType:lessonIsCollective(l)?'collective':'individual',quickDuplicate:true,duplicateSourceId:id};
  modalStack=[];renderWizard();toast('Duplica: scegli solo giorno e ora');
}
function openLesson(id,replace=false){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  const status=lessonStatusText(l),pastPending=l.status==='scheduled'&&lessonHasEnded(l),pricing=hasValidPricing(l),monthly=lessonMonthlyIds(l),billable=l.studentIds.filter(id=>!monthly.includes(id));
  const value=billable.length?fmtEuro(lessonRevenue(l)):'Mensile',locked=isMonthClosed(l.date.slice(0,7));
  const statusActions=lessonHasEnded(l)&&!locked?`<div class="section-title"><h2>Stato lezione</h2></div><div class="status-actions"><button class="choice ${l.status==='completed'?'selected':''}" onclick="setLessonStatus('${id}','completed')">✅ Svolta</button><button class="choice ${l.status==='absent'?'selected':''}" onclick="openAbsentOptions('${id}')">👤 Assente</button><button class="choice ${l.status==='recovery'?'selected':''}" onclick="setLessonStatus('${id}','recovery')">↻ Da recuperare</button><button class="choice ${l.status==='cancelled'?'selected':''}" onclick="setLessonStatus('${id}','cancelled')">✕ Annullata</button></div>`:'';
  const recoveryAction=l.status==='recovery'?`<button class="cta" onclick="startRecovery('${id}')">↻ Programma recupero</button>`:'';
  const participants=l.studentIds.map(sid=>{const st=studentById(sid);if(!st)return'';const monthly=studentIsMonthlyInLesson(l,sid);return `<div class="participant-row"><div class="participant-main"><b>${esc(st.name)}</b><small>${monthly?'Mensile':hasValidPricing(l)?`${rateLabel(l.rateType)} · ${fmtEuro(lessonPriceForStudent(l,sid))}${lessonUnitCount(l)>1?` × ${lessonUnitCount(l)} = ${fmtEuro(lessonChargeForStudent(l,sid))}`:''}`:'Tariffa da impostare'}</small></div>${!locked&&l.status!=='cancelled'?`<div class="participant-actions"><button class="smallbtn" onclick="moveStudentFromLesson('${id}','${sid}')">✎ Modifica</button><button class="smallbtn warn-mini" onclick="cancelStudentFromLesson('${id}','${sid}')">Annulla</button><button class="smallbtn danger-mini" onclick="deleteStudentFromLesson('${id}','${sid}')">Elimina</button></div>`:''}</div>`}).join('');
  const lessonHtml=`<h2>${esc(lessonStudentNames(l))}</h2><p class="sub">${fmtDate(l.date)} · ${lessonTimeRange(l)} · ${lessonUnitsLabel(l)}</p>${locked?`<div class="month-lock"><b>🔒 ${fmtMonth(l.date.slice(0,7))} chiuso</b><small>Riapri il mese da Pagamenti per modificare questa lezione.</small></div>`:''}<div class="lesson-status-line"><span class="status ${lessonStatusClass(l)}">${status.toUpperCase()}</span></div>${!pricing&&isAccountingLesson(l)?`<div class="note warning-note"><b>Tariffa mancante:</b> questa lezione non può essere valorizzata automaticamente. Premi “Modifica lezione” e scegli la tariffa.</div>`:''}<div class="statrow"><div class="stat"><b>${lessonUnitCount(l)}</b><small>${lessonUnitCount(l)===1?'lezione':'lezioni'}</small></div><div class="stat"><b>${durationLabel(l.duration)}</b><small>blocco totale</small></div><div class="stat"><b>${value}</b><small>${billable.length?'valore lezione':'piano'}</small></div></div><div class="note price-note"><b>${l.mode==='dad'?'💻 DAD':'🏠 Presenza'}</b> · ${lessonPricingShort(l)}</div>${pastPending?`<div class="note warning-note"><b>Contabilità:</b> questa lezione è passata ma non è stata ancora confermata. Scegli cosa è successo: non verrà conteggiata finché non la confermi.</div>`:''}${statusActions}${recoveryAction}<div class="section-title"><h2>Alunni della lezione</h2><span style="color:var(--muted);font-size:11px">${lessonIsCollective(l)?'gestibili singolarmente':'lezione individuale'}</span></div>${participants}${l.status!=='cancelled'?`<button class="cta secondary" onclick="startDuplicateLesson('${id}')">⧉ Duplica lezione</button>`:''}${!locked?`<button class="cta secondary" onclick="openLessonEdit('${id}')">✎ Modifica tutta la lezione</button>`:''}${l.status!=='cancelled'?`<button class="cta" onclick="openSendForLesson('${id}')">📲 Messaggi WhatsApp</button>`:''}${!locked?`<button class="cta danger" onclick="deleteLesson('${id}')">🗑 Elimina lezione</button>`:''}`;
  if(replace)replaceModal(lessonHtml);else showModal(lessonHtml);
}
function setLessonStatus(id,status){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;if(!lessonMonthOpen(l,'cambiare lo stato'))return;
  l.status=status;l.updatedAt=new Date().toISOString();delete l.countAbsent;
  if(status==='completed')l.completedAt=new Date().toISOString();else delete l.completedAt;
  if(status==='cancelled')l.cancelledAt=new Date().toISOString();else delete l.cancelledAt;
  if(status==='recovery')l.recoveryMarkedAt=new Date().toISOString();else delete l.recoveryMarkedAt;
  save(`Stato lezione: ${status}`);openLesson(id,true);toast(status==='completed'?'Lezione conteggiata':status==='recovery'?'Segnata da recuperare':'Stato aggiornato');
}
function openAbsentOptions(id){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;if(!lessonMonthOpen(l,'registrare l’assenza'))return;
  showModal(`<h2>Alunno assente</h2><p class="sub">Decidi se, secondo i vostri accordi, l’assenza deve essere conteggiata economicamente.</p><div class="choices"><button class="choice" onclick="setAbsentStatus('${id}',true)">💶 Conteggia<br><small>entra nel totale del mese</small></button><button class="choice" onclick="setAbsentStatus('${id}',false)">🚫 Non conteggiare<br><small>resta nello storico</small></button></div>`);
}
function setAbsentStatus(id,count){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;if(!lessonMonthOpen(l,'registrare l’assenza'))return;
  l.status='absent';l.countAbsent=!!count;l.absentAt=new Date().toISOString();l.updatedAt=l.absentAt;delete l.completedAt;delete l.cancelledAt;save('Registrazione assenza');modalStack.pop();openLesson(id,true);toast(count?'Assenza conteggiata':'Assenza non conteggiata');
}
function openRecoveries(){
  const list=recoveryLessons();
  showModal(`<h2>Lezioni da recuperare</h2><p class="sub">Non entrano nei conteggi finché non viene svolta una nuova lezione di recupero.</p>${list.length?list.map(l=>`<div class="card"><div class="summary-head"><div><h3>${fmtDate(l.date)} · ${l.time}</h3><p>${esc(lessonStudentNames(l))}<br>${lessonTimeRange(l)} · ${lessonUnitsLabel(l)} · ${l.mode==='dad'?'DAD':'Presenza'}</p></div><span class="status s-requested">DA RECUPERARE</span></div><button class="smallbtn" style="width:100%;margin-top:10px" onclick="startRecovery('${l.id}')">↻ Programma recupero</button></div>`).join(''):'<div class="empty">Nessun recupero in sospeso.</div>'}`);
}
function startRecovery(id){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  wizard={step:1,introStep:'type',studentIds:[...l.studentIds],appointments:[],date:'',time:'',baseDuration:lessonBaseMinutes(l),lessonUnits:lessonUnitCount(l),duration:Number(l.duration)||60,mode:l.mode,rateType:l.rateType,repeatWeeks:1,recoveryOf:id,lessonType:lessonIsCollective(l)?'collective':'individual',quickDuplicate:false,duplicateSourceId:null};
  modalStack=[];renderWizard();toast('Scegli uno o più appuntamenti di recupero');
}
function openLessonEdit(id){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  const times=allowedLessonTimes(),allMonthly=lessonMonthlyIds(l).length===l.studentIds.length&&l.studentIds.length>0,base=lessonBaseMinutes(l),units=lessonUnitCount(l);
  const baseOpts=([60,90].includes(base)?[60,90]:[base,60,90]).filter((v,i,a)=>a.indexOf(v)===i);
  showModal(`<h2>Modifica lezione</h2><p class="sub">Ogni modifica resta recuperabile dalla cronologia di sicurezza.</p><div class="field"><label>Alunni</label>${activeStudents().concat(archivedStudents().filter(st=>l.studentIds.includes(st.id))).filter((st,i,a)=>a.findIndex(x=>x.id===st.id)===i).sort((a,b)=>a.name.localeCompare(b.name)).map(st=>`<label class="studentpick"><input type="checkbox" name="editStudent" value="${st.id}" ${l.studentIds.includes(st.id)?'checked':''}><span>${esc(st.name)}${studentBillingType(st)==='monthly'?' · Mensile':''}${st.active===false?' · eliminato':''}</span></label>`).join('')}</div><div class="row"><div class="field"><label>Data</label><input class="input" id="editDate" type="date" value="${l.date}"></div><div class="field"><label>Ora inizio</label><select class="input" id="editTime">${times.map(t=>`<option ${t===l.time?'selected':''}>${t}</option>`).join('')}</select></div></div><div class="row"><div class="field"><label>Durata singola</label><select class="input" id="editBaseDuration">${baseOpts.map(v=>`<option value="${v}" ${v===base?'selected':''}>${[60,90].includes(v)?durationLabel(v):durationLabel(v)+' · storico'}</option>`).join('')}</select></div><div class="field"><label>Lezioni consecutive</label><select class="input" id="editLessonUnits"><option value="1" ${units===1?'selected':''}>+1</option><option value="2" ${units===2?'selected':''}>+2</option></select></div></div><div class="field"><label>Modalità</label><select class="input" id="editMode"><option value="presence" ${l.mode==='presence'?'selected':''}>Presenza</option><option value="dad" ${l.mode==='dad'?'selected':''}>DAD</option></select></div><div class="field"><label>Tariffa per gli alunni non mensili</label><select class="input" id="editRate"><option value="" ${allMonthly?'selected':''}>${allMonthly?'Mensile · nessun costo a lezione':'— Seleziona tariffa —'}</option><option value="collective" ${l.rateType==='collective'?'selected':''}>Collettiva · €10 per alunno / lezione</option><option value="individual" ${l.rateType==='individual'?'selected':''}>Individuale · €20 / lezione</option><option value="regular" ${l.rateType==='regular'?'selected':''}>Cliente abituale · €15 / lezione</option></select></div><div class="note"><b>+2:</b> il gestionale crea un solo blocco orario ma lo conta come due lezioni consecutive. Esempio: 1h30 +2 dalle 09:30 alle 12:30.</div><button class="cta" onclick="saveLessonEdit('${id}')">Salva modifiche</button>`);
}
function saveLessonEdit(id){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;if(!lessonMonthOpen(l,'modificare la lezione'))return;
  const ids=[...document.querySelectorAll('input[name="editStudent"]:checked')].map(x=>x.value);if(!ids.length){toast('Seleziona almeno un alunno');return}
  const oldMonthly=lessonMonthlyIds(l),monthlyIds=ids.filter(sid=>oldMonthly.includes(sid)||isMonthlyStudent(sid)),billableIds=ids.filter(sid=>!monthlyIds.includes(sid));
  let rate=document.getElementById('editRate').value;
  if(!billableIds.length)rate='monthly';
  if(billableIds.length&&!rate){toast('Seleziona la tariffa');return}
  if(rate==='collective'&&ids.length<2&&!(l.detachedFromGroup||l.collectiveAfterCancellation||(l.rateType==='collective'&&Number(l.pricePerStudent)===10))){toast('La tariffa collettiva richiede almeno 2 alunni');return}
  if((rate==='individual'||rate==='regular')&&ids.length!==1){toast('Questa tariffa richiede 1 alunno');return}
  const newDate=document.getElementById('editDate').value,monthlyAmountsByStudent={};if(!ensureMonthOpen(newDate.slice(0,7),'spostare la lezione'))return;
  monthlyIds.forEach(sid=>{monthlyAmountsByStudent[sid]=Number(l.monthlyAmountsByStudent?.[sid])||monthlyAmountForStudent(studentById(sid));ensureMonthlyPayment(sid,newDate.slice(0,7),monthlyAmountsByStudent[sid])});
  const editBase=Number(document.getElementById('editBaseDuration').value)||60,editUnits=Number(document.getElementById('editLessonUnits').value)||1,editDuration=lessonTotalMinutes(editBase,editUnits),editTime=document.getElementById('editTime').value;if(!timeFitsAvailability(editTime,editDuration)){toast('Questo blocco non entra negli orari 09:30–13:30 o 15:00–20:30');return}const conflicts=data.lessons.filter(x=>x.id!==l.id&&x.status!=='cancelled'&&x.date===newDate&&timeRangesOverlap(editTime,editDuration,x.time,x.duration));if(conflicts.length){toast('La modifica si sovrappone a un’altra lezione');return}l.studentIds=ids;l.monthlyStudentIds=monthlyIds;l.monthlyAmountsByStudent=monthlyAmountsByStudent;l.date=newDate;l.time=editTime;l.baseDuration=editBase;l.lessonUnits=editUnits;l.duration=editDuration;l.mode=document.getElementById('editMode').value;l.rateType=billableIds.length?rate:'monthly';l.pricePerStudent=billableIds.length?rateAmount(rate):0;l.lessonType=(rate==='collective'||ids.length>1||lessonIsCollective(l))?'collective':'individual';l.pricingMissing=false;l.updatedAt=new Date().toISOString();
  if(l.status==='completed'&&!lessonHasEnded(l)){l.status='scheduled';delete l.completedAt}
  save('Modifica lezione');modalStack.pop();openLesson(id,true);toast('Lezione aggiornata');
}
function buildMessage(l,s){const kind=l.mode==='dad'?'in modalità DAD':'in presenza',group=lessonIsCollective(l)?' La lezione sarà collettiva.':'',units=lessonUnitCount(l)>1?` Sono ${lessonUnitCount(l)} lezioni consecutive da ${durationLabel(lessonBaseMinutes(l))} (${durationLabel(l.duration)} totali).`:'',link=l.mode==='dad'&&data.settings.dadLink?` Link: ${data.settings.dadLink}`:'';return `Ciao ${s.name.split(' ')[0]}, confermo la lezione di matematica per ${fmtDate(l.date)} dalle ${l.time} alle ${endTimeFromStart(l.time,l.duration)}, ${kind}.${group}${units}${link}`}
function waUrl(phone,msg){const p=normalizePhone(phone);return `https://wa.me/${p.replace('+','')}?text=${encodeURIComponent(msg)}`}
function sendWhatsApp(lid,sid,target='student'){const l=data.lessons.find(x=>x.id===lid),s=studentById(sid);if(!l||!s)return;const phone=target==='parent'?(s.parentPhone||s.phone):s.phone;if(!phone){toast('Numero non inserito');return}window.location.href=waUrl(phone,buildMessage(l,s))}
function openSendForLesson(id){
  const l=data.lessons.find(x=>x.id===id);if(!l)return;
  showModal(`<h2>Invia conferme</h2><p class="sub">${fmtDate(l.date)} · ${lessonTimeRange(l)} · ${lessonUnitsLabel(l)} · ${l.mode==='dad'?'DAD':'Presenza'} · ${lessonTypeLabel(l)}</p>${l.studentIds.map(sid=>{const s=studentById(sid);if(!s)return'';return `<div class="card"><b>${esc(s.name)}</b><p style="color:var(--muted);font-size:12px">${esc(buildMessage(l,s))}</p><div class="sendgrid"><button class="smallbtn wa" onclick="sendWhatsApp('${l.id}','${sid}','student')">WhatsApp alunno</button>${s.parentPhone?`<button class="smallbtn wa" onclick="sendWhatsApp('${l.id}','${sid}','parent')">WhatsApp genitore</button>`:'<button class="smallbtn" disabled>Nessun genitore</button>'}</div></div>`}).join('')}<button class="cta secondary" onclick="modalBack()">Indietro</button>`);
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

function openSummary(){openThirtyDaySummary()}
function openThirtyDaySummary(){
  const now=new Date(),days30=[],start=dateKey(now),endDate=new Date(now.getFullYear(),now.getMonth(),now.getDate()+29),end=dateKey(endDate);
  for(let i=0;i<30;i++){
    const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i),dk=dateKey(d),lessons=data.lessons.filter(l=>l.date===dk&&l.status!=='cancelled').sort((a,b)=>a.time.localeCompare(b.time));
    days30.push({d,dk,lessons});
  }
  const all=days30.flatMap(x=>x.lessons),occupied=days30.filter(x=>x.lessons.length).length,lessonUnitsTotal=all.reduce((n,l)=>n+lessonUnitCount(l),0),appointments=all.reduce((n,l)=>n+l.studentIds.length*lessonUnitCount(l),0);
  replaceModal(`<h2>Prossimi 30 giorni</h2><p class="sub">Dal ${fmtDate(start)} al ${fmtDate(end)}. Qui trovi anche le lezioni create in serie.</p><div class="statrow"><div class="stat"><b>${lessonUnitsTotal}</b><small>Lezioni</small></div><div class="stat"><b>${appointments}</b><small>Posti alunno</small></div><div class="stat"><b>${occupied}</b><small>Giorni occupati</small></div></div><div class="note"><b>Gestione rapida:</b> tocca una lezione per modificarla, annullarla o eliminare anche un solo alunno senza toccare gli altri della collettiva.</div><div class="range30">${days30.map((x,i)=>`<div class="range-day ${i===0?'today-range':''}"><button class="range-head" onclick="renderSummaryModal('${x.dk}',true)"><span class="range-date"><b>${x.d.getDate()}</b><small>${days[x.d.getDay()].slice(0,3)}</small></span><span class="range-title"><b>${fmtDate(x.dk)}</b><small>${x.lessons.length?`${x.lessons.reduce((a,l)=>a+lessonUnitCount(l),0)} lezioni · ${x.lessons.length} ${x.lessons.length===1?'blocco':'blocchi'}`:'Nessuna lezione'}</small></span><span class="arrow">›</span></button>${x.lessons.length?`<div class="range-lessons">${x.lessons.map(l=>`<button class="range-lesson" onclick="openLesson('${l.id}')"><span class="range-time">${lessonTimeRange(l)}</span><span><b>${esc(lessonStudentNames(l))}</b><small>${l.mode==='dad'?'DAD':'Presenza'} · ${lessonTypeLabel(l)} · ${lessonUnitsLabel(l)}${l.seriesId?' · Ricorrente':''}</small></span><span class="range-mode ${l.mode==='dad'?'dad':'presence'}">${l.mode==='dad'?'DAD':'Aula'}</span></button>`).join('')}</div>`:''}</div>`).join('')}</div>`);
}
function renderSummaryModal(k,push=false){
  const ls=data.lessons.filter(l=>l.date===k&&l.status!=='cancelled').sort((a,b)=>a.time.localeCompare(b.time));
  const ended=ls.filter(l=>l.status==='scheduled'&&lessonHasEnded(l)),dayUnits=ls.reduce((a,l)=>a+lessonUnitCount(l),0),endedUnits=ended.reduce((a,l)=>a+lessonUnitCount(l),0),dayRevenue=ls.filter(isAccountingLesson).reduce((a,l)=>a+lessonRevenue(l),0),missing=ls.filter(l=>isAccountingLesson(l)&&!hasValidPricing(l)).length;
  const html=`<h2>Riepilogo</h2><p class="sub">Conferme agli alunni e chiusura contabile della giornata.</p><div class="row"><button class="choice ${k===dateKey(new Date())?'selected':''}" onclick="renderSummaryModal('${dateKey(new Date())}')">Oggi</button><button class="choice ${k===dateKey(new Date(Date.now()+86400000))?'selected':''}" onclick="renderSummaryModal('${dateKey(new Date(Date.now()+86400000))}')">Domani</button></div><div class="field"><label>Oppure scegli una data</label><input class="input" type="date" value="${k}" onchange="renderSummaryModal(this.value)"></div>${ended.length?`<div class="account-alert warning static-alert"><span class="alert-icon">!</span><span><b>${endedUnits} da verificare</b><small>Conferma le lezioni svolte prima di chiudere il giorno.</small></span></div>`:''}${missing?`<div class="account-alert warning static-alert"><span class="alert-icon">€</span><span><b>${missing} senza tariffa</b><small>Apri i dettagli e assegna il prezzo per completare la contabilità.</small></span></div>`:''}<div class="section-title"><h2>${fmtDate(k)}</h2><span style="color:var(--muted);font-size:12px">${dayUnits} lezioni · ${ls.length} ${ls.length===1?'blocco':'blocchi'}${dayRevenue?` · ${fmtEuro(dayRevenue)}`:''}</span></div>${ls.length?ls.map(l=>`<div class="card summary-card"><div class="summary-head"><div><h3>${lessonTimeRange(l)} · ${lessonUnitsLabel(l)}</h3><p>${esc(lessonStudentNames(l))}<br>${l.mode==='dad'?'💻 DAD':'🏠 Presenza'} · ${lessonIsCollective(l)?'👥 Collettiva · '+l.studentIds.length+' alunni':'👤 Individuale'} · <b>${lessonStatusText(l)}</b><br>${lessonPricingShort(l)}</p></div><span class="pill ${l.mode==='dad'?'dad':'presence'}">${l.mode==='dad'?'DAD':'Presenza'}</span></div><div class="sendgrid">${l.status==='scheduled'&&!lessonHasEnded(l)?`<button class="smallbtn wa" onclick="openSendForLesson('${l.id}')">Invia messaggi</button>`:`<button class="smallbtn" onclick="openLesson('${l.id}')">Contabilità</button>`}<button class="smallbtn" onclick="openLesson('${l.id}')">Dettagli</button></div></div>`).join(''):`<div class="card empty">Nessuna lezione per questa data.</div>`}${ended.length?`<button class="cta" onclick="closeDay('${k}')">✓ Chiudi giornata</button>`:''}${ls.length?`<button class="cta secondary" onclick="copyDaySummary('${k}')">Copia riepilogo completo</button>`:''}`;
  if(push)showModal(html);else replaceModal(html);
}
function closeDay(k){
  if(!ensureMonthOpen(k.slice(0,7),'chiudere la giornata'))return;
  const pending=data.lessons.filter(l=>l.date===k&&l.status==='scheduled'&&lessonHasEnded(l)),pendingUnits=pending.reduce((a,l)=>a+lessonUnitCount(l),0);
  if(!pending.length){toast('Giornata già verificata');return}
  if(!confirm(`Segnare come svolte tutte le ${pendingUnits} lezioni contenute in ${pending.length} ${pending.length===1?'blocco':'blocchi'} ancora da verificare? Potrai correggerle in seguito.`))return;
  pending.forEach(l=>{l.status='completed';l.completedAt=new Date().toISOString();l.updatedAt=new Date().toISOString()});save('Chiusura giornata');renderSummaryModal(k);toast('Giornata chiusa e conteggiata');
}
async function copyDaySummary(k){const ls=data.lessons.filter(l=>l.date===k&&l.status!=='cancelled').sort((a,b)=>a.time.localeCompare(b.time));const txt=`Riepilogo lezioni - ${fmtDate(k)}\n\n`+ls.map(l=>`${lessonTimeRange(l)} - ${lessonStudentNames(l)} - ${l.mode==='dad'?'DAD':'Presenza'} - ${lessonTypeLabel(l)} - ${lessonUnitsLabel(l)} - ${lessonPricingShort(l)} - ${lessonStatusText(l)}`).join('\n');try{await navigator.clipboard.writeText(txt);toast('Riepilogo copiato')}catch{prompt('Copia il riepilogo:',txt)}}
function openReconciliation(push=false){
  const pending=pendingPastLessons(),pendingUnits=pending.reduce((a,l)=>a+lessonUnitCount(l),0);
  if(!pending.length){toast('Contabilità aggiornata: nulla da verificare');return}
  const html=`<h2>Verifica ${pendingUnits} lezioni</h2><p class="sub">Queste lezioni sono passate ma non ancora confermate. Finché restano qui non entrano nei conteggi.</p><div class="note"><b>Regola di sicurezza:</b> scegli cosa è realmente successo per ogni appuntamento.</div>${pending.map(l=>`<div class="card"><div class="summary-head"><div><h3>${fmtDate(l.date)} · ${l.time}</h3><p>${esc(lessonStudentNames(l))}<br>${lessonTimeRange(l)} · ${lessonUnitsLabel(l)} · ${l.mode==='dad'?'DAD':'Presenza'} · ${lessonPricingShort(l)}</p></div><span class="status s-requested">DA VERIFICARE</span></div><div class="status-actions compact-status"><button class="smallbtn wa" onclick="reconcileOne('${l.id}','completed')">✅ Svolta</button><button class="smallbtn" onclick="openAbsentOptions('${l.id}')">👤 Assente</button><button class="smallbtn" onclick="reconcileOne('${l.id}','recovery')">↻ Recupero</button><button class="smallbtn" onclick="reconcileOne('${l.id}','cancelled')">✕ Annullata</button></div></div>`).join('')}<button class="cta" onclick="reconcileAllCompleted()">Segna tutte come svolte</button>`;
  if(push)showModal(html);else replaceModal(html);
}
function reconcileOne(id,status){const l=data.lessons.find(x=>x.id===id);if(!l)return;if(!lessonMonthOpen(l,'verificare la lezione'))return;l.status=status;l.updatedAt=new Date().toISOString();delete l.countAbsent;if(status==='completed')l.completedAt=new Date().toISOString();else delete l.completedAt;if(status==='cancelled')l.cancelledAt=new Date().toISOString();else delete l.cancelledAt;if(status==='recovery')l.recoveryMarkedAt=new Date().toISOString();save('Verifica lezione');if(pendingPastLessons().length)openReconciliation();else {if(modalStack.length)modalBack();else closeModal();toast('Tutto verificato')}}
function reconcileAllCompleted(){const p=pendingPastLessons();if(!p.length)return;if(p.some(l=>isMonthClosed(l.date.slice(0,7)))){toast('Ci sono lezioni in un mese chiuso: riaprilo prima');return}const units=p.reduce((a,l)=>a+lessonUnitCount(l),0);if(!confirm(`Confermare come svolte tutte le ${units} lezioni contenute in ${p.length} ${p.length===1?'blocco':'blocchi'}?`))return;p.forEach(l=>{l.status='completed';l.completedAt=new Date().toISOString();l.updatedAt=new Date().toISOString()});save('Verifica massiva lezioni');if(modalStack.length)modalBack();else closeModal();toast('Tutte le lezioni sono state conteggiate')}

function buildMonthRange(){const arr=[],d=new Date();for(let i=-11;i<=1;i++)arr.push(monthKey(new Date(d.getFullYear(),d.getMonth()+i,1)));return arr}
function paymentInfo(sid,mk){
  const st=studentById(sid),key=`${sid}_${mk}`,p=data.payments[key]||{amount:'',status:'due'};
  const completedLs=data.lessons.filter(l=>l.studentIds.includes(sid)&&l.date.startsWith(mk)&&l.status==='completed');
  const absentBilled=data.lessons.filter(l=>l.studentIds.includes(sid)&&l.date.startsWith(mk)&&l.status==='absent'&&l.countAbsent===true);
  const ls=[...completedLs,...absentBilled];
  const pending=data.lessons.filter(l=>l.studentIds.includes(sid)&&l.date.startsWith(mk)&&l.status==='scheduled'&&lessonHasEnded(l));
  const monthlyActivity=data.lessons.filter(l=>l.studentIds.includes(sid)&&l.date.startsWith(mk)&&studentIsMonthlyInLesson(l,sid)&&l.status!=='cancelled');
  const dadLs=completedLs.filter(l=>l.mode==='dad'),presenceLs=completedLs.filter(l=>l.mode==='presence'),dad=dadLs.reduce((a,l)=>a+l.duration/60,0),presence=presenceLs.reduce((a,l)=>a+l.duration/60,0),dadCount=dadLs.reduce((a,l)=>a+lessonUnitCount(l),0),presenceCount=presenceLs.reduce((a,l)=>a+lessonUnitCount(l),0),completedCount=completedLs.reduce((a,l)=>a+lessonUnitCount(l),0),absentBilledCount=absentBilled.reduce((a,l)=>a+lessonUnitCount(l),0);
  const monthlyLesson=monthlyActivity[0]||null;
  const planType=p.planType==='monthly'||!!monthlyLesson?'monthly':'lesson';
  let monthlyAmount=0;
  if(planType==='monthly'){
    monthlyAmount=Number(p.monthlyAmount);
    if(!Number.isFinite(monthlyAmount)||monthlyAmount<=0)monthlyAmount=Number(monthlyLesson?.monthlyAmountsByStudent?.[sid])||monthlyAmountForStudent(st);
  }
  const missingPrice=planType==='monthly'?[]:ls.filter(l=>!studentIsMonthlyInLesson(l,sid)&&!hasValidPricing(l));
  const autoAmount=planType==='monthly'?monthlyAmount:ls.reduce((a,l)=>a+lessonChargeForStudent(l,sid),0);
  return {student:st,ls,completedLs,pending,missingPrice,dad,presence,dadLessons:dadCount,presenceLessons:presenceCount,completedCount,absentBilledCount,hours:dad+presence,autoAmount,p,key,planType,monthlyAmount,monthlyActivityCount:monthlyActivity.reduce((a,l)=>a+lessonUnitCount(l),0)};
}
function paymentChanged(x){
  if(x.p.status!=='paid')return false;
  const currentIds=x.ls.map(l=>l.id).sort().join('|'),oldIds=(x.p.lessonIdsAtPayment||[]).slice().sort().join('|');
  const currentAmount=effectivePaymentAmount(x),oldAmount=Number(x.p.amountAtPayment??currentAmount),currentCount=x.ls.reduce((a,l)=>a+lessonUnitCount(l),0),oldCount=Number(x.p.lessonCountAtPayment??currentCount);
  return Math.abs(x.hours-Number(x.p.hoursAtPayment||0))>.001||currentIds!==oldIds||currentCount!==oldCount||Math.abs(currentAmount-oldAmount)>.001;
}
function monthlyRows(mk){return data.students.map(st=>paymentInfo(st.id,mk)).filter(x=>x.hours>0||x.pending.length||String(x.p.amount??'').trim()!==''||x.planType==='monthly'&&Number(x.monthlyAmount)>0&&(x.monthlyActivityCount||x.pending.length))}
function monthTotals(mk){
  const rows=monthlyRows(mk),lessonMap=new Map();rows.forEach(x=>x.completedLs.forEach(l=>lessonMap.set(l.id,l)));
  return {rows,students:rows.length,lessons:[...lessonMap.values()].reduce((a,l)=>a+lessonUnitCount(l),0),hours:rows.reduce((a,x)=>a+x.hours,0),auto:rows.reduce((a,x)=>a+x.autoAmount,0),final:rows.reduce((a,x)=>a+effectivePaymentAmount(x),0),paid:rows.filter(x=>x.p.status==='paid').reduce((a,x)=>a+effectivePaymentAmount(x),0),due:rows.filter(x=>x.p.status!=='paid').reduce((a,x)=>a+effectivePaymentAmount(x),0),pending:rows.reduce((a,x)=>a+x.pending.length,0),missing:rows.reduce((a,x)=>a+x.missingPrice.length,0)};
}
function renderPayments(){
  const line=document.getElementById('monthLine'),box=document.getElementById('paymentsList'),summary=document.getElementById('paymentSummary');if(!line||!box)return;
  line.innerHTML=buildMonthRange().map(k=>`<button class="monthbtn ${k===selectedPayMonth?'active':''}" onclick="selectedPayMonth='${k}';renderPayments()">${fmtMonth(k)}</button>`).join('');
  const t=monthTotals(selectedPayMonth),rows=t.rows,closure=monthClosure(selectedPayMonth);
  if(summary)summary.innerHTML=`${closure?`<div class="month-lock"><b>🔒 ${fmtMonth(selectedPayMonth)} chiuso</b><small>Chiuso il ${fmtDateTime(closure.closedAt)}. I dati sono bloccati finché non riapri il mese.</small></div>`:''}<div class="accounting-grid"><div class="stat"><b>${t.lessons}</b><small>Lezioni</small></div><div class="stat"><b>${fmtHours(t.hours)}</b><small>Ore</small></div><div class="stat"><b>${fmtEuro(t.auto)}</b><small>Calcolato</small></div><div class="stat"><b>${fmtEuro(t.final)}</b><small>Finale</small></div><div class="stat"><b>${fmtEuro(t.paid)}</b><small>Incassato</small></div><div class="stat ${t.due?'stat-warn':''}"><b>${fmtEuro(t.due)}</b><small>Da incassare</small></div></div>${t.missing?`<button class="account-alert warning static-alert" onclick="openMissingPricing('${selectedPayMonth}')"><span class="alert-icon">€</span><span><b>${t.missing} ${t.missing===1?'lezione senza tariffa':'lezioni senza tariffa'}</b><small>Vanno completate per avere un totale automatico corretto.</small></span><span class="arrow">›</span></button>`:''}${t.pending?`<button class="account-alert warning static-alert" onclick="openReconciliation(true)"><span class="alert-icon">!</span><span><b>${t.pending} da verificare</b><small>Non sono ancora conteggiate.</small></span><span class="arrow">›</span></button>`:''}<div class="sendgrid"><button class="smallbtn" onclick="exportMonthCSV('${selectedPayMonth}')">⬇ Esporta CSV</button>${closure?`<button class="smallbtn unlock" onclick="reopenMonth('${selectedPayMonth}')">🔓 Riapri mese</button>`:`<button class="smallbtn lock" onclick="closeMonth('${selectedPayMonth}')">🔒 Chiudi mese</button>`}</div>`;
  if(!rows.length){box.innerHTML=`<div class="card empty"><span class="big">€</span>Nessuna lezione conteggiata per ${fmtMonth(selectedPayMonth)}.</div>`;return}
  box.innerHTML=rows.sort((a,b)=>a.student.name.localeCompare(b.student.name)).map(x=>{
    const changed=paymentChanged(x),status=x.p.status||'due',label=changed?'⚠ MODIFICATO':status==='paid'?'PAGATO':status==='requested'?'NON PAGATO':'DA INVIARE',amount=effectivePaymentAmount(x);
    const detail=x.planType==='monthly'?`${x.completedCount} lezioni · <b>Mensile ${fmtEuro(x.monthlyAmount)}</b>${String(x.p.amount??'').trim()!==''?` · finale ${fmtEuro(amount)}`:''}`:`${x.completedCount} lezioni${x.absentBilledCount?` + ${x.absentBilledCount} ass. conteggiata/e`:''} · <b>${fmtEuro(amount)}</b>${String(x.p.amount??'').trim()!==''?' · finale manuale':' · automatico'}`;
    return `<div class="card payrow ${changed?'changed-payment':''}" onclick="openPayment('${x.student.id}','${selectedPayMonth}')"><div><h3>${esc(x.student.name)}${x.student.active===false?' · eliminato':''}</h3><p>${x.presenceLessons} presenza · ${x.dadLessons} DAD · ${fmtHours(x.hours)}<br>${detail}${x.pending.length?` · ⚠ ${x.pending.length} da verificare`:''}${x.missingPrice.length?` · ⚠ ${x.missingPrice.length} senza tariffa`:''}</p></div><span class="status ${changed?'s-requested':'s-'+status}">${label}</span></div>`;
  }).join('');
}
function monthSnapshot(mk){
  const t=monthTotals(mk);return {month:mk,closedAt:new Date().toISOString(),totals:{students:t.students,lessons:t.lessons,hours:t.hours,auto:t.auto,final:t.final,paid:t.paid,due:t.due},students:t.rows.map(x=>({id:x.student.id,name:x.student.name,lessons:x.completedCount,presence:x.presenceLessons,dad:x.dadLessons,absentBilled:x.absentBilledCount,hours:x.hours,calculated:x.autoAmount,final:effectivePaymentAmount(x),status:x.p.status||'due'}))};
}
function closeMonth(mk){
  if(isMonthClosed(mk)){toast('Il mese è già chiuso');return}
  if(mk>=monthKey(new Date())){toast('Puoi chiudere solo un mese già concluso');return}
  const t=monthTotals(mk);if(t.pending){toast(`Prima verifica ${t.pending} lezioni in sospeso`);return}if(t.missing){toast(`Prima completa ${t.missing} tariffe mancanti`);return}
  const notSent=t.rows.filter(x=>(x.p.status||'due')==='due');if(notSent.length){toast(`Prima invia il riepilogo a ${notSent.length} alunni`);return}
  if(!confirm(`Chiudere ${fmtMonth(mk)}? Lezioni e pagamenti del mese verranno bloccati. Potrai riaprirlo in seguito.`))return;
  data.monthClosures[mk]=monthSnapshot(mk);save('Chiusura mese');renderPayments();toast('Mese chiuso e protetto');
}
function reopenMonth(mk){
  if(!isMonthClosed(mk))return;if(!confirm(`Riaprire ${fmtMonth(mk)}? Potrai nuovamente modificare lezioni, importi e pagamenti.`))return;
  delete data.monthClosures[mk];save('Riapertura mese');renderPayments();toast('Mese riaperto');
}
function openMissingPricing(mk=null){
  const ls=data.lessons.filter(l=>(!mk||l.date.startsWith(mk))&&isAccountingLesson(l)&&!hasValidPricing(l)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  if(!ls.length){toast('Tutte le lezioni hanno una tariffa');return}
  showModal(`<h2>Tariffe da completare</h2><p class="sub">Sono lezioni storiche salvate prima dell'introduzione dei prezzi. Non assegno importi a caso: scegli tu la tariffa corretta.</p>${ls.map(l=>`<div class="ledger-row" onclick="openLesson('${l.id}')"><span><b>${fmtDate(l.date)} · ${l.time}</b><small>${esc(lessonStudentNames(l))} · ${l.mode==='dad'?'DAD':'Presenza'} · ${lessonTypeLabel(l)}</small></span><strong>Imposta €</strong></div>`).join('')}`);
}
function openPayment(sid,mk,replace=false){
  const x=paymentInfo(sid,mk),st=x.student,p=x.p,changed=paymentChanged(x),effective=effectivePaymentAmount(x),locked=isMonthClosed(mk);
  const editable=!locked;
  const html=`<h2>${esc(st.name)}</h2><p class="sub">Pagamento ${fmtMonth(mk)} · ${x.planType==='monthly'?'Piano mensile':'A lezione'}</p>${locked?`<div class="month-lock"><b>🔒 Mese chiuso</b><small>Riapri ${fmtMonth(mk)} dalla schermata Pagamenti per fare modifiche.</small></div>`:''}${x.pending.length?`<button class="account-alert warning static-alert" onclick="openReconciliation(true)"><span class="alert-icon">!</span><span><b>${x.pending.length} lezioni da verificare</b><small>Non sono ancora incluse nei conteggi qui sotto.</small></span><span class="arrow">›</span></button>`:''}${x.missingPrice.length?`<button class="account-alert warning static-alert" onclick="openMissingPricing('${mk}')"><span class="alert-icon">€</span><span><b>${x.missingPrice.length} lezioni senza tariffa</b><small>Il totale automatico è incompleto finché non assegni il prezzo.</small></span><span class="arrow">›</span></button>`:''}${changed?`<div class="note warning-note"><b>Attenzione:</b> il mese è stato modificato dopo che era stato segnato pagato. Verifica lezioni e importo.</div>`:''}<div class="statrow"><div class="stat"><b>${x.completedCount}</b><small>Lezioni svolte</small></div><div class="stat"><b>${x.presenceLessons}/${x.dadLessons}</b><small>Presenza / DAD</small></div><div class="stat"><b>${fmtHours(x.hours)}</b><small>Ore</small></div></div>${paymentBreakdownHtml(x)}<div class="payment-total-line"><span>Totale calcolato</span><b>${fmtEuro(x.autoAmount)}</b></div>${editable?`<div class="field"><label>Totale finale manuale (facoltativo)</label><input class="input" id="payAmount" inputmode="decimal" value="${esc(p.amount||'')}" placeholder="Lascia vuoto per usare ${fmtEuro(x.autoAmount)}"></div><button class="cta secondary" onclick="savePaymentAmount('${sid}','${mk}')">Salva sconto / cifra particolare</button>`:String(p.amount??'').trim()!==''?`<div class="note"><b>Totale manuale applicato:</b> ${fmtEuro(effective)}</div>`:''}<div class="payment-total-big"><span>Totale finale</span><b>${fmtEuro(effective)}</b></div>${editable?`<div class="sendgrid"><button class="smallbtn wa" onclick="sendPayment('${sid}','${mk}','student')">WhatsApp alunno</button>${st.parentPhone?`<button class="smallbtn wa" onclick="sendPayment('${sid}','${mk}','parent')">WhatsApp genitore</button>`:'<button class="smallbtn" disabled>Nessun genitore</button>'}</div><div class="choices" style="margin-top:10px"><button class="choice ${p.status==='requested'?'selected':''}" onclick="setPaymentStatus('${sid}','${mk}','requested')">🟡 Non pagato</button><button class="choice ${p.status==='paid'?'selected':''}" onclick="setPaymentStatus('${sid}','${mk}','paid')">🟢 Pagato</button></div><button class="cta danger" onclick="setPaymentStatus('${sid}','${mk}','due')">Segna da inviare</button>`:''}<div class="section-title"><h2>Registro contabile</h2><span style="color:var(--muted);font-size:12px">${x.completedCount} svolte${x.absentBilledCount?` · ${x.absentBilledCount} ass.`:''}</span></div>${x.ls.length?x.ls.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(l=>`<div class="ledger-row" onclick="openLesson('${l.id}')"><span><b>${fmtDate(l.date)}</b><small>${lessonTimeRange(l)} · ${lessonUnitsLabel(l)} · ${l.mode==='dad'?'DAD':'Presenza'} · ${lessonTypeLabel(l)} · ${lessonStatusText(l)} · ${studentIsMonthlyInLesson(l,sid)?'Mensile':hasValidPricing(l)?rateLabel(l.rateType):'Tariffa mancante'}</small></span><strong>${studentIsMonthlyInLesson(l,sid)?'Mensile':hasValidPricing(l)?fmtEuro(lessonChargeForStudent(l,sid)):'—'}</strong></div>`).join(''):'<div class="empty">Nessuna lezione conteggiata.</div>'}`;
  if(replace)replaceModal(html);else showModal(html);
}
function savePaymentAmount(sid,mk){
  if(!ensureMonthOpen(mk,'modificare il totale'))return;
  const key=`${sid}_${mk}`,raw=document.getElementById('payAmount').value.trim().replace(',','.');
  if(raw!=='' && (!Number.isFinite(Number(raw))||Number(raw)<0)){toast('Inserisci un totale valido');return}
  data.payments[key]=Object.assign({},data.payments[key]||{},{amount:raw,status:data.payments[key]?.status||'due',updatedAt:new Date().toISOString()});save('Correzione totale pagamento');openPayment(sid,mk,true);toast(raw===''?'Ripristinato totale automatico':'Totale manuale salvato');
}
function setPaymentStatus(sid,mk,status){
  if(!ensureMonthOpen(mk,'modificare il pagamento'))return;
  const x=paymentInfo(sid,mk),key=x.key,p=Object.assign({},data.payments[key]||{});
  if(status==='paid' && x.pending.length){toast('Prima verifica le lezioni in sospeso');return}
  if(status==='paid' && x.missingPrice.length && String(p.amount??'').trim()===''){toast('Prima completa le tariffe mancanti o inserisci un totale manuale');return}
  p.status=status;p.updatedAt=new Date().toISOString();p[status+'At']=new Date().toISOString();
  if(status==='paid'){p.hoursAtPayment=x.hours;p.lessonIdsAtPayment=x.ls.map(l=>l.id);p.lessonCountAtPayment=x.ls.reduce((a,l)=>a+lessonUnitCount(l),0);p.amountAtPayment=effectivePaymentAmount({...x,p});p.autoAmountAtPayment=x.autoAmount;p.paidSnapshotAt=new Date().toISOString()}
  data.payments[key]=p;save(`Pagamento ${status}`);openPayment(sid,mk,true);toast(status==='paid'?'Segnato come pagato':status==='requested'?'Segnato come non pagato':'Segnato da inviare');
}
function sendPayment(sid,mk,targetType='student'){
  if(!ensureMonthOpen(mk,'inviare/modificare il riepilogo'))return;
  const x=paymentInfo(sid,mk),st=x.student,key=x.key;
  if(x.pending.length){toast('Prima verifica le lezioni in sospeso');return}
  const manual=document.getElementById('payAmount')?.value.trim()??String(x.p.amount||'');
  if(x.missingPrice.length&&!manual){toast('Prima completa le tariffe mancanti o inserisci un totale manuale');return}
  if(manual!==''&&(!Number.isFinite(Number(manual.replace(',','.')))||Number(manual.replace(',','.'))<0)){toast('Totale non valido');return}
  const amount=manual!==''?Number(manual.replace(',','.')):x.autoAmount,target=targetType==='parent'?st.parentPhone:st.phone;if(!target){toast('Numero non inserito');return}
  data.payments[key]=Object.assign({},data.payments[key]||{},{amount:manual,status:'requested',requestedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});save('Invio richiesta pagamento');
  const first=st.name.split(' ')[0],breakdown=paymentBreakdownText(x);
  const finalLine=manual!==''&&Math.abs(amount-x.autoAmount)>.001?` Totale calcolato: ${fmtEuro(x.autoAmount)}. Totale finale applicato: ${fmtEuro(amount)}.`:` Totale: ${fmtEuro(amount)}.`;
  const msg=`Buonasera, riepilogo lezioni di matematica di ${first} per ${fmtMonth(mk).toLowerCase()}: ${x.completedCount} lezioni svolte (${x.presenceLessons} presenza, ${x.dadLessons} DAD, ${fmtHours(x.hours)})${x.absentBilledCount?` e ${x.absentBilledCount} assenza/e conteggiata/e`:''}. ${breakdown}${finalLine} Grazie.`;
  window.location.href=waUrl(target,msg);
}
function openPaymentReminder(force=false){
  const now=new Date();if(!force&&now.getDate()<2)return;const prev=monthKey(new Date(now.getFullYear(),now.getMonth()-1,1));
  const pending=data.students.map(st=>paymentInfo(st.id,prev)).filter(x=>(x.hours>0||x.planType==='monthly'&&x.monthlyActivityCount)&&(force?x.p.status!=='paid':(x.p.status||'due')==='due'));
  if(!pending.length){if(force)toast('Nessun pagamento in sospeso');return}
  showModal(`<h2>🔔 Pagamenti ${fmtMonth(prev)}</h2><p class="sub">Hai ${pending.length} ${pending.length===1?'alunno':'alunni'} da controllare.</p>${pending.map(x=>`<div class="card payrow" onclick="openPayment('${x.student.id}','${prev}')"><div><h3>${esc(x.student.name)}</h3><p>${x.completedCount} lezioni · ${x.planType==='monthly'?`Mensile ${fmtEuro(x.monthlyAmount)}`:fmtEuro(effectivePaymentAmount(x))}${x.p.amount?' · totale manuale':''}${x.pending.length?` · ⚠ ${x.pending.length} da verificare`:''}${x.missingPrice.length?` · ⚠ ${x.missingPrice.length} senza tariffa`:''}</p></div><span class="status s-${x.p.status||'due'}">${x.p.status==='requested'?'NON PAGATO':'DA INVIARE'}</span></div>`).join('')}<button class="cta secondary" onclick="modalBack()">Indietro</button>`);
}
function exportMonthCSV(mk){
  const rows=[['Data','Ora_inizio','Ora_fine','Alunno','Modalita','Lezioni_consecutive','Durata_singola_min','Durata_totale_min','Tipo','Piano','Tariffa','Prezzo_singola_lezione','Totale_blocco_alunno','Quota_mensile','Stato_lezione','Totale_mese_calcolato','Totale_mese_manuale','Stato_pagamento']];
  data.lessons.filter(l=>l.date.startsWith(mk)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).forEach(l=>{
    l.studentIds.forEach(sid=>{const st=studentById(sid),x=paymentInfo(sid,mk),p=x.p,monthly=studentIsMonthlyInLesson(l,sid);rows.push([l.date,l.time,endTimeFromStart(l.time,l.duration),st?.name||'Alunno archiviato',l.mode==='dad'?'DAD':'Presenza',lessonUnitCount(l),lessonBaseMinutes(l),l.duration,lessonTypeLabel(l),monthly?'Mensile':'A lezione',monthly?'Mensile':rateLabel(l.rateType),monthly?'':lessonPriceForStudent(l,sid),monthly?'':lessonChargeForStudent(l,sid),monthly?(l.monthlyAmountsByStudent?.[sid]||x.monthlyAmount):'',lessonStatusText(l),x.autoAmount,p.amount||'',p.status==='paid'?'Pagato':p.status==='requested'?'Non pagato':'Da inviare'])});
  });
  const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n');downloadBlob(csv,`registro-lezioni-${mk}.csv`,'text/csv;charset=utf-8');toast('Registro mensile esportato');
}
function openSettings(){
  const hist=loadHistory(),lastBackup=data.meta?.lastBackupAt;
  showModal(`<h2>Impostazioni</h2><p class="sub">Link DAD e sicurezza dei dati.</p><div class="note"><b>🕘 Orari lezioni fissi</b><br>09:30–13:30 · 15:00–20:30<br><small>Gli altri orari sono stati rimossi dal gestionale.</small></div><div class="field"><label>Link fisso DAD</label><input class="input" id="setDad" value="${esc(data.settings.dadLink||'')}" placeholder="https://..."></div><button class="cta" onclick="saveSettings()">Salva impostazioni</button><div class="section-title"><h2>Sicurezza dati</h2></div><div class="note"><b>Ultimo backup esterno:</b> ${lastBackup?fmtDateTime(lastBackup):'mai'}.<br>I salvataggi automatici sul telefono aiutano contro errori, ma non proteggono da perdita/guasto del telefono.</div><div class="sendgrid"><button class="smallbtn" onclick="exportBackup()">⬇ Esporta backup</button><button class="smallbtn" onclick="shareBackup()">↗ Condividi backup</button></div><div class="sendgrid"><button class="smallbtn" onclick="document.getElementById('importFile').click()">⬆ Importa backup</button><button class="smallbtn" onclick="openSafetyHistory()">↶ Cronologia (${hist.length})</button></div>`);
}
function saveSettings(){data.settings.start='09:30';data.settings.end='20:30';data.settings.step=30;data.settings.dadLink=document.getElementById('setDad').value.trim();save('Impostazioni');closeModal();toast('Impostazioni salvate')}
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
