'use strict';

/* A .pptx, written by hand: a picture per slide and the script under it.
 *
 * The format is a zip of XML parts, named in a manifest and joined by
 * relationship files, and the subset a deck of pictures needs is small
 * enough to write out here rather than take a package for: one master,
 * one blank layout, a theme, a notes master, and then per slide a part,
 * its picture and a notes part carrying the script. The zip is the
 * store-or-deflate format of 1989, which Node's zlib deflates and a few
 * lines of bookkeeping frame.
 *
 * PowerPoint reads the manifest first and is strict about it: every
 * part is either a default by extension or an override by name, and a
 * part it was not told about is a file it offers to repair. Everything
 * written below is listed there, and every relationship id a part uses
 * is declared in that part's own .rels.
 *
 * Sizes are EMUs, 914400 to the inch, so a CSS pixel at 96 to the inch
 * is 9525 of them. A 1280x720 stage comes out at 13.333 by 7.5 inches,
 * which is the 16:9 PowerPoint itself opens with.
 */

const zlib = require('zlib');

const EMU = 9525;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]);

// ------------------------------------------------------------------ zip

/* zlib grew a crc32 in 22.2; the engine floor is 22.0. */
const TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
const checksum = typeof zlib.crc32 === 'function' ? (b) => zlib.crc32(b) : crc32;

/** A zip of `[{ name, data, store }]`, in that order. Text is deflated;
 *  a PNG is already compressed and is stored as it is. */
function zip(entries) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const method = e.store ? 0 : 8;
    const body = e.store ? raw : zlib.deflateRawSync(raw, { level: 9 });
    const crc = checksum(raw);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);              // version needed: 2.0, deflate
    head.writeUInt16LE(0, 6);               // flags
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);              // no extra field
    locals.push(head, name, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);               // made by
    cen.writeUInt16LE(20, 6);               // needed
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30);               // extra
    cen.writeUInt16LE(0, 32);               // comment
    cen.writeUInt16LE(0, 34);               // disk
    cen.writeUInt16LE(0, 36);               // internal attributes
    cen.writeUInt32LE(0, 38);               // external attributes
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += head.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

// ---------------------------------------------------------------- parts

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
};
const DECL = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const CT = 'application/vnd.openxmlformats-officedocument.presentationml.';

const rels = (list) => XML +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('') +
  '</Relationships>';

/* Every shape tree opens with the same empty group. */
const TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/>' +
  '<a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" ' +
  'accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" ' +
  'accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

/* A theme is required by the schema and used by nothing on a slide that
   is one picture, so this is the least PowerPoint accepts: a colour
   scheme, a font scheme and the three-of-each format scheme. */
function theme(name) {
  const clr = (tag, v) => `<a:${tag}><a:srgbClr val="${v}"/></a:${tag}>`;
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = '<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>';
  const effect = '<a:effectStyle><a:effectLst/></a:effectStyle>';
  return XML + `<a:theme xmlns:a="${NS.a}" name="${esc(name)}"><a:themeElements>` +
    `<a:clrScheme name="${esc(name)}">` +
    clr('dk1', '000000') + clr('lt1', 'FFFFFF') + clr('dk2', '1F2937') + clr('lt2', 'F3F4F6') +
    clr('accent1', '0D9488') + clr('accent2', '14B8A6') + clr('accent3', '64748B') +
    clr('accent4', '94A3B8') + clr('accent5', '334155') + clr('accent6', '0F172A') +
    clr('hlink', '0D9488') + clr('folHlink', '64748B') +
    '</a:clrScheme>' +
    `<a:fontScheme name="${esc(name)}">` +
    '<a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
    '</a:fontScheme>' +
    `<a:fmtScheme name="${esc(name)}">` +
    `<a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst>` +
    `<a:lnStyleLst>${line}${line}${line}</a:lnStyleLst>` +
    `<a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst>` +
    '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
}

const MASTER = XML + `<p:sldMaster ${DECL}><p:cSld>` +
  '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
  `<p:spTree>${TREE}</p:spTree></p:cSld>${CLRMAP}` +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
  '<p:txStyles><p:titleStyle><a:lvl1pPr/></p:titleStyle><p:bodyStyle><a:lvl1pPr/></p:bodyStyle>' +
  '<p:otherStyle><a:lvl1pPr/></p:otherStyle></p:txStyles></p:sldMaster>';

const LAYOUT = XML + `<p:sldLayout ${DECL} type="blank" preserve="1">` +
  `<p:cSld name="Blank"><p:spTree>${TREE}</p:spTree></p:cSld>` +
  '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

/* The notes page is portrait letter, as PowerPoint's own is: the slide's
   picture in the top half, the script under it. The two placeholders are
   placed here, once, and every notes part inherits them. */
const NOTES_MASTER = XML + `<p:notesMaster ${DECL}><p:cSld>` +
  '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
  `<p:spTree>${TREE}` +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/>' +
  '<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>' +
  '<p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>' +
  '<a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>' +
  '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
  '<p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>' +
  `</p:spTree></p:cSld>${CLRMAP}` +
  '<p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>';

/** One slide: its picture, edge to edge. */
function slidePart(s, cx, cy) {
  return XML + `<p:sld ${DECL}><p:cSld><p:spTree>${TREE}` +
    `<p:pic><p:nvPicPr><p:cNvPr id="2" name="${esc(s.name)}" descr="${esc(s.descr || s.name)}"/>` +
    '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

/** One slide's notes: a paragraph per line of the script, an empty one
 *  for each blank line, so the paragraphs of the ```notes block are the
 *  paragraphs of the notes pane. */
function notesPart(text) {
  const lines = text ? String(text).split('\n') : [''];
  const paras = lines.map((l) => (l
    ? `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r></a:p>`
    : '<a:p><a:endParaRPr lang="en-US"/></a:p>')).join('');
  return XML + `<p:notes ${DECL}><p:cSld><p:spTree>${TREE}` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/>' +
    '<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>' +
    '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>' +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>` +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
}

function presentation(n, cx, cy) {
  const ids = Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${3 + i}"/>`).join('');
  return XML + `<p:presentation ${DECL} saveSubsetFonts="1">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    '<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>' +
    `<p:sldIdLst>${ids}</p:sldIdLst>` +
    `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/>` +
    '<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle>' +
    '</p:presentation>';
}

function contentTypes(n) {
  const over = (part, type) => `<Override PartName="${part}" ContentType="${type}"/>`;
  const each = Array.from({ length: n }, (_, i) => i + 1);
  return XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    over('/ppt/presentation.xml', `${CT}presentation.main+xml`) +
    over('/ppt/slideMasters/slideMaster1.xml', `${CT}slideMaster+xml`) +
    over('/ppt/slideLayouts/slideLayout1.xml', `${CT}slideLayout+xml`) +
    over('/ppt/notesMasters/notesMaster1.xml', `${CT}notesMaster+xml`) +
    over('/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml') +
    over('/ppt/theme/theme2.xml', 'application/vnd.openxmlformats-officedocument.theme+xml') +
    each.map((i) => over(`/ppt/slides/slide${i}.xml`, `${CT}slide+xml`)).join('') +
    each.map((i) => over(`/ppt/notesSlides/notesSlide${i}.xml`, `${CT}notesSlide+xml`)).join('') +
    over('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml') +
    over('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml') +
    '</Types>';
}

function core(title, when) {
  const stamp = when.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return XML + '<cp:coreProperties ' +
    'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${esc(title)}</dc:title><dc:creator>sipario</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
    '</cp:coreProperties>';
}

const app = (n) => XML + '<Properties ' +
  'xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
  'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
  `<Application>sipario</Application><Slides>${n}</Slides><Notes>${n}</Notes></Properties>`;

// ---------------------------------------------------------------- the deck

/** A .pptx as a Buffer. `slides` is `[{ png, notes, name, descr }]` in
 *  order; `width` and `height` are the stage's, in CSS pixels. */
function pptx({ title, width, height, slides, when = new Date() }) {
  if (!slides || !slides.length) throw new Error('a .pptx needs at least one slide');
  const cx = Math.round(width * EMU);
  const cy = Math.round(height * EMU);
  const n = slides.length;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes(n) },
    { name: '_rels/.rels', data: rels([
      ['rId1', `${REL}officeDocument`, 'ppt/presentation.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
      ['rId3', `${REL}extended-properties`, 'docProps/app.xml'],
    ]) },
    { name: 'docProps/core.xml', data: core(title || 'Untitled', when) },
    { name: 'docProps/app.xml', data: app(n) },
    { name: 'ppt/presentation.xml', data: presentation(n, cx, cy) },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels([
      ['rId1', `${REL}slideMaster`, 'slideMasters/slideMaster1.xml'],
      ['rId2', `${REL}notesMaster`, 'notesMasters/notesMaster1.xml'],
      ...slides.map((_, i) => [`rId${3 + i}`, `${REL}slide`, `slides/slide${i + 1}.xml`]),
      [`rId${3 + n}`, `${REL}theme`, 'theme/theme1.xml'],
    ]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([
      ['rId1', `${REL}slideLayout`, '../slideLayouts/slideLayout1.xml'],
      ['rId2', `${REL}theme`, '../theme/theme1.xml'],
    ]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([
      ['rId1', `${REL}slideMaster`, '../slideMasters/slideMaster1.xml'],
    ]) },
    { name: 'ppt/notesMasters/notesMaster1.xml', data: NOTES_MASTER },
    { name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels', data: rels([
      ['rId1', `${REL}theme`, '../theme/theme2.xml'],
    ]) },
    { name: 'ppt/theme/theme1.xml', data: theme('sipario') },
    { name: 'ppt/theme/theme2.xml', data: theme('sipario notes') },
  ];

  slides.forEach((s, i) => {
    const k = i + 1;
    entries.push(
      { name: `ppt/slides/slide${k}.xml`, data: slidePart(s, cx, cy) },
      { name: `ppt/slides/_rels/slide${k}.xml.rels`, data: rels([
        ['rId1', `${REL}slideLayout`, '../slideLayouts/slideLayout1.xml'],
        ['rId2', `${REL}image`, `../media/image${k}.png`],
        ['rId3', `${REL}notesSlide`, `../notesSlides/notesSlide${k}.xml`],
      ]) },
      { name: `ppt/notesSlides/notesSlide${k}.xml`, data: notesPart(s.notes) },
      { name: `ppt/notesSlides/_rels/notesSlide${k}.xml.rels`, data: rels([
        ['rId1', `${REL}notesMaster`, '../notesMasters/notesMaster1.xml'],
        ['rId2', `${REL}slide`, `../slides/slide${k}.xml`],
      ]) },
      { name: `ppt/media/image${k}.png`, data: s.png, store: true },
    );
  });

  return zip(entries);
}

module.exports = { pptx, zip, EMU };
