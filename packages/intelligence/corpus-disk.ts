import {mkdir,writeFile,readFile,rename,statfs} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {hash,canonical,type Material} from './domain'
import {documentSlices} from '../experience/document-slices'
import {semanticWindows,RAG_INDEX_POLICY} from '../experience/semantic-index'

/** Public-only, content-addressed files beside the existing DB. No model controls paths. */
export class CorpusDisk {
  readonly root:string
  constructor(dataDir:string,private reserveBytes=5*1024**3){this.root=resolve(dataDir,'corpus-public')}
  async capacity(){await mkdir(this.root,{recursive:true});const s=await statfs(this.root);const available=s.bavail*s.bsize;if(available<this.reserveBytes)throw Error('CORPUS_DISK_LOW');return {available_bytes:available,reserve_bytes:this.reserveBytes}}
  private async put(path:string,body:string){
    await mkdir(resolve(path,'..'),{recursive:true})
    try{const existing=await readFile(path,'utf8');if(existing===body)return;throw Error('CORPUS_ARCHIVE_HASH_CONFLICT')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,body,{mode:0o600});await rename(tmp,path)
  }
  async persist(m:Material,raw?:string){
    if(m.source.synthetic||m.source.visibility!=='public'||m.source.data_class!=='public'||!m.text.trim()||m.source.content_status==='metadata_only')throw Error('PUBLIC_ORIGINAL_REQUIRED')
    if(!/^ID-[a-f0-9]{24}$/.test(m.id)||!/^([a-f0-9]{64})$/.test(m.version))throw Error('CORPUS_INVALID_IDENTITY')
    await this.capacity()
    const bodyHash=hash(m.text),rawHash=raw===undefined?null:hash(raw),base=join(this.root,'documents',m.id,m.version)
    const slices=documentSlices({file_name:'original.md',parser_result:{text:m.text}})
    const chunks=semanticWindows(slices.map(s=>({id:m.id+'@'+m.version+':'+s.locator,version:m.version,text:s.text,locator:s.locator,file_name:m.title})))
    await this.put(join(this.root,'blobs',bodyHash+'.md'),m.text)
    if(raw!==undefined)await this.put(join(this.root,'blobs',rawHash+'.raw.txt'),raw)
    // original.md has no added heading/frontmatter, so line locators resolve unchanged.
    await this.put(join(base,'original.md'),m.text)
    await this.put(join(base,'chunks.jsonl'),chunks.map(c=>JSON.stringify({...c,document_id:m.id,document_version:m.version,body_sha256:bodyHash,offset_encoding:'UTF-16',content_role:'untrusted_source_material',index_policy:RAG_INDEX_POLICY})).join('\n')+'\n')
    // Observation timestamps belong to the observation ledger, not immutable version files.
    const {retrieved_at:_at,id:_alias,...stableSource}=m.source
    const manifest={schema_version:'1.0',id:m.id,version:m.version,url:m.url,title:m.title,body_sha256:bodyHash,source:stableSource,content_role:'untrusted_source_material',index_policy:RAG_INDEX_POLICY,chunks:chunks.length}
    await this.put(join(base,'source.json'),canonical(manifest)+'\n')
    if(raw!==undefined)await this.put(join(base,'raw.json'),canonical({sha256:rawHash,blob:`blobs/${rawHash}.raw.txt`,representation:'collector_received_body'})+'\n')
    return {path:`documents/${m.id}/${m.version}`,body_sha256:bodyHash,raw_sha256:rawHash,chunks:chunks.length}
  }
}
