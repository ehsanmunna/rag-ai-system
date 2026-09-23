const path = require("path");
const { randomUUID } = require("crypto");
const express = require("express");
const OpenAI = require("openai");
const { Pool } = require("pg");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { PDFLoader } = require("langchain/document_loaders/fs/pdf");
require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3035;
const PDF_PATH = path.join(__dirname, "../isadi-automation", "knowledge", "Return_Policy.pdf");
const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims, matches document_chunks.embedding
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENAI_API_KEY 
  });
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/ragdb",
});

// pgvector accepts vectors as text in the form "[0.1,0.2,...]"
const toVector = (embedding) => `[${embedding.join(",")}]`;

// Fail fast if the expected schema (documents + document_chunks) is missing
async function checkDatabase() {
  await pool.query("SELECT 1 FROM documents, document_chunks LIMIT 1");
}

app.post("/embed", async (req, res) => {
  try {
    const count = await generateAndStoreEmbeddings();
    res.status(200).json({ message: "Successfully Embedded", chunks: count });
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

async function generateAndStoreEmbeddings() {
  const loader = new PDFLoader(PDF_PATH);
  const docs = await loader.load();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chunks = await textSplitter.splitDocuments(docs);
  const cleanChunks = chunks.map((chunk) =>
    chunk.pageContent.replace(/\n/g, " ")
  );

  // One request for all chunks instead of one per chunk
  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: cleanChunks,
  });

  const source = path.basename(PDF_PATH);
  const documentId = randomUUID();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Replace any previous import of this file; its chunks are removed by ON DELETE CASCADE
    await client.query("DELETE FROM documents WHERE source = $1", [source]);
    await client.query(
      "INSERT INTO documents (id, title, source, file_type) VALUES ($1, $2, $3, $4)",
      [documentId, path.parse(source).name, source, "pdf"]
    );
    for (const { index, embedding } of embeddingResponse.data) {
      await client.query(
        `INSERT INTO document_chunks (id, document_id, content, chunk_index, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          documentId,
          cleanChunks[index],
          index,
          { page: chunks[index].metadata.loc?.pageNumber },
          toVector(embedding),
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return cleanChunks.length;
}

async function handleQuery(query) {
  const input = query.replace(/\n/g, " ");

  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });

  const [{ embedding }] = embeddingResponse.data;

  // <=> is cosine distance, so 1 - distance is cosine similarity
  const { rows: documents } = await pool.query(
    `SELECT content, 1 - (embedding <=> $1) AS similarity
     FROM document_chunks
     WHERE 1 - (embedding <=> $1) > $2
     ORDER BY embedding <=> $1
     LIMIT $3`,
    [toVector(embedding), 0.3, 10]
  );

  const contextText = documents
    .map((document) => `${document.content.trim()}---\n`)
    .join("");

  const messages = [
    {
      role: "system",
      content: `You are a helpful customer support representative. Answer only from the provided context sections.
    If the answer is not in the context, say you don't know. Only ever answer truthfully and be as helpful as you can!`,
    },
    {
      role: "user",
      content: `Context sections: "${contextText}" Question: "${query}" Answer as simple text:`,
    },
  ];

  const completion = await openai.chat.completions.create({
    messages,
    model: CHAT_MODEL,
    temperature: 0.2,
  });

  return completion.choices[0].message.content;
}

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
