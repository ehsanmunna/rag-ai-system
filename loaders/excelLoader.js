const XLSX = require('xlsx');
const { BufferLoader } = require('langchain/document_loaders/fs/buffer');
const { Document } = require('langchain/document');

/**
 * LangChain document loader for Excel workbooks (LangChain has no built-in one).
 * Built the same way as LangChain's PDFLoader: extend BufferLoader, which reads
 * the file, and implement parse() to turn the buffer into one Document per sheet.
 *
 * Strategy (per sheet):
 *   1. Use row 1 as headers.
 *   2. For each data row, emit a "Header: value" line so the
 *      embedding sees the column name attached to each value.
 *      (This dramatically improves retrieval quality.)
 *   3. Rows are grouped in blocks so each block stays coherent.
 */
class ExcelLoader extends BufferLoader {
  async parse(raw, metadata) {
    const workbook = XLSX.read(raw, { type: 'buffer' });
    const documents = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      // Convert to array of arrays (raw values)
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,      // convert dates/numbers to display strings
        defval: '',      // empty cells → ''
        blankrows: false,
      });

      if (rows.length === 0) continue;

      const headers = rows[0].map((h, i) => String(h || `col_${i}`).trim());
      const dataRows = rows.slice(1);

      // Emit each row as "Header: value | Header: value | ..."
      const rendered = dataRows.map((row, idx) => {
        const pairs = headers
          .map((h, i) => {
            const v = row[i];
            if (v === undefined || v === null || v === '') return null;
            return `${h}: ${String(v).trim()}`;
          })
          .filter(Boolean);
        return `Row ${idx + 1} — ${pairs.join(' | ')}`;
      });

      documents.push(
        new Document({
          pageContent: `# Sheet: ${sheetName}\n${dataRows.length ? rendered.join('\n') : '(empty)'}`,
          metadata: {
            ...metadata,
            sheet: sheetName,
            rows: dataRows.length,
            columns: headers.length,
            sheetCount: workbook.SheetNames.length,
          },
        })
      );
    }

    return documents;
  }
}

/**
 * Load an Excel workbook and return { text, metadata }.
 */
async function loadExcel(filePath) {
  const docs = await new ExcelLoader(filePath).load();

  const text = docs.map((doc) => doc.pageContent).join('\n\n---\n\n');

  return {
    text,
    metadata: {
      type: 'excel',
      sheets: docs
        .filter((doc) => doc.metadata.rows > 0)
        .map(({ metadata: { sheet, rows, columns } }) => ({ sheet, rows, columns })),
      sheetCount: docs[0]?.metadata.sheetCount ?? 0,
    },
  };
}

module.exports = { loadExcel, ExcelLoader };
