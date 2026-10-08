/** Single-page mock console (no build step, no external assets). */
export function consoleHtml(): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Copal Console (mock)</title>
<style>
:root{--bg:#f7f5f0;--panel:#fff;--ink:#1d1b16;--muted:#6f6a5e;--line:#e6e1d6;--amber:#b86e00;--amber-soft:#fdf1dc;--red:#c0362c;--red-soft:#fbe7e5;--green:#2e7d4f;--green-soft:#e4f3ea;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#14130f;--panel:#1d1c17;--ink:#ece8de;--muted:#a19b8c;--line:#2f2d26;--amber:#f0a83a;--amber-soft:#3a2b12;--red:#ff7a6e;--red-soft:#3a1d1a;--green:#6ccf93;--green-soft:#183324}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;align-items:center;gap:12px;padding:14px 24px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:2}
.logo{width:26px;height:26px;border-radius:7px;background:radial-gradient(circle at 30% 30%,#ffd27a,var(--amber));display:grid;place-items:center;color:#2a1a00;font-weight:700}
header h1{font-size:15px;margin:0}header .tag{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:2px 8px}
header .sp{flex:1}button{font:inherit;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:6px 10px;cursor:pointer}button:hover{border-color:var(--amber)}
main{max-width:1180px;margin:0 auto;padding:20px 16px 60px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}.kpi b{display:block;font-size:24px;font-variant-numeric:tabular-nums}.kpi b.sm{font-size:13px;font-weight:600;line-height:1.5;padding:6px 0 4px}.kpi span{color:var(--muted);font-size:12px}
nav{display:flex;gap:4px;margin-bottom:14px;flex-wrap:wrap}nav button{border-radius:99px}nav button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.grid{display:grid;grid-template-columns:minmax(0,380px) minmax(0,1fr);gap:14px}@media (max-width:820px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}.card h2{font-size:13px;margin:0;padding:12px 14px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.row{padding:10px 14px;border-bottom:1px solid var(--line);cursor:pointer;display:flex;gap:10px;align-items:flex-start}.row:last-child{border-bottom:0}.row:hover,.row.sel{background:var(--amber-soft)}
.row .t{flex:1;min-width:0}.row .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row small{color:var(--muted)}
.pill{font-size:11px;border-radius:99px;padding:2px 8px;white-space:nowrap;font-weight:600}.bad{background:var(--red-soft);color:var(--red)}.ok{background:var(--green-soft);color:var(--green)}.warn{background:var(--amber-soft);color:var(--amber)}
.src{font-family:var(--mono);font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.finding{padding:12px 14px;border-bottom:1px solid var(--line)}.finding:last-child{border-bottom:0}.finding .loc{font-family:var(--mono);font-size:12px}.finding .why{color:var(--muted);margin-top:4px}
pre{font-family:var(--mono);font-size:12px;margin:8px 0 0;padding:8px 10px;border-radius:8px;background:var(--bg);overflow:auto}.del{color:var(--red)}.add{color:var(--green)}
.empty{padding:28px 14px;color:var(--muted);text-align:center}
.bar{display:flex;align-items:center;gap:10px;padding:8px 14px}.bar .n{width:190px;flex:none;font-family:var(--mono);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bar small{white-space:nowrap}.bar .b{height:10px;background:var(--amber);border-radius:4px}.bar small{color:var(--muted)}
.tl{padding:6px 14px 12px}.ev{border-left:2px solid var(--line);padding:6px 0 6px 14px;position:relative}.ev:before{content:"";position:absolute;left:-6px;top:11px;width:10px;height:10px;border-radius:50%;background:var(--line)}.ev.e-bad:before{background:var(--red)}.ev.e-ok:before{background:var(--green)}
.md table{border-collapse:collapse;margin:6px 0;font-size:12px}.md td,.md th{border:1px solid var(--line);padding:3px 6px;text-align:left}.md blockquote{margin:4px 0;padding-left:10px;border-left:3px solid var(--line);color:var(--muted)}.md code{font-family:var(--mono);font-size:12px;background:var(--bg);padding:0 4px;border-radius:4px}.md h3{font-size:14px;margin:4px 0}.md p{margin:4px 0}
.md{font-size:13px}@media (max-width:600px){#upd,header .tag{display:none}header{padding:12px 16px}}
</style>
</head>
<body>
<header><div class="logo">c</div><h1>Copal Console</h1><span class="tag">mock backend</span><span class="sp"></span><small id="upd" style="color:var(--muted)"></small><button id="reset">Réinitialiser</button></header>
<main>
  <div class="kpis" id="kpis"></div>
  <nav id="tabs"></nav>
  <div id="view"></div>
</main>
<script>
const $=s=>document.querySelector(s);const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let S=null,tab="analyses",sel=null;
function inl(t){return esc(t).replace(/\\x60([^\\x60]+)\\x60/g,"<code>$1</code>").replace(/\\*\\*([^*]+)\\*\\*/g,"<b>$1</b>").replace(/&lt;sub&gt;(.*?)&lt;\\/sub&gt;/g,"<small style='color:var(--muted)'>$1</small>")}
const BT3="\\x60\\x60\\x60";
function md(src){const L=src.split("\\n"),o=[];for(let i=0;i<L.length;i++){const l=L[i];
 if(l.startsWith(BT3)){const b=[];while(++i<L.length&&!L[i].startsWith(BT3))b.push(L[i]);o.push('<pre><span class="add">'+esc(b.join("\\n"))+'</span></pre>');continue}
 if(l.startsWith("|")){const rows=[];while(i<L.length&&L[i].startsWith("|")){if(!/^\\|[-| ]+\\|$/.test(L[i]))rows.push(L[i].slice(1,-1).split(/(?<!\\\\)\\|/));i++}i--;o.push("<table>"+rows.map((r,j)=>"<tr>"+r.map(c=>(j?"<td>":"<th>")+inl(c.trim().replace(/\\\\\\|/g,"|"))+(j?"</td>":"</th>")).join("")+"</tr>").join("")+"</table>");continue}
 if(l.startsWith("### "))o.push("<h3>"+inl(l.slice(4))+"</h3>");else if(l.startsWith("> "))o.push("<blockquote>"+inl(l.slice(2))+"</blockquote>");else if(l.trim())o.push("<p>"+inl(l)+"</p>")}return o.join("")}
const TABS=[["analyses","Analyses"],["pulls","Pull requests"],["drift","Drift & evidence"],["policy","Policy"]];
function key(){try{return localStorage.getItem("copalKey")||""}catch(e){return ""}}
async function api(p,o={}){const r=await fetch(p,{...o,headers:{"x-api-key":key()}});if(r.status===401){const k=prompt("Copal API key for this console:");if(k){try{localStorage.setItem("copalKey",k)}catch(e){}return api(p,o)}throw new Error("unauthorized")}return r}
async function load(){try{S=await (await api("/console/api/state")).json();$("#upd").textContent="maj "+new Date().toLocaleTimeString();render()}catch(e){$("#upd").textContent="hors ligne"}}
function kpis(){const m=S.metrics,blocking=S.analyses.reduce((n,a)=>n+a.summary.blocking,0);
 const k=[[m.analyses,"analyses"],[m.governedChanges,"governed changes (PR)"],[m.gates.passed+" / "+(m.gates.passed+m.gates.failed),"PR gates passés"],[blocking,"findings bloquants"],[Object.entries(m.bySource).map(([s,n])=>s+" "+n).join(" · ")||"—","par point d'application"]];
 $("#kpis").innerHTML=k.map(([v,l],i)=>'<div class="kpi"><b'+(i===4?' class="sm"':'')+'>'+esc(v)+'</b><span>'+esc(l)+'</span></div>').join("")}
function tabs(){$("#tabs").innerHTML=TABS.map(([k,l])=>'<button data-t="'+k+'" class="'+(k===tab?"on":"")+'">'+l+'</button>').join("");document.querySelectorAll("#tabs button").forEach(b=>b.onclick=()=>{tab=b.dataset.t;sel=null;render()})}
function status(a){return a.blocking?'<span class="pill bad">bloquant</span>':a.findings.length?'<span class="pill warn">audit</span>':'<span class="pill ok">ok</span>'}
function findingHtml(f){return '<div class="finding"><div><span class="pill '+(f.blocking?"bad":"warn")+'">'+(f.blocking?"enforce":"audit")+'</span> <b>'+esc(f.message)+'</b> <span class="src">'+esc(f.ruleId)+'</span></div><div class="loc">'+esc(f.file)+':'+f.line+'</div>'+(f.why?'<div class="why">'+esc(f.why)+'</div>':'')+(f.suggestion?'<pre><span class="del">- '+esc(f.suggestion.original.trim())+'</span>\\n<span class="add">+ '+esc(f.suggestion.replacement.trim())+'</span></pre>':'')+(f.sources?'<div class="why">Sources : '+esc(f.sources.join(" · "))+'</div>':'')+'</div>'}
function analyses(){const L=S.analyses;if(!L.length)return '<div class="card"><div class="empty">Aucune analyse. Lancez <code>npm run e2e</code> ou un <code>copal check</code>.</div></div>';
 const cur=L.find(a=>a.id===sel)||L[0];sel=cur.id;
 return '<div class="grid"><div class="card"><h2>Analyses récentes</h2>'+L.map(a=>'<div class="row'+(a.id===sel?" sel":"")+'" data-id="'+a.id+'"><div class="t"><div><b>'+esc(a.title||a.ref||a.project)+'</b></div><small><span class="src">'+a.source+'</span> '+esc(a.project)+' · '+esc(a.environment)+(a.agent?' · '+esc(a.agent):'')+' · '+new Date(a.createdAt).toLocaleTimeString()+'</small></div>'+status(a)+'</div>').join("")+'</div>'
 +'<div class="card"><h2>'+esc(cur.title||cur.ref||cur.id)+' — '+cur.summary.blocking+' bloquant(s), '+cur.summary.audit+' audit</h2>'+(cur.findings.length?cur.findings.map(findingHtml).join(""):'<div class="empty">Aucun finding ✔</div>')+(cur.feedback.length?'<div class="finding"><b>Feedback</b>'+cur.feedback.map(x=>'<div class="why">'+esc(x.verdict)+' · '+esc(x.ruleId)+(x.note?' — '+esc(x.note):'')+'</div>').join("")+'</div>':'')+'</div></div>'}
function pulls(){const L=S.pulls;if(!L.length)return '<div class="card"><div class="empty">Aucune PR simulée. Lancez <code>copal-git-app simulate</code>.</div></div>';
 const cur=L.find(p=>p.provider+p.repo+p.number===sel)||L[0];sel=cur.provider+cur.repo+cur.number;
 const last=cur.statuses[cur.statuses.length-1];
 const ev=[...cur.statuses.map(s=>({at:s.at,cls:s.state==="success"?"e-ok":s.state==="pending"||s.state==="running"?"":"e-bad",html:'<b>status '+esc(s.context)+'</b> → '+esc(s.state)+' <small>'+esc(s.description||"")+' · '+s.sha.slice(0,7)+'</small>'})),
  ...cur.reviews.map(r=>({at:r.at,cls:r.event==="REQUEST_CHANGES"?"e-bad":"",html:'<b>review '+esc(r.event||"")+'</b> · '+r.comments.length+' commentaire(s) inline'+(r.body?'<div class="md">'+md(r.body)+'</div>':'')+r.comments.map(c=>'<div class="md" style="border:1px solid var(--line);border-radius:8px;padding:6px 10px;margin-top:6px"><span class="src">'+esc(c.path)+':'+c.line+'</span>'+md(c.body)+'</div>').join("")})),
  ...cur.comments.map(c=>({at:c.at,cls:"",html:'<b>commentaire</b><div class="md">'+md(c.body)+'</div>'}))].sort((a,b)=>a.at<b.at?-1:1);
 return '<div class="grid"><div class="card"><h2>Pull / merge requests</h2>'+L.map(p=>{const s=p.statuses[p.statuses.length-1];return '<div class="row'+(p.provider+p.repo+p.number===sel?" sel":"")+'" data-id="'+esc(p.provider+p.repo+p.number)+'"><div class="t"><div><b>#'+p.number+' '+esc(p.title)+'</b></div><small><span class="src">'+p.provider+'</span> '+esc(p.repo)+' · '+esc(p.author)+'</small></div>'+(s?'<span class="pill '+(s.state==="success"?"ok":"bad")+'">'+esc(s.state)+'</span>':'')+'</div>'}).join("")+'</div>'
 +'<div class="card"><h2>#'+cur.number+' '+esc(cur.title)+(last?' — check '+esc(last.state):'')+'</h2><div class="tl">'+ev.map(e=>'<div class="ev '+e.cls+'"><small style="color:var(--muted)">'+new Date(e.at).toLocaleTimeString()+'</small><br>'+e.html+'</div>').join("")+'</div></div></div>'}
function drift(){const d=S.metrics.drift;const max=Math.max(1,...d.map(x=>x.count));
 return '<div class="grid"><div class="card"><h2>Violations récurrentes (drift)</h2>'+(d.length?d.map(x=>'<div class="bar"><div class="n" title="'+esc(x.ruleId)+'">'+esc(x.ruleId)+'</div><div class="b" style="width:'+Math.round(220*x.count/max)+'px"></div><small>'+x.count+(x.falsePositives?' · '+x.falsePositives+' FP':'')+'</small></div>').join(""):'<div class="empty">—</div>')+'</div>'
 +'<div class="card"><h2>Sessions agents</h2>'+(S.sessions.length?S.sessions.slice().reverse().map(s=>'<div class="row"><div class="t"><div><b>'+esc(s.agent)+'</b> '+esc(s.project||"")+'</div><small>'+new Date(s.at).toLocaleTimeString()+(s.tokens?' · '+s.tokens+' tokens':'')+(s.findings!=null?' · '+s.findings+' finding(s)':'')+'</small></div></div>').join(""):'<div class="empty">Aucune session MCP enregistrée.</div>')+'</div></div>'}
function policy(){return S.projects.map(p=>'<div class="card" style="margin-bottom:14px"><h2>'+esc(p.name)+' · v'+p.version+' · '+p.rules.length+' règles effectives</h2>'+p.rules.map(r=>'<div class="finding"><span class="pill '+(r.mode==="enforce"?"bad":"warn")+'">'+esc(r.mode||"audit")+'</span> <b>'+esc(r.id)+'</b> <span class="src">'+esc(r.category||"")+'</span><div class="why">'+esc(r.why||r.message||r.deny||"")+'</div></div>').join("")+'<pre style="margin:0;border-radius:0">'+esc(p.yaml)+'</pre></div>').join("")||'<div class="card"><div class="empty">Aucun projet.</div></div>'}
function render(){if(!S)return;kpis();tabs();$("#view").innerHTML=({analyses,pulls,drift,policy})[tab]();document.querySelectorAll(".row[data-id]").forEach(r=>r.onclick=()=>{sel=r.dataset.id;render()})}
$("#reset").onclick=async()=>{if(confirm("Effacer analyses, PR et sessions ?")){await api("/console/api/reset",{method:"POST"});sel=null;load()}};
load();setInterval(load,3000);
</script>
</body>
</html>`;
}
