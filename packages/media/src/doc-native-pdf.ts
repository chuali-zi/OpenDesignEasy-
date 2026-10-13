import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

/** An explicitly configured local renderer; no network, shell, shared profile or fallback. */
export async function renderNativeDocPdf(bytes:Uint8Array,executable:string,signal?:AbortSignal):Promise<Uint8Array>{
 if(!isAbsolute(executable))throw new Error('OEY_DOCX_RENDERER must be an absolute local LibreOffice executable path.');
 if(!bytes.length||bytes.length>25*1024*1024)throw new Error('Native PDF input exceeds 25 MiB.');
 const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000);bounded.throwIfAborted();
 const root=await mkdtemp(join(tmpdir(),'oey-doc-pdf-'));
 try{
  const input=join(root,'document.docx'),output=join(root,'output');await mkdir(output);await writeFile(input,bytes);bounded.throwIfAborted();
  // Language/font/runtime search variables only. Model keys and provider configuration are irrelevant here.
  const env:NodeJS.ProcessEnv={};for(const key of ['PATH','LANG','LC_ALL','TMPDIR','TEMP','TMP','SYSTEMROOT','SystemRoot','LD_LIBRARY_PATH','FONTCONFIG_PATH','FONTCONFIG_FILE'])if(process.env[key]!==undefined)env[key]=process.env[key];
  await new Promise<void>((accept,reject)=>{
   const child=spawn(executable,[`-env:UserInstallation=${pathToFileURL(join(root,'profile')).href}`,'--headless','--convert-to','pdf:writer_pdf_Export:{"IsSkipEmptyPages":{"type":"boolean","value":"false"}}','--outdir',output,input],{env,stdio:'ignore',detached:process.platform!=='win32'});
   let settled=false;const abort=()=>{if(child.pid){try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch{}}};
   const done=(error?:Error)=>{if(settled)return;settled=true;bounded.removeEventListener('abort',abort);error?reject(error):accept();};
   bounded.addEventListener('abort',abort,{once:true});if(bounded.aborted)abort();
   child.once('error',()=>done(new Error('Configured local DOCX renderer could not start.')));
   child.once('close',code=>done(bounded.aborted?bounded.reason:code===0?undefined:new Error(`Local DOCX renderer failed (${code ?? 'terminated'}).`)));
  });
  bounded.throwIfAborted();const file=join(output,'document.pdf'),size=(await stat(file)).size;if(!size||size>25*1024*1024)throw new Error('Native PDF output exceeds 25 MiB.');
  const pdf=await readFile(file);if(pdf.subarray(0,5).toString()!=='%PDF-')throw new Error('Local DOCX renderer returned an invalid PDF.');bounded.throwIfAborted();return pdf;
 }finally{await rm(root,{recursive:true,force:true});}
}
