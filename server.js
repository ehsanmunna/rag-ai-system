const path = require("path");
const express = require("express");
const { getLoader, LOADERS } = require('./loaders');
require("dotenv").config();
const {
  checkDatabase,
  listKnowledgeFiles,
  generateAndStoreEmbeddings,
  handleQuery,
} = require("./service");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3035;
// Body (optional): { "file": "FAQ.xlsx" } to embed one file; otherwise every
// supported file in knowledge/ is embedded.
app.post("/embed", async (req, res) => {
  try {
    const { file } = req.body || {};
    let files;
    if (file) {
      // basename() keeps requests inside knowledge/
      const filePath = path.join(KNOWLEDGE_DIR, path.basename(file));
      if (!getLoader(filePath)) {
        return res.status(400).json({
          message: `Unsupported file type. Supported: ${Object.keys(LOADERS).join(", ")}`,
        });
      }
      files = [filePath];
    } else {
      files = await listKnowledgeFiles();
    }

    const results = [];
    for (const filePath of files) {
      const source = path.basename(filePath);
      try {
        const chunks = await generateAndStoreEmbeddings(filePath);
        results.push({ file: source, chunks });
      } catch (error) {
        console.log(`Failed to embed ${source}:`, error?.message);
        results.push({ file: source, error: error?.message });
      }
    }

    const failed = results.filter((r) => r.error).length;
    const status = failed === 0 ? 200 : failed === results.length ? 500 : 207;
    res.status(status).json({
      message: failed === 0 ? "Successfully Embedded" : `${failed} of ${results.length} file(s) failed`,
      results,
    });
  } catch (error) {
    console.log(error?.message);
    res.status(500).json({
      message: "Error occurred",
    });
  }
});

app.post("/query", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ message: "query is required" });
    }
    const result = await handleQuery(query);
    res.status(200).json(result);
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: "Error occurred",
    });
  }
});

checkDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`App is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to set up database:", error);
    process.exit(1);
  });
