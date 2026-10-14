import type { ProjectRuntime } from '../../src/project-runtime.ts';

/** Synthetic content only; intentionally overflows a phone until the agent repairs it. */
export function createVisionWeb(runtime: Pick<ProjectRuntime, 'createDocument' | 'submit' | 'makeCommand' | 'readWebDocument'>) {
  const document = runtime.createDocument({ kind: 'web', name: 'Synthetic responsive vision check' });
  runtime.submit(runtime.makeCommand(document.documentId, [
    { type: 'source.update', module: { id: 'hero-source', path: 'Hero.tsx', language: 'tsx', exports: ['default'], source: `
export default function Hero() {
  return <section style={{width:960,padding:32,background:'#14532d',color:'#ffffff',borderRadius:16}}>
    <h1 style={{fontSize:48,whiteSpace:'nowrap',margin:'0 0 24px'}}>Design that works everywhere</h1>
    <p style={{fontSize:20}}>Create, refine, and share your ideas.</p>
    <button style={{marginLeft:700,fontSize:20,padding:'16px 24px',background:'#ffffff',color:'#14532d',border:0,borderRadius:8}}>Start designing</button>
  </section>;
}` } },
    { type: 'web.style.update', nodeId: document.pages[0]!.rootId, style: { padding: 24, fontFamily: 'Arial, sans-serif' } },
    { type: 'web.node.insert', node: { id: 'hero', parentId: document.pages[0]!.rootId, tag: 'div', children: [], style: {}, layout: { mode: 'flow' }, component: { moduleId: 'hero-source', exportName: 'default' } } },
  ]));
  return runtime.readWebDocument(document.documentId);
}
