const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const OpenAI = require("openai");
const { Pool } = require("pg");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { getLoader } = require("./loaders");

const KNOWLEDGE_DIR = path.join(__dirname, "knowledge");
const EMBEDDING_MODEL = "text-embedding-3-small";

const openai = new OpenAI({
  baseURL: process.env.OPENAI_AI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
});
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/ragdb",
});

const toVector = (embedding) => `[${embedding.join(",")}]`;

async function checkDatabase() {
  await pool.query("SELECT 1 FROM documents, document_chunks LIMIT 1");
}

async function listKnowledgeFiles() {
  const names = await fs.readdir(KNOWLEDGE_DIR);
  return names
    .filter((name) => !name.startsWith("~$") && getLoader(name))
    .map((name) => path.join(KNOWLEDGE_DIR, name));
}

async function generateAndStoreEmbeddings(filePath) {
  const load = getLoader(filePath);
  if (!load) {
    throw new Error(`No loader for file type: ${path.extname(filePath)}`);
  }
  const { text, metadata } = await load(filePath);
  if (!text.trim()) {
    throw new Error("No text could be extracted");
  }

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chunks = await textSplitter.createDocuments([text]);
  const cleanChunks = chunks.map((chunk) =>
    chunk.pageContent.replace(/\n/g, " ")
  );

  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: cleanChunks,
  });

  const source = path.basename(filePath);
  const documentId = randomUUID();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM documents WHERE source = $1", [source]);
    await client.query(
      "INSERT INTO documents (id, title, source, file_type) VALUES ($1, $2, $3, $4)",
      [documentId, path.parse(source).name, source, metadata.type]
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
          { ...metadata, lines: chunks[index].metadata.loc?.lines },
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

  const { rows: documents } = await pool.query(
    `SELECT c.content, d.source, 1 - (c.embedding <=> $1) AS similarity
     FROM document_chunks c
     JOIN documents d ON d.id = c.document_id
     WHERE 1 - (c.embedding <=> $1) > $2
     ORDER BY c.embedding <=> $1
     LIMIT $3`,
    [toVector(embedding), 0.3, 10]
  );

  const contextText = documents
    .map((document) => `[Source: ${document.source}]\n${document.content.trim()}---\n`)
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
    model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    temperature: 0.2,
  });

  return completion.choices[0].message.content;
}

module.exports = {
  checkDatabase,
  listKnowledgeFiles,
  generateAndStoreEmbeddings,
  handleQuery,
};