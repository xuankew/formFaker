export async function makeTestFile(kind: 'upload-image' | 'upload-file', accept: string): Promise<File> {
  const stamp = Math.floor(Math.random() * 10000);
  if (kind === 'upload-image' || accept.includes('image')) {
    const blob = await makePng();
    return new File([blob], `test-${stamp}.png`, { type: 'image/png' });
  }
  const bytes = makePdf();
  return new File([bytes], `test-${stamp}.pdf`, { type: 'application/pdf' });
}

function makePng(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('canvas unsupported'));
    ctx.fillStyle = `hsl(${Math.floor(Math.random() * 360)}, 60%, 70%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#333';
    ctx.font = '20px sans-serif';
    ctx.fillText('FormFaker', 60, 90);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

function makePdf(): Uint8Array {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    '<</Length 46>>\nstream\nBT /F1 24 Tf 72 720 Td (FormFaker test file) Tj ET\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
