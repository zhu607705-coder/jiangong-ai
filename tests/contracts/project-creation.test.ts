import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, test } from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import { Store, type Database } from '../../apps/host/store'
import { saveProjectCreation } from '../../apps/host/project-creation'
import type { ProjectInput } from '../../apps/host/generated/contracts'

let db:PGlite,store:Store
beforeEach(async()=>{
  db=new PGlite();await db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT NOT NULL,input JSONB NOT NULL,context_version INT NOT NULL DEFAULT 0,created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now())')
  store=new Store(db as unknown as Database,'test')
})
afterEach(async()=>{await db.close()})
const input=()=>({...structuredClone(fixture),project_id:'P-STABLE-CREATE'} as ProjectInput)
test('a retried creation after a lost response returns the same project without duplicating rows',async()=>{
  const value=input(),before=JSON.stringify(value)
  const first=await saveProjectCreation(store,'OWNER','测试对象',value),again=await saveProjectCreation(store,'OWNER','测试对象',value)
  expect(first.status).toBe(201);expect(again.status).toBe(200)
  expect((await store.projects('OWNER'))).toHaveLength(1);expect(JSON.stringify(value)).toBe(before)
})
test('a changed draft cannot overwrite an already-created project and ownership is preserved',async()=>{
  await saveProjectCreation(store,'OWNER','测试对象',input())
  expect(await saveProjectCreation(store,'OWNER','改名后的不同请求',input())).toEqual({status:409})
  expect(await saveProjectCreation(store,'ANOTHER-OWNER','测试对象',input())).toEqual({status:409})
  expect((await store.project(input().project_id,'OWNER'))?.name).toBe('测试对象')
  expect(await store.project(input().project_id,'ANOTHER-OWNER')).toBeUndefined()
})
test('overlapping identical requests create only one row',async()=>{
  const results=await Promise.all([saveProjectCreation(store,'OWNER','同一次创建',input()),saveProjectCreation(store,'OWNER','同一次创建',input())])
  expect(results.map(row=>row.status).sort()).toEqual([200,201]);expect(await store.projects('OWNER')).toHaveLength(1)
})
