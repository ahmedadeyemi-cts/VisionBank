/* Bounded diagnostic history only: no customer records, credentials, or network calls. */
(() => {
  'use strict';
  const KEY='vbWebexReportHealthV1', MAX=20;
  const clean=r=>r&&r.endpoint==='/api/webex/dashboard'&&['ready','unavailable'].includes(r.state)&&Number.isFinite(r.startedAt)&&Number.isFinite(r.finishedAt)?{
    endpoint:r.endpoint,state:r.state,startedAt:r.startedAt,finishedAt:r.finishedAt,
    elapsedMs:Number.isFinite(r.elapsedMs)?Math.max(0,r.elapsedMs):null,
    httpStatus:Number.isInteger(r.httpStatus)?r.httpStatus:null,
    failure:r.state==='unavailable'?['timeout','network-or-response-error'].includes(r.failure)||/^HTTP [1-5]\d{2}$/.test(r.failure||'')?r.failure:'request-error':null
  }:null;
  let history=[];
  try {const previous=JSON.parse(sessionStorage.getItem(KEY)||'[]');if(Array.isArray(previous))history=previous.map(clean).filter(Boolean).slice(-MAX);}catch{}
  function publish(){window.VB_REPORT_HEALTH_HISTORY=history.map(r=>Object.freeze({...r}));window.VB_REPORT_LAST_FAILURE=[...history].reverse().find(r=>r.state==='unavailable')||null;}
  window.VB_REPORT_DIAGNOSTICS=Object.freeze({record(raw){
    const row=clean(raw);if(!row)return;
    history=[...history,row].slice(-MAX);publish();
    try{sessionStorage.setItem(KEY,JSON.stringify(history));}catch{}
  }});
  publish();
})();
