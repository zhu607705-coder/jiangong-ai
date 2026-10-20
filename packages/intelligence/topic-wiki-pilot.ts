import {readFile,writeFile,rename,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import type {IntelRepository} from './repository'

/** Optional server-owner ticket. HTTP/model inputs cannot issue or expand it. */
export async function topicPilotLimit(repo:IntelRepository,dataDir:string,topic:string,inputHash:string,ordinaryLimit:number,now=new Date()){
  const count=(await repo.knowledgeStats('local-operator'))?.model_calls_today as number|undefined
  if(count===undefined||count<ordinaryLimit)return ordinaryLimit
  const path=join(dataDir,'.topic-wiki-pilot.json')
  let ticket:{expires_at:string;ordinary_limit:number;extra_calls:number;topics:string[];used:{topic:string;input_hash:string;reserved_at:string}[]}
  try{const info=await stat(path);if(process.platform!=='win32'&&(info.mode&0o077)!==0)return ordinaryLimit;ticket=JSON.parse(await readFile(path,'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return ordinaryLimit;throw error}
  const expiry=Date.parse(ticket.expires_at)
  if(!Number.isFinite(expiry)||expiry<=now.getTime()||expiry>now.getTime()+86400000||ticket.ordinary_limit!==ordinaryLimit||ticket.extra_calls!==2||!Array.isArray(ticket.topics)||!ticket.topics.includes(topic)||!Array.isArray(ticket.used))return ordinaryLimit
  if(ticket.used.some(row=>row.topic===topic&&row.input_hash===inputHash))return ordinaryLimit+2
  if(ticket.used.length>=2)return ordinaryLimit
  ticket.used.push({topic,input_hash:inputHash,reserved_at:now.toISOString()})
  const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(ticket,null,2)+'\n',{mode:0o600});await rename(tmp,path)
  return ordinaryLimit+2
}
