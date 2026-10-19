/* A narrow embedding exception for the WXCC overview. Access checks still run. */
(()=>{'use strict';
 const DESKTOP='https://desktop.wxcc-us1.cisco.com';
 function isAllowedEmbed(){
  try{
   if(location.pathname!=='/wxcc.html'||new URLSearchParams(location.search).get('view')!=='agent-desktop')return false;
   if(window.top===window.self||window.parent!==window.top)return false;
   const ancestors=location.ancestorOrigins;
   if(ancestors&&ancestors.length)return ancestors.length===1&&ancestors[0]===DESKTOP;
   return !!document.referrer&&new URL(document.referrer).origin===DESKTOP;
  }catch{return false;}
 }
 window.VBFramePolicy=Object.freeze({isAllowedEmbed});
})();
