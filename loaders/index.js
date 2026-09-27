const path = require('path');
const { loadExcel } = require('./excelLoader');
const { loadPdf } = require('./pdfLoader');


const LOADERS = {
  '.xlsx': loadExcel,
  '.xls': loadExcel,     // legacy Excel
  '.pdf': loadPdf,
};

function getLoader(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return LOADERS[ext] || null;
}

module.exports = { getLoader, LOADERS };