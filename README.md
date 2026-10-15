# isadi-automation

A RAG (Retrieval-Augmented Generation) application that extracts text from knowledge files (PDF, Excel), creates embeddings using OpenAI, and stores them in PostgreSQL for semantic search.

## Prerequisites

### Knowledge Preparation
- Place your knowledge files in the `knowledge/` directory
- Supported file types: `.pdf`, `.xlsx`, `.xls`
- The application currently includes `FAQ.xlsx` and `Return_Policy.pdf` as examples

### API Keys Required
You must prepare the following API keys before running the application:

1. **OpenAI API Key** - Required for embeddings and chat completions
   - Set `OPENAI_API_KEY` in your `.env` file
   - Get one from: https://platform.openai.com/account/api-keys

2. **OpenRouter API Key** (optional, used via `OPENAI_API_KEY` env var)
   - The app routes through OpenRouter at `https://openrouter.ai/api/v1`
   - Get one from: https://openrouter.ai/keys

3. **PostgreSQL Database**
   - Default connection: `postgres://postgres:postgres@localhost:5432/ragdb`
   - Modify `DATABASE_URL` in `.env` if using a different PostgreSQL instance

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd isadi-automation
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your:
   - `OPENAI_API_KEY=sk-your-key-here`
   - `DATABASE_URL=your-postgres-connection-string` (optional, use default if local PostgreSQL is running)

4. **Add knowledge files**
   Place `.pdf` or `.xlsx` files in the `knowledge/` directory.

5. **Start the server**
   ```bash
   npm start
   ```

   The server will run on port `3035` (or `process.env.PORT`).

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/embed` | `POST` | Embed knowledge files. Body optional: `{ "file": "FAQ.xlsx" }` to embed a specific file; otherwise all supported files in `knowledge/` are embedded. |
| `/query` | `POST` | Ask a question. Body: `{ "query": "your question here" }` |

## Development

- `npm run start` - Start the server
- Knowledge loaders are in `loaders/` (supports `.pdf`, `.xlsx`, `.xls`)
- Embeddings use `text-embedding-3-small` model
- Chat model defaults to `gpt-4o-mini` (configure via `OPENAI_CHAT_MODEL`)

## File Structure

```
knowledge/          # Place your knowledge files here
loaders/            # File type handlers (pdfLoader.js, excelLoader.js)
service.js          # Core RAG logic (embeddings, querying, database)
server.js           # Express API server
.env.example        # Example environment variables
```

## Troubleshooting

- If embedding fails, check that `OPENAI_API_KEY` is valid and has sufficient quota
- Ensure PostgreSQL is running and accessible
- Supported file types: `.pdf` and `.xlsx`/.`.xls`
- View logs with `console output` for embedding/chat errors