import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { parseReference } from '../src/references.ts';
import { readSourceArchive } from '../src/web-import.ts';

async function archive(compression: 'DEFLATE' | 'STORE', flags: number) {
  const zip = new JSZip(); zip.file('[Content_Types].xml', '<Types/>'); zip.file('word/document.xml', '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Word 原生另存</w:t></w:r></w:p></w:body></w:document>', { createFolders: false });
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression });
  for (let offset = 0; offset < bytes.length - 30; offset++) {
    const signature = bytes.readUInt32LE(offset);
    if (signature === 0x02014b50) bytes.writeUInt16LE(bytes.readUInt16LE(offset + 8) | flags, offset + 8);
    if (signature === 0x04034b50) bytes.writeUInt16LE(bytes.readUInt16LE(offset + 6) | flags, offset + 6);
  }
  return bytes;
}
test('Office DEFLATE option bits 1/2 are accepted with intact paths, lengths and CRC', async () => {
  for (const flags of [0, 2, 4, 6]) assert.match((await parseReference(await archive('DEFLATE', flags), 'saved.docx')).text, /Word 原生另存/);
});
test('DEFLATE hints never permit encrypted/strong-encrypted data, STORE misuse or damaged local headers', async () => {
  for (const [compression, flags] of [['DEFLATE', 1], ['DEFLATE', 64], ['DEFLATE', 0x2000], ['STORE', 2], ['STORE', 6]] as const) {
    const bytes = await archive(compression, flags);
    assert.throws(() => readSourceArchive(bytes), /encryption or unsupported compression/);
  }
  const mismatch = await archive('DEFLATE', 6); mismatch.writeUInt16LE(0, 6);
  assert.throws(() => readSourceArchive(mismatch), /local ZIP header/);
});

test('PowerPoint font/language runs retain paragraph text while actual line breaks stay explicit', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="r1"/></p:sldIdLst></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>');
  zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>PowerPoint </a:t></a:r><a:r><a:t>本机另存验证。</a:t></a:r><a:br/><a:r><a:t>下一行</a:t></a:r></a:p></p:sld>');
  const result = await parseReference(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), 'saved.pptx');
  assert.equal(result.text, 'Slide 1\nPowerPoint 本机另存验证。\n下一行');
});
