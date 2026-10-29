#!/usr/bin/env node
/*
 * Самопроверка тренажёра без браузера.
 *
 * Запуск:  node tools/selftest.js [число повторов]
 *
 * Что проверяется:
 *   1) скрипт из index.html выполняется без ошибок (заглушки DOM и localStorage);
 *   2) у каждой задачи, которую видит ученик, ответ сходится с собственной проверкой v();
 *   3) в условиях и разборах нет undefined/NaN/Infinity;
 *   4) у задач серий и тем есть «Идея» и две подсказки;
 *   5) все экраны (главная, серии, практика, геометрия, графики, часть 2, диагностика)
 *      собираются и проходятся до результата без исключений.
 *
 * Каждая задача считает ответ по тем же числам, что стоят в условии, поэтому такой тест
 * ловит расхождения ключа и разбора при изменении генераторов.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) {
  console.error('В index.html не найден <script>');
  process.exit(1);
}
const code = m[1];
const N = Number(process.argv[2]) || 120;

/* ---------- минимальные заглушки браузера ---------- */
function el() {
  return new Proxy(
    { innerHTML: '', textContent: '', value: '', classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, style: {}, dataset: {} },
    { get(t, k) { return k in t ? t[k] : () => {}; }, set(t, k, v) { t[k] = v; return true; } }
  );
}
global.document = { getElementById: () => el(), addEventListener() {}, querySelector: () => null, createElement: () => el(), body: el() };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: () => Promise.resolve() } }, configurable: true });
global.window = global;
global.scrollTo = () => {};

const test = `
const problems=[];
const push=(s)=>problems.push(s);
const textCheck=(tag,t)=>{
  if(/undefined|NaN|Infinity/.test(t)) push(tag+' : в тексте undefined/NaN');
};
const checkQ=(tag,q)=>{
  textCheck(tag,String(q.q)+' '+String(q.why||''));
  if(q.a===undefined){ if(q.hasA!==false) push(tag+' : нет ответа'); return; }
  if(typeof q.a!=='number'||!isFinite(q.a)){ push(tag+' : ответ не число ('+q.a+')'); return; }
  if(typeof q.v==='function' && !q.v(q.a)) push(tag+' : ответ не проходит собственную проверку v() = '+q.a);
};
const checkMeta=(tag,q)=>{
  if(!q.hints||q.hints.length<2) push(tag+' : нет двух подсказок');
  if(!q.idea) push(tag+' : нет строки «Идея»');
};

for(let k=0;k<${N};k++){
  /* задачи серий: 7 сюжетных серий (gens у 1–2 и sgens у 3–7) и отдельная тема неравенств */
  BLOCKS.forEach((b,bi)=>{
    const gl=b.sgens||b.gens;
    gl.forEach((g,gi)=>{
      try{ const q=g(); checkQ('BLOCKS['+bi+'].gens['+gi+']',q); checkMeta('BLOCKS['+bi+'].gens['+gi+']',q); }
      catch(e){ push('BLOCKS['+bi+'].gens['+gi+'] : исключение '+e.message); }
    });
  });
  BASE_GENS.forEach((g,i)=>{
    try{ const q=g(); checkQ('BASE_GENS['+i+']',q); checkMeta('BASE_GENS['+i+']',q); }
    catch(e){ push('BASE_GENS['+i+'] : исключение '+e.message); }
  });
  /* практика №1–5 */
  PRAC_GENS.forEach((g,gi)=>{
    try{
      const r=g();
      r.qs.forEach((q,qi)=>{ checkQ('практика '+r.title+' №'+(qi+1),q); checkMeta('практика '+r.title+' №'+(qi+1),q); });
    }catch(e){ push('PRAC_GENS['+gi+'] : исключение '+e.message); }
  });
  /* геометрия, графики, часть 2 */
  [genG15,genG16,genG17,genG18,genG19].forEach((g,i)=>{
    try{ const q=g(); checkQ('геометрия '+(15+i),q); checkMeta('геометрия '+(15+i),q); }catch(e){ push('геометрия '+(15+i)+' : '+e.message); }
  });
  try{ genGr5().forEach((q,i)=>{ checkQ('графики '+i,q); checkMeta('графики '+i,q); }); }catch(e){ push('графики : '+e.message); }
  /* часть 2: у доказательства (№24) ответа нет по замыслу, у остальных есть */
  try{
    genP2().forEach(q=>{
      textCheck('часть 2 №'+q.no,String(q.q)+' '+String(q.why||''));
      if(q.hasA){ checkQ('часть 2 №'+q.no,q); } else if(q.a!==undefined){ push('часть 2 №'+q.no+' : у задания без ответа появился a'); }
      checkMeta('часть 2 №'+q.no,q);
      if(!q.crit||!q.crit.length) push('часть 2 №'+q.no+' : нет критериев оценивания');
    });
  }catch(e){ push('часть 2 : '+e.message); }
  /* задания диагностики */
  try{ makeDiag().forEach(q=>{ checkQ('диагностика №'+q.code,q); }); }catch(e){ push('диагностика : '+e.message); }
}

/* ---------- проход по экранам ---------- */
const run=(tag,fn)=>{ try{ fn(); }catch(e){ push('экран '+tag+' : '+e.message); } };
run('главная',()=>render());
run('отчёт',()=>buildReport());
SERIES.forEach((s,si)=>{
  run('интро серии '+(si+1),()=>{ S={screen:'intro',si}; render(); });
  run('серия '+(si+1),()=>{
    startPrac(si);
    for(let k=0;k<S.qs.length;k++){
      act('hint'); act('hint');
      S.ans=String(S.qs[S.i].a).replace('.',','); S.fb=null; check(); render();
      S.ans='0'; S.tries=1; check(); render();          // неверный ответ: вторая попытка и разбор
      S.fb='show'; render();
      next(); if(S.screen==='res') break;
    }
    render();
  });
});
['base','prac','geo','gr','ineq'].forEach(si=>{
  run('тема '+si,()=>{
    S={screen:'intro',si}; render();
    startPrac(si);
    for(let k=0;k<S.qs.length;k++){
      act('hint'); act('hint');
      S.ans=String(S.qs[S.i].a).replace('.',','); S.fb=null; check(); render();
      S.fb='show'; render();
      next(); if(S.screen==='res') break;
    }
    render();
  });
});
run('часть 2',()=>{
  startP2();
  for(let k=0;k<S.qs.length;k++){
    const q=S.qs[S.i];
    act('hint'); act('hint'); render();
    if(q.hasA){ S.ans=String(q.a).replace('.',','); check(); }
    else act('p2show');
    render();
    q.crit.forEach((c,i)=>act('tick',{i:String(i)}));
    render();
    p2next(); if(S.screen==='p2res') break;
  }
  render();
});
run('диагностика',()=>{
  startDiag();
  while(S.screen==='diag'){
    if(S.interlude){ act('goon'); continue; }
    if(S.i%4===0){ act('dk'); continue; }
    S.ans=String(S.qs[S.i].a).replace('.',','); check(); render();
  }
  render();
});
run('сброс',()=>{ act('reset'); act('reset'); render(); });

const uniq=[...new Set(problems)];
if(uniq.length){
  console.log('Найдено проблем: '+problems.length+' (разных: '+uniq.length+')');
  uniq.slice(0,40).forEach(p=>console.log(' - '+p));
  process.exit(1);
}
console.log('OK: '+${N}+' повторов, все генераторы и экраны без ошибок');
`;

eval(code + '\n' + test);
