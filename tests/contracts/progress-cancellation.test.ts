import { describe,it,expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

describe('cancelled map progress does not terminate the host',()=>{
  it('survives an unawaited progress notification after request cancellation',async()=>{
    const service=new URL('../../services/map-screening/service.ts',import.meta.url).href
    const code=`
      import {mkdtemp,rm} from 'node:fs/promises';
      import {tmpdir} from 'node:os';import {join} from 'node:path';
      import {MapScreeningService} from ${JSON.stringify(service)};
      const directory=await mkdtemp(join(tmpdir(),'map-cancel-process-'));
      const controller=new AbortController();
      const provider={revision:()=> 'test',query:async path=>path.includes('regeo')?{regeocode:{formatted_address:'测试位置',addressComponent:{city:'杭州'}}}:{count:'0',pois:[]}};
      const engine=new MapScreeningService(provider,directory,async(_context,_profile,signal,emit)=>{
        controller.abort(new Error('EXPECTED_CANCELLATION'));
        emit({type:'progress',stage:'fetch',status:'partial',message:'late notification'});
        signal.throwIfAborted();
      });
      try{
        const context=await engine.context({kind:'point',longitude:120,latitude:30,radius_m:800,bounds:null},controller.signal);
        await engine.analyze(context.id,'balanced',controller.signal).catch(()=>{});
        await new Promise(resolve=>setTimeout(resolve,50));
        console.log('PROCESS_SURVIVED');
      }finally{await rm(directory,{recursive:true,force:true})}
    `
    const result=await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',code],{
      cwd:fileURLToPath(new URL('../../',import.meta.url)),timeout:10000,env:{...process.env,DEEPSEEK_API_KEY:'',DEEPSEEK_SEARCH_API_KEY:'',QWEN_DECISION_API_KEY:''},
    })
    expect(result.stdout).toContain('PROCESS_SURVIVED')
    expect(result.stderr).not.toContain('EXPECTED_CANCELLATION')
  })
})
