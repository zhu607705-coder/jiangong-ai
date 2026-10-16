import type { DocumentSlice } from './document-slices'

/** Whole parsed text, with original locators and UTF-16 boundaries preserved. */
export function learningWindows(slices:DocumentSlice[],limit=18000):{locator:string;text:string;start_char:number}[][] {
  if(!Number.isSafeInteger(limit)||limit<2)throw new Error('INVALID_LEARNING_WINDOW')
  const windows:{locator:string;text:string;start_char:number}[][]=[]
  let current:typeof windows[number]=[],size=0
  const flush=()=>{if(current.length)windows.push(current);current=[];size=0}
  for(const slice of slices) {
    let offset=0
    while(offset<slice.text.length) {
      if(size>=limit)flush()
      let end=Math.min(slice.text.length,offset+limit-size)
      // Keep a surrogate pair together, including at a partially filled window boundary.
      if(end<slice.text.length&&/[\uD800-\uDBFF]/.test(slice.text[end-1]))end--
      if(end===offset){flush();continue}
      current.push({locator:slice.locator,text:slice.text.slice(offset,end),start_char:offset})
      size+=end-offset;offset=end
    }
  }
  flush();return windows
}
