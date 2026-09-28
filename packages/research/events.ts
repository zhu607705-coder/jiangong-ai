import type { MapScreenAnalysis } from '../../apps/host/generated/contracts'

export type ResearchProgress = {
  type: 'progress'; stage: 'sources' | 'search' | 'fetch' | 'adapters' | 'decision' | 'brief';
  status: 'running' | 'completed' | 'partial'; message: string; source_id?: string;
}
export type ResearchEvent = ResearchProgress | { type:'brief'; result:MapScreenAnalysis } | { type:'complete'; result:MapScreenAnalysis } | { type:'error'; message:string }
export type ProgressSink = (event: ResearchProgress) => void
export type ResearchSink = (event: ResearchProgress | {type:'brief';result:MapScreenAnalysis}) => void | Promise<void>
