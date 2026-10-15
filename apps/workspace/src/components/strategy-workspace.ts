import type { StrategyDirection } from './strategy-direction-text'

export type SchemePane = 'content' | 'funding' | 'operations' | 'sensitivity'
export type StrategyWorkspaceNavigation = { view: 'assessment' | 'scenarios' | 'evidence' | 'actions' | 'knowledge'; section?: string; pane?: SchemePane; scheme?: StrategyDirection }
