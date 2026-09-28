import type { MapScreenAnalysis } from '../../apps/host/generated/contracts'

export type ResearchProgress = {
  type: 'progress'; stage: 'sources' | 'search' | 'fetch' | 'adapters' | 'decision' | 'brief';
  status: 'running' | 'completed' | 'partial'; message: string; source_id?: string;
}
export type ResearchEvent = ResearchProgress | { type:'complete'; result:MapScreenAnalysis } | { type:'error'; message:string }
export type ProgressSink = (event: ResearchProgress) => void
