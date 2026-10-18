import {createContext,useContext} from 'react'
import type {RenewalModeGateCheck,RenewalModeProgress} from '../../../../packages/retrofit/renewal-mode'
export type MobileWorkspaceRequest={projectId:string;revision:number;taskId:string}|null
export const MobileWorkspaceFocus=createContext<{request:MobileWorkspaceRequest;consume:()=>void}>({request:null,consume:()=>{}})
export const useMobileWorkspaceRequest=()=>useContext(MobileWorkspaceFocus)
export type MobileModeReport={endpoint:string;revision:number|undefined;hasResult:boolean;running:boolean;restoring:boolean;direction:'comprehensive'|'rebuild'|'investigate';summary:string;checks:RenewalModeGateCheck[];progress:RenewalModeProgress[];sourceCount:number;sourceIds:string[]}
export const MobileModePublisher=createContext<(report:MobileModeReport)=>void>(()=>{})
