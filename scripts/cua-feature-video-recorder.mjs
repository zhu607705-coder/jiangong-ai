// Load this module inside cua_repl and pass its existing localhost tab binding.
// All UI operations use the documented Cua tab/CDP APIs; no browser is opened.
import fs from 'node:fs/promises';

export default async function setupRecorder(tab, root='D:/建工ai/output/video/full-feature-20261014') {
  const cdp=await tab.capabilities.get('cdp');
  await cdp.send('Page.stopScreencast');
  const capture=JSON.parse(await fs.readFile(root+'/capture.json','utf8'));
  const scenes=JSON.parse(await fs.readFile('D:/建工ai/data/templates/full-feature-video-scenes.json','utf8'));
  const rec={tab,cdp,fs,root,capture,scenes,current:null};
  for(const chapter of capture.chapters)if(!chapter.end_ms){chapter.end_ms=Date.now();chapter.valid=false;chapter.note='interrupted capture recovered';}
  const files=(await fs.readdir(root+'/raw')).filter(name=>/^frame-\d+\.jpg$/.test(name)).sort();
  const indexed=new Set(capture.frames.map(frame=>frame.file));
  for(const name of files){const file=root+'/raw/'+name;if(!indexed.has(file)){const stat=await fs.stat(file);capture.frames.push({file,wall_ms:stat.mtimeMs,sequence:null,protocol_timestamp:null,orphaned:true});}}
  capture.downloads ||= [];
  rec.save=()=>fs.writeFile(root+'/capture.json',JSON.stringify(capture));
  rec.pause=(ms=1600)=>new Promise(resolve=>setTimeout(resolve,ms));
  rec.end=async(valid=true,note='')=>{if(rec.current){rec.current.end_ms=Date.now();rec.current.valid=valid;rec.current.note=note;rec.current=null;await rec.save();}};
  rec.begin=async key=>{await rec.end();const scene=scenes.find(value=>value.key===key);if(!scene)throw Error('Unknown chapter '+key);rec.current={...scene,start_ms:Date.now(),valid:true};capture.chapters.push(rec.current);await rec.save();};
  rec.reveal=async locator=>{
    for(let attempt=0;attempt<9;attempt++){
      const info=await locator.evaluate(el=>{const r=el.getBoundingClientRect();const sc=el.closest('.floating-evidence-body')||el.closest('.map-data-panel')||el.closest('.research-drawer-scroll');const b=sc?.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},scroll:b?{x:b.x,y:b.y,width:b.width,height:b.height}:null};});
      const top=Math.max(0,info.scroll?.y||0),bottom=Math.min(899,info.scroll?info.scroll.y+info.scroll.height:899);
      const start=Math.max(top,info.rect.y),end=Math.min(bottom,info.rect.y+info.rect.height);
      if(info.rect.width>0&&end-start>=15)return {...info.rect,y:start,height:end-start};
      if(!info.scroll)throw Error('Offscreen control');
      const box=info.scroll,x=Math.min(1550,Math.max(80,box.x+box.width/2)),y=Math.min(820,Math.max(150,box.y+box.height/2));
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:info.rect.y-(top+bottom)/2});
      await tab.playwright.domSnapshot();await rec.pause(350);
    }
    throw Error('Cannot reveal target');
  };
  rec.tap=async(rect,label)=>{const p={x:rect.x+rect.width/2,y:rect.y+rect.height/2};capture.actions.push({label,wall_ms:Date.now(),rect});await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
  rec.click=async(locator,label)=>{await locator.click({timeoutMs:5000});capture.actions.push({label,wall_ms:Date.now()});};
  rec.download=async(locator,label)=>{
    // Catch immediately so a failed click or timeout cannot reset the REPL kernel.
    const waiting=tab.playwright.waitForEvent('download',{timeoutMs:15000}).then(async download=>({file:await download.path()})).catch(error=>({error:String(error)}));
    await rec.click(locator,label);const result=await waiting;
    capture.downloads.push({chapter:rec.current?.key,label,wall_ms:Date.now(),...result});await rec.save();return result;
  };
  rec.range=async(locator,value,label)=>{
    const rect=await rec.reveal(locator);
    const attrs=await locator.evaluate(el=>({min:Number(el.min),max:Number(el.max),value:Number(el.value)}));
    const position=n=>rect.x+8+(rect.width-16)*(n-attrs.min)/(attrs.max-attrs.min);
    const y=rect.y+rect.height/2,from=position(attrs.value),to=position(value);
    capture.actions.push({label,wall_ms:Date.now(),rect});
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:from,y,button:'left',clickCount:1});
    for(let step=1;step<=14;step++){await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from+(to-from)*step/14,y,button:'left',buttons:1});await rec.pause(35);}
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to,y,button:'left',clickCount:1});
  };
  rec.part=async action=>{
    const segment={index:capture.segments.length,chapter_key:rec.current?.key,start_ms:Date.now(),first_frame:capture.frames.length,valid:true};
    let enabled=true,loopError;
    let cursor=(await cdp.readEvents({methods:['Page.screencastFrame']})).cursor;
    await cdp.send('Page.startScreencast',{format:'jpeg',quality:87,maxWidth:1600,maxHeight:900,everyNthFrame:3});
    const loop=(async()=>{try{while(enabled){const batch=await cdp.readEvents({afterSequence:cursor,methods:['Page.screencastFrame'],limit:10,timeoutMs:100});cursor=batch.cursor;if(batch.truncated)throw Error('Capture buffer truncated');for(const event of batch.events){if(!enabled)break;const p=event.params,file=root+'/raw/frame-'+String(capture.frames.length).padStart(7,'0')+'.jpg';await fs.writeFile(file,Buffer.from(p.data,'base64'));capture.frames.push({file,wall_ms:Date.now(),protocol_timestamp:p.metadata?.timestamp,sequence:event.sequence});await cdp.send('Page.screencastFrameAck',{sessionId:p.sessionId});}}}catch(error){loopError=String(error);enabled=false;}})();
    try{await action();}catch(error){segment.valid=false;segment.error=String(error);}finally{enabled=false;await cdp.send('Page.stopScreencast');await loop;if(loopError){segment.valid=false;segment.error=loopError;}const snapshot=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:90});const file=root+'/raw/frame-'+String(capture.frames.length).padStart(7,'0')+'.jpg';await fs.writeFile(file,Buffer.from(snapshot.data,'base64'));capture.frames.push({file,wall_ms:Date.now(),protocol_timestamp:null,sequence:null,method:'Page.captureScreenshot'});segment.end_ms=Date.now();segment.last_frame=capture.frames.length-1;capture.segments.push(segment);await rec.save();}
    return {valid:segment.valid,error:segment.error,frames:segment.last_frame-segment.first_frame+1,index:segment.index};
  };
  await rec.save();return rec;
}
