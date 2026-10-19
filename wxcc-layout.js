/* Layout-only companion to the shared Webex reporting and controls. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 if(new URLSearchParams(location.search).get('view')==='agent-desktop')document.body.classList.add('wxcc-desktop-view');
 const queueTable=$('queue-body')?.closest('table');
 if(queueTable){const scroll=document.createElement('div');scroll.className='wxcc-queue-scroll';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Current queue status; scroll horizontally for more columns');queueTable.before(scroll);scroll.append(queueTable);}
 function arrange(){
  const voice=$('vbVoiceStatistics'),chat=$('vbChatStats'),panel=$('voice-statistics-panel');
  if(voice){
   const meta=voice.querySelector(':scope > .vb-voice-meta[role="status"]');
   if(meta&&meta!==voice.lastElementChild)voice.append(meta);
   for(const section of voice.querySelectorAll(':scope > section')){
    if(section.querySelector('[data-voice-metric="nowWaiting"]'))section.classList.add('wxcc-hidden-workload');
   }
  }
  if(chat&&panel){
   if(chat.parentElement!==panel)panel.append(chat);
   const title=chat.querySelector('h2');if(title&&title.textContent!=="Today’s Chat Statistics")title.textContent="Today’s Chat Statistics";
  }
 }
 const observer=new MutationObserver(arrange);observer.observe(document.querySelector('main'),{childList:true,subtree:true});arrange();
 const pinned=document.querySelector('.wxcc-pinned-header');
 const resize=new ResizeObserver(()=>{const value=Math.ceil(pinned.getBoundingClientRect().height)+16+'px';if(document.documentElement.style.getPropertyValue('--wxcc-anchor-offset')!==value)document.documentElement.style.setProperty('--wxcc-anchor-offset',value);});resize.observe(pinned);
})();
