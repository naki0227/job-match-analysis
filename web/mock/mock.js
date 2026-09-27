(()=>{"use strict";
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const root=document.documentElement, body=document.body, mode=body.dataset.mode||"release";
const toast=$("#toast");let toastTimer;
function notify(msg){if(!toast)return;clearTimeout(toastTimer);toast.textContent=msg;toast.classList.add("show");toastTimer=setTimeout(()=>toast.classList.remove("show"),1700)}
const screens=$$(".screen"), userNav=$$(".nav [data-screen]"), enterpriseNav=$$(".enterprise-nav [data-enterprise]");
let enterpriseMode=false;
function go(name){
  if(enterpriseMode){enterpriseMode=false;body.classList.remove("enterprise-mode");const b=$("#mode-switch");if(b){b.classList.remove("on");b.textContent="企業デモ"}const so=$("#scout-open");if(so)so.hidden=false;const av=$(".avatar");if(av)av.hidden=false}
  screens.forEach(s=>s.classList.toggle("active",s.id==="screen-"+name));
  userNav.forEach(b=>b.classList.toggle("active",b.dataset.screen===name));
  enterpriseNav.forEach(b=>b.classList.remove("active"));
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="insights")renderRadar(currentCohort);
  if(name==="candidate-preview")renderCandidateProjection()
}
function goEnterprise(name){
  screens.forEach(s=>s.classList.toggle("active",s.id==="screen-"+name));
  userNav.forEach(b=>b.classList.remove("active"));
  enterpriseNav.forEach(b=>b.classList.toggle("active",b.dataset.enterprise===name));
  window.scrollTo({top:0,behavior:"smooth"})
}
$$("[data-screen]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.screen)));
$$("[data-enterprise]").forEach(b=>b.addEventListener("click",()=>goEnterprise(b.dataset.enterprise)));
const homeBrand=$("#home-brand");if(homeBrand)homeBrand.addEventListener("click",()=>enterpriseMode?goEnterprise("enterprise-home"):go("home"));

/* first run */
const gates=["#gate-auth","#gate-legal","#gate-role"].map(s=>$(s)).filter(Boolean);
function gateOnly(target){gates.forEach(g=>g.classList.toggle("active",g===target))}
const google=$("#mock-google-login");if(google)google.addEventListener("click",()=>gateOnly($("#gate-legal")));
const skip=$("#skip-onboarding");if(skip)skip.addEventListener("click",()=>{gates.forEach(g=>g.classList.remove("active"));notify("デモモード")});
const terms=$("#terms-check"), privacy=$("#privacy-check"), legalNext=$("#legal-next");
function checkLegal(){if(legalNext)legalNext.disabled=!(terms?.checked&&privacy?.checked)}
terms?.addEventListener("change",checkLegal);privacy?.addEventListener("change",checkLegal);legalNext?.addEventListener("click",()=>gateOnly($("#gate-role")));
$("#role-options")?.addEventListener("click",e=>{const b=e.target.closest(".role-tag");if(b)b.classList.toggle("active")});
$("#role-next")?.addEventListener("click",()=>{gates.forEach(g=>g.classList.remove("active"));go("assessment")});

/* career profile */
const questions=[
["どの程度、在宅で働きたいですか？","原則出社","フルリモート"],
["仕事の進め方をどの程度自分で決めたいですか？","手順が明確","自分で決めたい"],
["日々の仕事をどの程度チームで進めたいですか？","個人中心","チーム中心"],
["成長ではどちらを重視しますか？","専門性を深める","新しい領域に挑む"],
["仕事の変化はどのくらい欲しいですか？","予測可能","変化が速い"],
["働く時間をどの程度調整したいですか？","固定時間","広く調整"],
["役割の幅はどのくらい欲しいですか？","特定領域","幅広い領域"],
["顧客とどの程度直接関わりたいですか？","少ない","日常的"]
];
let qIndex=0;const slider=$("#pref-slider");
function renderQuestion(){if(!$("#q-text"))return;const q=questions[qIndex];$("#q-count").textContent=(qIndex+1)+" / "+questions.length;$("#q-text").textContent=q[0];$("#q-left").textContent=q[1];$("#q-right").textContent=q[2];$("#q-prev").disabled=qIndex===0;$("#q-next").textContent=qIndex===questions.length-1?"完了":"次へ"}
slider?.addEventListener("input",()=>$("#pref-value").textContent=slider.value);
$("#importance")?.addEventListener("click",e=>{const b=e.target.closest(".imp");if(!b)return;$$(".imp",$("#importance")).forEach(x=>x.classList.remove("active"));b.classList.add("active")});
$("#q-next")?.addEventListener("click",()=>{if(qIndex<questions.length-1){qIndex++;renderQuestion()}else{notify("Career Profileを更新したよ");go("home")}});
$("#q-prev")?.addEventListener("click",()=>{if(qIndex>0){qIndex--;renderQuestion()}});
renderQuestion();

/* analysis */
function validUrl(v){try{const u=new URL(v);return u.protocol==="https:"||u.protocol==="http:"}catch{return false}}
function analyze(url){
  if(!validUrl(url)){notify("URLを確認してね");return}
  const input=$("#analyze-url");if(input)input.value=url;go("analyze");
  const progress=$("#analysis-progress");if(!progress)return;progress.hidden=false;
  const steps=$$(".step",progress), title=$("#stage-title"), labels=["求人情報を確認中","条件を整理中","価値観と比較中"];
  steps.forEach((s,i)=>{s.classList.toggle("active",i===0);s.classList.remove("done")});
  labels.forEach((txt,i)=>setTimeout(()=>{steps.forEach((s,j)=>{s.classList.toggle("active",j===i);s.classList.toggle("done",j<i)});if(title)title.textContent=txt},i*620));
  setTimeout(()=>{progress.hidden=true;const c=$("#result-company");if(c)c.textContent="サンプルテック株式会社";go("result")},2200)
}
$("#home-analyze")?.addEventListener("submit",e=>{e.preventDefault();analyze($("#home-url").value.trim())});
$("#analyze-form")?.addEventListener("submit",e=>{e.preventDefault();analyze($("#analyze-url").value.trim())});
$$("[data-result]").forEach(b=>b.addEventListener("click",()=>{const c=$("#result-company");if(c)c.textContent=b.dataset.result;go("result")}));
$$(".axis-toggle").forEach(b=>b.addEventListener("click",()=>b.closest(".axis").classList.toggle("open")));

/* history filters */
let roleFilter="all";const historyRows=$$(".history-row"), historyList=$("#history-list"), statusFilter=$("#status-filter"), sortFilter=$("#sort-filter");
function applyHistory(){
  if(!historyRows.length)return;
  let rows=historyRows.filter(r=>{const rOk=roleFilter==="all"||r.dataset.role===roleFilter;let sOk=true;if(statusFilter?.value==="close")sOk=+r.dataset.close>=5;if(statusFilter?.value==="different")sOk=+r.dataset.diff>0;if(statusFilter?.value==="unknown")sOk=+r.dataset.unknown>0;return rOk&&sOk});
  const key=sortFilter?.value||"recent";rows.sort(key==="close"?(a,b)=>+b.dataset.close-+a.dataset.close:key==="unknown"?(a,b)=>+a.dataset.unknown-+b.dataset.unknown:(a,b)=>+a.dataset.age-+b.dataset.age);
  historyRows.forEach(r=>r.hidden=true);rows.forEach(r=>{r.hidden=false;historyList?.appendChild(r)});const empty=$("#history-empty");if(empty)empty.style.display=rows.length?"none":"block"
}
$("#role-chips")?.addEventListener("click",e=>{const b=e.target.closest(".chip");if(!b)return;roleFilter=b.dataset.role;$$(".chip",$("#role-chips")).forEach(x=>x.classList.toggle("active",x===b));applyHistory()});
statusFilter?.addEventListener("change",applyHistory);sortFilter?.addEventListener("change",applyHistory);applyHistory();

/* insights */
const axisLabels=["働く場所","裁量","協働","成長","変化","時間","役割の幅","顧客接点"], selfValues=[92,82,66,74,70,88,83,72];
const cohorts={backend:{label:"Backend志望",values:[64,76,70,71,63,69,72,54]},all:{label:"28卒全体",values:[58,62,73,68,59,64,61,62]},kansai:{label:"関西",values:[55,64,75,66,57,62,63,59]}};
let currentCohort="backend";
function polar(cx,cy,r,i,n){const a=-Math.PI/2+Math.PI*2*i/n;return[cx+Math.cos(a)*r,cy+Math.sin(a)*r]}
function poly(vals,cx,cy,r){return vals.map((v,i)=>{const [x,y]=polar(cx,cy,r*v/100,i,vals.length);return x.toFixed(1)+","+y.toFixed(1)}).join(" ")}
function renderPositions(key){const c=cohorts[key],host=$("#axis-position-list");if(!c||!host)return;host.innerHTML=axisLabels.map((lab,i)=>{const lo=Math.max(0,c.values[i]-12),hi=Math.min(100,c.values[i]+12);return '<div class="axis-position"><div class="axis-position-head"><strong>'+lab+'</strong><span>'+selfValues[i]+'</span></div><div class="position-track"><span class="position-range" style="left:'+lo+'%;width:'+(hi-lo)+'%"></span><span class="position-self" style="left:'+selfValues[i]+'%"></span></div></div>'}).join("")}
function renderRadar(key){
  currentCohort=key;const grid=$("#insight-grid"),safe=$("#safe-cohort"),pos=$("#position-section");
  if(key==="faculty"){if(grid)grid.style.display="none";if(safe)safe.style.display="block";if(pos)pos.style.display="none";return}
  if(grid)grid.style.display="grid";if(safe)safe.style.display="none";if(pos)pos.style.display="block";
  const c=cohorts[key],svg=$("#radar");if(!c||!svg)return;$("#cohort-label").textContent=c.label;
  const cx=210,cy=210,R=142,n=8;let out="";
  [25,50,75,100].forEach(p=>{const pts=Array.from({length:n},(_,i)=>polar(cx,cy,R*p/100,i,n).join(",")).join(" ");out+='<polygon class="radar-grid" points="'+pts+'"/>'});
  axisLabels.forEach((lab,i)=>{const [x,y]=polar(cx,cy,R,i,n),[lx,ly]=polar(cx,cy,R+32,i,n);out+='<line class="radar-axis" x1="'+cx+'" y1="'+cy+'" x2="'+x+'" y2="'+y+'"/><text class="radar-label" x="'+lx+'" y="'+ly+'" text-anchor="middle" dominant-baseline="middle">'+lab+"</text>"});
  out+='<polygon class="radar-cohort" points="'+poly(c.values,cx,cy,R)+'"/><polygon class="radar-self" points="'+poly(selfValues,cx,cy,R)+'"/>';
  selfValues.forEach((v,i)=>{const [x,y]=polar(cx,cy,R*v/100,i,n);out+='<circle class="radar-point" cx="'+x+'" cy="'+y+'" r="4"/>'});svg.innerHTML=out;
  const metrics=$("#insight-metrics");if(metrics)metrics.innerHTML=axisLabels.map((lab,i)=>{const d=selfValues[i]-c.values[i],msg=d>12?"高め":d<-12?"低め":"近い";return '<div class="metric"><div><strong>'+lab+'</strong><div class="meta">'+c.label+'との差 '+(d>=0?"+":"")+d+'</div></div><div class="metric-value">'+msg+"</div></div>"}).join("");
  renderPositions(key)
}
$("#cohort-tabs")?.addEventListener("click",e=>{const b=e.target.closest(".chip");if(!b)return;$$(".chip",$("#cohort-tabs")).forEach(x=>x.classList.toggle("active",x===b));renderRadar(b.dataset.cohort)});
renderRadar("backend");

/* settings */
$("#settings-tabs")?.addEventListener("click",e=>{const b=e.target.closest(".tab");if(!b)return;$$(".tab",$("#settings-tabs")).forEach(x=>x.classList.toggle("active",x===b));$$(".settings-pane").forEach(p=>p.classList.toggle("active",p.id==="pane-"+b.dataset.tab))});
$$(".switch").forEach(b=>b.addEventListener("click",()=>{const on=b.classList.toggle("on");b.setAttribute("aria-pressed",String(on));renderCandidateProjection();notify(on?"ONにしたよ":"OFFにしたよ")}));
$("#save-profile")?.addEventListener("click",()=>notify("プロフィールを保存したよ"));
$("#logout")?.addEventListener("click",()=>notify("モックなのでログアウトはしないよ"));
const consentModal=$("#consent-modal");$("#consent-history")?.addEventListener("click",()=>consentModal?.classList.add("open"));$("#consent-close")?.addEventListener("click",()=>consentModal?.classList.remove("open"));
$("#export-data")?.addEventListener("click",()=>{const data={profile:{display_name:$("#display-name")?.value||"sample",school:$("#school")?.value||"",faculty:$("#faculty")?.value||""},career_profile:{target_roles:["Backend Engineer"],axis_values:selfValues},consents:{community:$("#consent-community")?.classList.contains("on")??true,external:$("#consent-external")?.classList.contains("on")??false}};const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="job-match-data.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);notify("JSONを作ったよ")});

/* share */
const shareModal=$("#share-modal");
$("#open-share")?.addEventListener("click",()=>{const company=$("#result-company")?.textContent||"サンプルテック株式会社";if($("#share-company"))$("#share-company").textContent=company;if($("#public-company"))$("#public-company").textContent=company;shareModal?.classList.add("open")});
$("#share-close")?.addEventListener("click",()=>shareModal?.classList.remove("open"));
$("#share-public")?.addEventListener("click",()=>{shareModal?.classList.remove("open");go("public")});
$("#share-x")?.addEventListener("click",()=>{const company=$("#share-company")?.textContent||"サンプルテック株式会社",text=company+" × Backend Engineer\n近い 5 / 相違 1 / 情報不足 2\n#jobmatch";window.open("https://x.com/intent/tweet?text="+encodeURIComponent(text)+"&url="+encodeURIComponent("https://example.invalid/share/sample"),"_blank","noopener,noreferrer")});
$("#share-image")?.addEventListener("click",async()=>{const canvas=document.createElement("canvas");canvas.width=1200;canvas.height=630;const ctx=canvas.getContext("2d"),company=$("#share-company")?.textContent||"サンプルテック株式会社";ctx.fillStyle="#f6fbff";ctx.fillRect(0,0,1200,630);ctx.fillStyle="#fff";ctx.strokeStyle="#dfeaf3";ctx.lineWidth=2;const rr=(x,y,w,h,r)=>{ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):ctx.rect(x,y,w,h);ctx.closePath()};rr(48,42,1104,546,34);ctx.fill();ctx.stroke();ctx.fillStyle="#37a9ea";ctx.font='800 20px "Zen Maru Gothic",sans-serif';ctx.fillText("SHARE RESULT",74,96);ctx.fillStyle="#172235";ctx.font='700 34px "Zen Maru Gothic",sans-serif';ctx.fillText("job match",74,150);ctx.font='700 54px "Zen Maru Gothic",sans-serif';ctx.fillText(company,74,235);ctx.fillStyle="#718196";ctx.font='500 30px "Zen Kaku Gothic New",sans-serif';ctx.fillText("Backend Engineer",74,282);[["5","近い"],["1","相違"],["2","情報不足"]].forEach(([n,l],i)=>{const x=74+i*220,y=336;ctx.fillStyle="#f8fcff";rr(x,y,194,106,20);ctx.fill();ctx.fillStyle="#172235";ctx.font='700 46px "Zen Maru Gothic",sans-serif';ctx.fillText(n,x+18,y+56);ctx.fillStyle="#718196";ctx.font='500 24px "Zen Kaku Gothic New",sans-serif';ctx.fillText(l,x+18,y+87)});ctx.fillStyle="#4d647b";ctx.font='500 24px "Zen Kaku Gothic New",sans-serif';ctx.fillText("裁量  /  役割の幅  /  顧客接点",74,502);ctx.fillStyle="#718196";ctx.font='500 20px "Zen Kaku Gothic New",sans-serif';ctx.fillText("個人情報を含めず、比較結果だけを共有",74,557);try{const image=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src="../../asset/mascot/success.webp"});ctx.drawImage(image,928,96,180,180)}catch{}const a=document.createElement("a");a.href=canvas.toDataURL("image/png");a.download="job-match-share.png";a.click();notify("共有画像を作ったよ")});
$$(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("open")}));

/* future only */
function renderCandidateProjection(){
  const host=$("#candidate-visible-fields");if(!host)return;
  const fields=[["希望職種","Backend Engineer"],["価値観","8軸公開"]];
  if($("#show-school")?.classList.contains("on"))fields.push(["大学","大阪電気通信大学"]);
  if($("#show-faculty")?.classList.contains("on"))fields.push(["学部","総合情報学部"]);
  if($("#show-portfolio")?.classList.contains("on"))fields.push(["Portfolio","公開"]);
  host.innerHTML=fields.map(([a,b])=>'<div class="visibility-line"><span>'+a+'</span><strong>'+b+"</strong></div>").join("")
}
if(mode==="future"){
  const modeSwitch=$("#mode-switch"),scoutOpen=$("#scout-open"),avatar=$(".avatar");
  modeSwitch?.addEventListener("click",()=>{enterpriseMode=!enterpriseMode;body.classList.toggle("enterprise-mode",enterpriseMode);modeSwitch.classList.toggle("on",enterpriseMode);modeSwitch.textContent=enterpriseMode?"利用者デモ":"企業デモ";if(scoutOpen)scoutOpen.hidden=enterpriseMode;if(avatar)avatar.hidden=enterpriseMode;enterpriseMode?goEnterprise("enterprise-home"):go("home")});
  scoutOpen?.addEventListener("click",()=>go("scouts"));$("#home-scout-open")?.addEventListener("click",()=>go("scouts"));
  const scoutList=$("#scout-list"),scoutThread=$("#scout-thread");
  $$("[data-scout-thread]").forEach(b=>b.addEventListener("click",()=>{if(scoutList)scoutList.hidden=true;if(scoutThread)scoutThread.hidden=false;$("#thread-company").textContent=b.dataset.scoutThread==="cloud"?"サンプルクラウド株式会社":"サンプルラボ株式会社"}));
  $("#scout-back")?.addEventListener("click",()=>{if(scoutThread)scoutThread.hidden=true;if(scoutList)scoutList.hidden=false});
  $("#thread-form")?.addEventListener("submit",e=>{e.preventDefault();const input=$("#thread-input"),v=input.value.trim();if(!v)return;const div=document.createElement("div");div.className="bubble me";div.textContent=v;$("#thread-messages").appendChild(div);input.value="";notify("送信したよ")});
  const reveal=$("#reveal-modal");$("#identity-reveal-open")?.addEventListener("click",()=>reveal?.classList.add("open"));$("#reveal-cancel")?.addEventListener("click",()=>reveal?.classList.remove("open"));$("#reveal-confirm")?.addEventListener("click",()=>{reveal?.classList.remove("open");$("#identity-state-text").textContent="本人情報をこの企業に開示済み";$("#identity-reveal-open").hidden=true;const n=$("#ent-thread-name"),s=$("#ent-thread-state");if(n)n.textContent="長瀬 唯楓";if(s)s.textContent="本人同意済み · sample.user@gmail.com";notify("この企業にだけ開示したよ")});
  $("#candidate-preview-open")?.addEventListener("click",()=>go("candidate-preview"));renderCandidateProjection();
  let verified=false;$("#mock-verify")?.addEventListener("click",()=>{verified=!verified;const a=$("#edu-badge"),b=$("#candidate-verification");[a,b].forEach(x=>{if(x){x.textContent=verified?"verified":"self-reported";x.classList.toggle("verified",verified)}});notify(verified?"確認済みにしたよ":"自己申告に戻したよ")});
  const candidateModal=$("#candidate-modal");
  $$(".candidate-open").forEach(b=>b.addEventListener("click",()=>{$("#candidate-modal-title").textContent="Candidate #"+b.dataset.candidate;$("#candidate-modal-fields").innerHTML=b.dataset.candidate==="A8F31"?($("#candidate-visible-fields")?.innerHTML||""):'<div class="visibility-line"><span>希望職種</span><strong>Platform Engineer</strong></div><div class="visibility-line"><span>価値観</span><strong>8軸公開</strong></div>';candidateModal?.classList.add("open")}));
  $("#candidate-close")?.addEventListener("click",()=>candidateModal?.classList.remove("open"));$("#send-scout")?.addEventListener("click",()=>{candidateModal?.classList.remove("open");notify("匿名スカウトを送ったよ")});
  const del=$("#delete-modal");$("#delete-account")?.addEventListener("click",()=>del?.classList.add("open"));$("#delete-cancel")?.addEventListener("click",()=>del?.classList.remove("open"));$("#delete-confirm")?.addEventListener("click",()=>{del?.classList.remove("open");notify("削除フロー確認（モック）")})
}
})();