// ===== ナッシー号 乗り継ぎナビ ロジック =====

const ROUTE_ORDER = ["北ルート","西ルート","東ルート","南ルート"];
const DIR_LABEL = {outbound:"往路（市役所発）", inbound:"復路（市役所行）"};

// ---------- ユーティリティ ----------
function parseTimeToMin(str){
  if(!str) return null;
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  return parseInt(m[1],10)*60 + parseInt(m[2],10);
}
function minToStr(min){
  if(min==null) return "";
  let h = Math.floor(min/60), m = min%60;
  return `${h}:${String(m).padStart(2,"0")}`;
}
function nowMin(){
  const d = new Date();
  return d.getHours()*60 + d.getMinutes();
}
function normName(s){
  return (s||"").toLowerCase()
    .replace(/[ぁ-ん]/g, c=>String.fromCharCode(c.charCodeAt(0)+0x60)) // ひら→カナ簡易
    .replace(/[０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0))
    .replace(/\s/g,"");
}

// ---------- 停留所インデックス ----------
const STOP_LIST = Object.keys(BUS_DATA.stopNames)
  .map(no=>({no, name: BUS_DATA.stopNames[no]}))
  .sort((a,b)=>parseInt(a.no)-parseInt(b.no));

function findStopMatches(query){
  const q = normName(query);
  if(!q) return [];
  return STOP_LIST.filter(s=>{
    return normName(s.name).includes(q) || s.no===query;
  }).slice(0,12);
}

// どの route/direction がこの停留所番号を通るか（配列 index 付き）
function routesServingStop(no){
  const out = [];
  for(const rname of ROUTE_ORDER){
    for(const dname of ["outbound","inbound"]){
      const block = BUS_DATA.routes[rname][dname];
      const idx = block.stops.findIndex(s=>s.no===no);
      if(idx>=0) out.push({route:rname, dir:dname, idx, block});
    }
  }
  return out;
}

// ---------- サジェスト UI ----------
function wireSuggest(inputEl, dropEl, onPick){
  let selectedNo = null;
  inputEl._getSelectedNo = ()=>selectedNo;
  inputEl.addEventListener("input", ()=>{
    selectedNo = null;
    const matches = findStopMatches(inputEl.value);
    if(matches.length===0){ dropEl.classList.remove("show"); dropEl.innerHTML=""; return; }
    dropEl.innerHTML = matches.map(m=>`<div class="sug-item" data-no="${m.no}"><span class="no">#${m.no}</span>${m.name}</div>`).join("");
    dropEl.classList.add("show");
  });
  dropEl.addEventListener("click", (e)=>{
    const item = e.target.closest(".sug-item");
    if(!item) return;
    selectedNo = item.dataset.no;
    inputEl.value = BUS_DATA.stopNames[selectedNo];
    dropEl.classList.remove("show");
    if(onPick) onPick(selectedNo);
  });
  document.addEventListener("click",(e)=>{
    if(!inputEl.contains(e.target) && !dropEl.contains(e.target)) dropEl.classList.remove("show");
  });
  return {
    resolve(){
      if(selectedNo) return selectedNo;
      const matches = findStopMatches(inputEl.value);
      if(matches.length>0){ selectedNo = matches[0].no; return selectedNo; }
      return null;
    }
  };
}

// ---------- タブ切り替え ----------
const tabBtnSearch = document.getElementById("tabBtnSearch");
const tabBtnTimetable = document.getElementById("tabBtnTimetable");
const tabSearch = document.getElementById("tabSearch");
const tabTimetable = document.getElementById("tabTimetable");
tabBtnSearch.addEventListener("click", ()=>{
  tabBtnSearch.classList.add("active"); tabBtnTimetable.classList.remove("active");
  tabSearch.style.display=""; tabTimetable.style.display="none";
});
tabBtnTimetable.addEventListener("click", ()=>{
  tabBtnTimetable.classList.add("active"); tabBtnSearch.classList.remove("active");
  tabTimetable.style.display=""; tabSearch.style.display="none";
});

// ---------- 乗り継ぎ検索フォーム ----------
const fromInput = document.getElementById("fromInput");
const toInput = document.getElementById("toInput");
const fromSug = document.getElementById("fromSug");
const toSug = document.getElementById("toSug");
const fromCtl = wireSuggest(fromInput, fromSug);
const toCtl = wireSuggest(toInput, toSug);

document.getElementById("swapBtn").addEventListener("click", ()=>{
  const tmp = fromInput.value; fromInput.value = toInput.value; toInput.value = tmp;
});

const timeInput = document.getElementById("timeInput");
function setTimeToNowPlus(min){
  const d = new Date(Date.now()+min*60000);
  timeInput.value = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
setTimeToNowPlus(0);
document.querySelectorAll(".chip[data-q]").forEach(chip=>{
  chip.addEventListener("click", ()=>{
    document.querySelectorAll(".chip[data-q]").forEach(c=>c.classList.remove("active"));
    chip.classList.add("active");
    const q = chip.dataset.q;
    if(q==="now") setTimeToNowPlus(0);
    else setTimeToNowPlus(parseInt(q.replace("+",""),10));
  });
});
timeInput.addEventListener("input", ()=>{
  document.querySelectorAll(".chip[data-q]").forEach(c=>c.classList.remove("active"));
});

// localStorage: 徒歩時間を記憶
const walkFrom = document.getElementById("walkFrom");
const walkTo = document.getElementById("walkTo");
try{
  const saved = JSON.parse(localStorage.getItem("nasshii_walk")||"{}");
  if(saved.from!=null) walkFrom.value = saved.from;
  if(saved.to!=null) walkTo.value = saved.to;
}catch(e){}
function saveWalk(){
  try{ localStorage.setItem("nasshii_walk", JSON.stringify({from:walkFrom.value, to:walkTo.value})); }catch(e){}
}
walkFrom.addEventListener("change", saveWalk);
walkTo.addEventListener("change", saveWalk);

// ---------- 検索ロジック ----------
function tripTimeAt(block, idx, label){
  if(idx<0) return null;
  return parseTimeToMin(block.stops[idx].times[label]);
}

function searchDirect(fromNo, toNo, afterMin){
  const results = [];
  for(const rname of ROUTE_ORDER){
    for(const dname of ["outbound","inbound"]){
      const block = BUS_DATA.routes[rname][dname];
      const fi = block.stops.findIndex(s=>s.no===fromNo);
      const ti = block.stops.findIndex(s=>s.no===toNo);
      if(fi<0 || ti<0 || ti<=fi) continue;
      for(const label of block.labels){
        const board = tripTimeAt(block, fi, label);
        if(board==null || board<afterMin) continue;
        const alight = tripTimeAt(block, ti, label);
        if(alight==null) continue;
        results.push({
          type:"direct",
          totalArrive: alight,
          legs:[{route:rname, dir:dname, label, board, alight, fromName:block.stops[fi].name, toName:block.stops[ti].name}]
        });
      }
    }
  }
  return results;
}

function searchTransfer(fromNo, toNo, afterMin){
  const results = [];
  const hubs = BUS_DATA.transferHubs;
  for(const rname1 of ROUTE_ORDER){
    for(const dname1 of ["outbound","inbound"]){
      const block1 = BUS_DATA.routes[rname1][dname1];
      const fi = block1.stops.findIndex(s=>s.no===fromNo);
      if(fi<0) continue;
      for(const hub of hubs){
        const hi1 = block1.stops.findIndex(s=>s.no===hub);
        if(hi1<0 || hi1<=fi) continue; // hub must come after boarding stop
        for(const label1 of block1.labels){
          const board = tripTimeAt(block1, fi, label1);
          if(board==null || board<afterMin) continue;
          const hubArrive = tripTimeAt(block1, hi1, label1);
          if(hubArrive==null) continue;

          // 2本目: hub -> toNo
          for(const rname2 of ROUTE_ORDER){
            for(const dname2 of ["outbound","inbound"]){
              if(rname1===rname2 && dname1===dname2) continue; // 同じ運行は乗り継ぎにならない(直行で拾われる)
              const block2 = BUS_DATA.routes[rname2][dname2];
              const hi2 = block2.stops.findIndex(s=>s.no===hub);
              const ti2 = block2.stops.findIndex(s=>s.no===toNo);
              if(hi2<0 || ti2<0 || ti2<=hi2) continue;
              for(const label2 of block2.labels){
                const depart2 = tripTimeAt(block2, hi2, label2);
                if(depart2==null || depart2<hubArrive) continue;
                const alight2 = tripTimeAt(block2, ti2, label2);
                if(alight2==null) continue;
                results.push({
                  type:"transfer",
                  totalArrive: alight2,
                  waitMin: depart2 - hubArrive,
                  legs:[
                    {route:rname1, dir:dname1, label:label1, board, alight:hubArrive, fromName:block1.stops[fi].name, toName:BUS_DATA.stopNames[hub]},
                    {route:rname2, dir:dname2, label:label2, board:depart2, alight:alight2, fromName:BUS_DATA.stopNames[hub], toName:block2.stops[ti2].name}
                  ]
                });
              }
            }
          }
        }
      }
    }
  }
  return results;
}

function routeColorVar(rname){
  return {"北ルート":"var(--kita)","西ルート":"var(--nishi)","東ルート":"var(--higashi)","南ルート":"var(--minami)"}[rname]||"var(--accent)";
}

function renderResults(fromNo, toNo, afterMin, walkFromMin, walkToMin){
  const box = document.getElementById("resultsBox");
  let all = [...searchDirect(fromNo, toNo, afterMin), ...searchTransfer(fromNo, toNo, afterMin)];

  if(all.length===0){
    box.innerHTML = `<div class="panel"><div class="empty"><span class="em">🚌</span>この時間以降、条件に合う便が見つかりませんでした。<br>時刻や停留所を変えてお試しください。</div></div>`;
    return;
  }

  // 重複除去（同じ到着時刻・同じ経路構成）＆ 到着時刻でソート
  const seen = new Set();
  all = all.filter(r=>{
    const key = r.type+"_"+r.legs.map(l=>l.route+l.dir+l.label).join("_");
    if(seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b)=>a.totalArrive-b.totalArrive).slice(0,6);

  const homeLabel = walkFromMin>0 ? `自宅発 <b style="color:var(--text)">${minToStr(all[0].legs[0].board - walkFromMin)}</b> 目安 → ` : "";

  box.innerHTML = all.map((r,i)=>{
    const firstBoard = r.legs[0].board;
    const finalArrive = r.totalArrive;
    const totalMin = (finalArrive + walkToMin) - (firstBoard - walkFromMin);
    const legsHtml = r.legs.map(l=>`
      <div class="leg">
        <span class="tag" style="background:${routeColorVar(l.route)}">${l.route.replace('ルート','')}</span>
        <div class="leg-body">
          <div class="t">${minToStr(l.board)} ${l.fromName} 発 → ${minToStr(l.alight)} ${l.toName} 着</div>
          <div class="s">${DIR_LABEL[l.dir]} ・ ${l.label}</div>
        </div>
      </div>`).join("");
    const walkPre = walkFromMin>0 ? `<div class="leg"><span class="tag walk">徒歩</span><div class="leg-body"><div class="t">自宅 〜 ${r.legs[0].fromName}（約${walkFromMin}分）</div></div></div>` : "";
    const walkPost = walkToMin>0 ? `<div class="leg"><span class="tag walk">徒歩</span><div class="leg-body"><div class="t">${r.legs[r.legs.length-1].toName} 〜 目的地（約${walkToMin}分）</div></div></div>` : "";
    const waitNote = r.type==="transfer" ? `<div class="wait-note">乗り継ぎ待ち ${r.waitMin}分（${r.legs[0].toName}）※乗り継ぎ券が必要です</div>` : "";
    return `
      <div class="result-card ${i===0?'best':''}">
        <div class="result-top">
          <div class="result-total">${minToStr(finalArrive)}<small> 着 ／ 所要 約${totalMin}分</small></div>
        </div>
        ${walkPre}${legsHtml}${walkPost}
        ${waitNote}
      </div>`;
  }).join("");
}

document.getElementById("searchBtn").addEventListener("click", ()=>{
  const fromNo = fromCtl.resolve();
  const toNo = toCtl.resolve();
  const box = document.getElementById("resultsBox");
  if(!fromNo || !toNo){
    box.innerHTML = `<div class="panel"><div class="empty"><span class="em">📍</span>出発と到着の停留所を入力してください。</div></div>`;
    return;
  }
  if(fromNo===toNo){
    box.innerHTML = `<div class="panel"><div class="empty"><span class="em">🤔</span>出発と到着が同じ停留所です。</div></div>`;
    return;
  }
  const [h,m] = (timeInput.value||"00:00").split(":").map(Number);
  const afterMin = h*60+m;
  const wf = parseInt(walkFrom.value,10)||0;
  const wt = parseInt(walkTo.value,10)||0;
  renderResults(fromNo, toNo, afterMin, wf, wt);
});

// ---------- 時刻表タブ ----------
const ttStopInput = document.getElementById("ttStopInput");
const ttSug = document.getElementById("ttSug");
const ttRouteDirPanel = document.getElementById("ttRouteDirPanel");
const ttRouteChips = document.getElementById("ttRouteChips");
const ttTablePanel = document.getElementById("ttTablePanel");
const ttTable = document.getElementById("ttTable");
const ttTitle = document.getElementById("ttTitle");

let ttCurrentNo = null;
let ttCurrentChoice = null;

const ttCtl = wireSuggest(ttStopInput, ttSug, (no)=>{
  ttCurrentNo = no;
  showTtRouteChips(no);
});

function showTtRouteChips(no){
  const opts = routesServingStop(no);
  if(opts.length===0){
    ttRouteDirPanel.style.display="none";
    ttTablePanel.style.display="none";
    return;
  }
  ttRouteDirPanel.style.display="";
  ttRouteChips.innerHTML = opts.map((o,i)=>
    `<span class="chip ${i===0?'active':''}" data-i="${i}" style="border-color:${routeColorVar(o.route)}">${o.route} ${DIR_LABEL[o.dir].split('（')[0]}</span>`
  ).join("");
  [...ttRouteChips.children].forEach((chip,i)=>{
    chip.addEventListener("click", ()=>{
      [...ttRouteChips.children].forEach(c=>c.classList.remove("active"));
      chip.classList.add("active");
      renderTimetable(no, opts[i]);
    });
  });
  renderTimetable(no, opts[0]);
}

function renderTimetable(no, choice){
  ttTablePanel.style.display="";
  const {route, dir, block} = choice;
  ttTitle.textContent = `${route}（${DIR_LABEL[dir]}）`;
  const nowM = nowMin();

  // 各trip labelについて「現在時刻以降で最初の出発」を求め、ハイライト対象を決める
  const upcoming = {};
  for(const label of block.labels){
    for(const s of block.stops){
      const t = parseTimeToMin(s.times[label]);
      if(t!=null && t>=nowM){ upcoming[label]=true; break; }
    }
  }

  let html = "<thead><tr><th>停</th><th class='stopname'>停留所</th>";
  html += block.labels.map(l=>`<th>${l}</th>`).join("");
  html += "</tr></thead><tbody>";
  const hubs = new Set(BUS_DATA.transferHubs);
  for(const s of block.stops){
    const isHub = hubs.has(s.no);
    html += `<tr class="${isHub?'hub':''}"><td>${s.no}${isHub?' 🔁':''}</td><td class="stopname">${s.name}${s.no===no?' ★':''}</td>`;
    for(const label of block.labels){
      const raw = s.times[label] || "";
      const t = parseTimeToMin(raw);
      let isNext = false;
      if(s.no===no && t!=null && t>=nowM){
        // このstopで最初に来る未来の便かどうかは後段でまとめてマーク
      }
      html += `<td>${raw||"-"}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  ttTable.innerHTML = html;

  // 選択停留所の行で、現在時刻以降最初の便セルをハイライト
  const rowIdx = block.stops.findIndex(s=>s.no===no);
  if(rowIdx>=0){
    const tr = ttTable.querySelectorAll("tbody tr")[rowIdx];
    const tds = tr.querySelectorAll("td");
    let marked = false;
    block.labels.forEach((label,i)=>{
      if(marked) return;
      const t = parseTimeToMin(block.stops[rowIdx].times[label]);
      if(t!=null && t>=nowM){
        tds[i+2].classList.add("next");
        marked = true;
      }
    });
  }
}
