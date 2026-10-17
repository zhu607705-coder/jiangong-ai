import type {DeepSeekCatalogModel} from '@deepseek-ai/dsh-llm-deepseek'

/** Official catalog checked 2026-10-17; labels describe the alias, never pin a response snapshot. */
export const DEEPSEEK_CATALOG_DATE='2026-10-17'
export const DEEPSEEK_PRICING_URL='https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
export const DEEPSEEK_MODELS:DeepSeekCatalogModel[]=[
 {id:'deepseek-flash',name:'DeepSeek-V4.1-Flash-1017',contextWindow:1_000_000,maxTokens:384_000,inputModalities:['text','image'],systemPromptUpdate:'in-history',toolUpdate:'addition-only'},
 {id:'deepseek-v4-pro',name:'DeepSeek-V4-Pro-0813',contextWindow:1_000_000,maxTokens:384_000,inputModalities:['text']},
]
export function canonicalDeepSeekModel(model:string){
 const value=model.trim()
 return ['deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(value)?'deepseek-flash':value
}
export function deepSeekModelDescriptor(model:string){
 const id=canonicalDeepSeekModel(model),entry=DEEPSEEK_MODELS.find(entry=>entry.id===id)
 return {requested_model:id,documented_release:entry?.name||null,catalog_checked_at:DEEPSEEK_CATALOG_DATE,source:DEEPSEEK_PRICING_URL,version_basis:'official_alias_catalog',response_version_pinned:false,context_window:entry?.contextWindow||null,max_output_tokens:entry?.maxTokens||null}
}
