/** The same host-owned promise/controller registry serves generic runs and research rounds. */
export class BackgroundWork {
  readonly controllers=new Map<string,AbortController>()
  readonly active=new Set<Promise<unknown>>()
  private jobs=new Map<string,Promise<unknown>>()
  has(id:string){return this.controllers.has(id)}
  wait<T>(id:string){return this.jobs.get(id) as Promise<T>|undefined}
  cancel(id:string){this.controllers.get(id)?.abort(new Error('USER_CANCELLED'))}
  launch<T>(id:string,deadlineAt:number,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    const existing=this.jobs.get(id);if(existing)return existing as Promise<T>
    const controller=new AbortController();this.controllers.set(id,controller)
    const timeout=setTimeout(()=>controller.abort(new Error('RESEARCH_DEADLINE')),Math.max(1,deadlineAt-Date.now()))
    const task=Promise.resolve().then(()=>run(controller.signal)).finally(()=>{clearTimeout(timeout);this.controllers.delete(id);this.jobs.delete(id);this.active.delete(task)})
    this.jobs.set(id,task);this.active.add(task);void task.catch(()=>undefined)
    return task
  }
  async stop(){this.controllers.forEach(controller=>controller.abort(new Error('HOST_SHUTDOWN')));await Promise.allSettled([...this.active])}
}
export const backgroundWork=new BackgroundWork()
