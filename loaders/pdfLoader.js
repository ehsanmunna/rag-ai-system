const { PDFLoader } = require('langchain/document_loaders/fs/pdf');

/**
 * Load a PDF and return { text, metadata }.
 *
 * Strategy:
 *   1. Load one document per page (LangChain PDFLoader, backed by pdf-parse 1.x).
 *   2. Prefix each page with a "# Page N" header so chunks keep
 *      a hint of where they came from.
 *   3. Pages are joined with a separator, same as sheets in excelLoader.
 */
async function loadPdf(filePath) {
  const loader = new PDFLoader(filePath, { splitPages: true });
  const pages = await loader.load();

  const parts = pages
    .map((page, idx) => {
      const pageNumber = page.metadata.loc?.pageNumber ?? idx + 1;
      const content = page.pageContent.trim();
      if (!content) return null;
      return `# Page ${pageNumber}\n${content}`;
    })
    .filter(Boolean);

  const text = parts.join('\n\n---\n\n');

  return {
    text,
    metadata: {
      type: 'pdf',
      pageCount: pages.length,
      title: pages[0]?.metadata.pdf?.info?.Title || null,
    },
  };
}

module.exports = { loadPdf };
