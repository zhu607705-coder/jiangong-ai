import type {PublicRecord,Source} from '../../apps/host/generated/contracts'

/** Embedded provenance keeps its original identifiers. Project aliases change
 * only the working source_id; hashes, record IDs, fields and locators survive. */
export function sourceRecords(source:Source,records:PublicRecord[]=[]):PublicRecord[]{
  const embedded=(source.public_records||[])
    .filter(record=>!!source.raw_hash&&record.source_hash===source.raw_hash)
    .map(record=>({...record,source_id:source.id}))
  return [...new Map([...embedded,...records.filter(record=>record.source_id===source.id)].map(record=>[record.id,record])).values()]
}

/** Do not turn a legacy missing snapshot into a certified empty parse. */
export function withSourceRecords(source:Source,records:PublicRecord[]):Source{
  return records.some(record=>record.source_id===source.id)?{...source,public_records:sourceRecords(source,records)}:source
}
