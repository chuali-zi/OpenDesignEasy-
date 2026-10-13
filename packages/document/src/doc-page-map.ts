import type{DocSection}from'./model.ts';
import{KernelError}from'./errors.ts';

export type DocPageMap={supported:boolean;starts:Record<string,number>;blankBefore:Record<string,number>;total:number};
/** Derived browser page numbers. Continuous sections require shared-page layout, so don't invent their numbers. */
export function mapDocSectionPages(sections:readonly DocSection[],counts:Record<string,number>):DocPageMap{
 const result:DocPageMap={supported:true,starts:{},blankBefore:{},total:0};
 if(sections.some(s=>s.breakType==='continuous'))return{...result,supported:false};
 for(const [index,section]of sections.entries()){
  const count=counts[section.id]??1;if(!Number.isSafeInteger(count)||count<1)throw new KernelError('invalid','Invalid measured section page count');
  let start=result.total+1,blank=0;
  if(index>0){if(section.breakType==='evenPage'&&start%2!==0||section.breakType==='oddPage'&&start%2===0){start++;blank=1;}}
  result.starts[section.id]=start;result.blankBefore[section.id]=blank;result.total=start+count-1;
 }
 return result;
}
