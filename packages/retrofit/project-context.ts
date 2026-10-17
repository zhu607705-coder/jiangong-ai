/** Saved with a report; model, cache and transport completion clocks are not project revisions. */
export type ProjectContextRef = {
  policy:'project-context-v1'; project_id:string; context_version:number;
  object_revision:string; conditions_revision:string; input_hash:string
}
