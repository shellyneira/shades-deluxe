// Minimal, dependency-free PDF: renders text lines onto one Letter page. Enough to
// attach a real .pdf to a WhatsApp/email share without shipping a PDF library.
export function textToPdfBlob(lines) {
  const clean = (s) => String(s)
    .replace(/×/g, 'x').replace(/[–—]/g, '-').replace(/·/g, '-')
    // drop anything outside basic latin so byte length == char length (accurate xref)
    .replace(/[^\x20-\x7E]/g, '');
  const esc = (s) => clean(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const wrapped = [];
  for (const ln of lines) {
    let t = clean(ln);
    if (t === '') { wrapped.push(''); continue; }
    while (t.length > 95) {
      let cut = t.lastIndexOf(' ', 95);
      if (cut < 40) cut = 95;
      wrapped.push(t.slice(0, cut));
      t = t.slice(cut).trimStart();
    }
    wrapped.push(t);
  }

  const content = 'BT /F1 11 Tf 50 760 Td 15 TL\n' +
    wrapped.map((l, i) => (i ? 'T* ' : '') + '(' + esc(l) + ') Tj').join('\n') + '\nET';

  const objs = [];
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
  objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>';
  objs[4] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  objs[5] = '<</Length ' + content.length + '>>\nstream\n' + content + '\nendstream';

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = pdf.length; pdf += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
  const xref = pdf.length;
  pdf += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
  for (let i = 1; i < objs.length; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<</Size ' + objs.length + '/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF';
  return new Blob([pdf], { type: 'application/pdf' });
}
