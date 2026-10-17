export type ResearchLineage={source_ids:string[];source_versions:Record<string,string>;contains_internal:boolean;authorized_view_hash:string}
export type ResearchManifest={id:string;parent_id:string|null;version:number;source_versions:Record<string,string>;created_at:string;question_ids:string[]}
export interface ResearchExecution {
  run<T>(key:string,input:unknown,execute:()=>Promise<T>,options?:{lineage?:ResearchLineage;retry?:boolean}):Promise<T>
  manifest(sources:{id:string;text:string;document_version?:string;visibility?:string;data_class?:string}[],questionIds?:string[]):Promise<ResearchManifest>
  call<T>(provider:string,operation:string,request:unknown,execute:()=>Promise<T>,usage?:(result:T)=>unknown):Promise<T>
  event(value:unknown):Promise<void>
  completed(prefix:string):Promise<{key:string;output:any}[]>
  checkAccess(sourceIds:readonly string[]):Promise<void>
  timings():Promise<{expert_p95_ms?:number;synthesis_p95_ms?:number;sample_count:number}>
  beginCall(provider:string,operation:string,request:unknown):Promise<string>
  finishCall(id:string,usage:unknown,outcome?:'received'|'failed'|'unknown_outcome',billing?:'expected_charge'|'expected_free'|'unknown'):Promise<void>
  recordWebCall(receipt:{id:string;provider:string;operation:string;request_hash:string;outcome:string;billing_state:string;duration_ms:number;[key:string]:unknown}):Promise<void>
  readonly deadlineAt:number
  readonly resumed:boolean
  readonly provider:'legacy'|'deepseek_tools'|'deepseek_content'
}
