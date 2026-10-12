/**
 * A real, renderable PDF of `pages` pages — each a white A5 sheet with a black
 * block in its upper half and a line of text — for the sample-page tests.
 *
 * ★ The block is what a test asserts on: a renderer that produces blank pages
 * (no fonts, a broken converter) passes every "a file came out" check
 * (CLAUDE.md §4.3), but it cannot draw black where the page says black.
 */
export function makePdf(pages: number): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pages }, (_, i) => 4 + i * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageIds.forEach((id, i) => {
    const content = `0 0 0 rg 60 300 300 200 re f BT /F1 24 Tf 60 200 Td (Page ${i + 1}) Tj ET`;
    objects[id] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] " +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(body);
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
