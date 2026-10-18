// Runs in a short-lived heap-limited child process, never in the HTTP server.
const chunks: Buffer[] = [];
let size = 0;
process.stdin.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8 * 1024 * 1024) process.exit(2); chunks.push(chunk); });
process.stdin.on('end', async () => {
  try {
    const buffer = Buffer.concat(chunks); const extension = process.argv[2]; let text = '';
    if (['.txt', '.md', '.csv'].includes(extension)) text = buffer.toString('utf8');
    else if (extension === '.pdf' && buffer.subarray(0, 5).toString() === '%PDF-') {
      const { PDFParse } = require('pdf-parse'); const parser = new PDFParse({ data: buffer, isEvalSupported: false });
      try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
    } else if (extension === '.docx' && buffer.subarray(0, 2).toString() === 'PK') {
      text = (await require('mammoth').extractRawText({ buffer })).value;
    } else process.exit(2);
    process.stdout.write(JSON.stringify({ text: text.slice(0, 60000), truncated: text.length > 60000 }));
  } catch { process.exitCode = 2; }
});
export {};
