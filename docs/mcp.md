# MCP integration

Ollamify exposes MCP over the same protected gateway as the REST API. Use the same JWT or API key:

```text
Authorization: Bearer <TOKEN_OR_API_KEY>
```

## Endpoints

- Streamable HTTP: `https://YOUR_DOMAIN/api/mcp`
- Legacy HTTP+SSE: `https://YOUR_DOMAIN/api/mcp/sse`
- Legacy message endpoint: `https://YOUR_DOMAIN/api/mcp/messages`

The Streamable HTTP endpoint is the preferred remote MCP transport. The SSE endpoint is kept for older clients.

## Common remote config

Use this shape for clients that support remote Streamable HTTP MCP servers:

```json
{
  "mcpServers": {
    "ollamify": {
      "url": "https://YOUR_DOMAIN/api/mcp",
      "headers": {
        "Authorization": "Bearer ${OLLAMIFY_API_KEY}"
      }
    }
  }
}
```

Some clients require an explicit transport type:

```json
{
  "mcpServers": {
    "ollamify": {
      "type": "streamable-http",
      "url": "https://YOUR_DOMAIN/api/mcp",
      "headers": {
        "Authorization": "Bearer ${OLLAMIFY_API_KEY}"
      }
    }
  }
}
```

## Legacy SSE config

```json
{
  "mcpServers": {
    "ollamify": {
      "type": "sse",
      "url": "https://YOUR_DOMAIN/api/mcp/sse",
      "headers": {
        "Authorization": "Bearer ${OLLAMIFY_API_KEY}"
      }
    }
  }
}
```

## Stdio-only clients

For clients that only support stdio MCP, run a local bridge such as `mcp-remote`:

```json
{
  "mcpServers": {
    "ollamify": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://YOUR_DOMAIN/api/mcp",
        "--header",
        "Authorization: Bearer ${OLLAMIFY_API_KEY}"
      ]
    }
  }
}
```

## Tools

- `ollamify_list_projects`: lists projects with descriptions and embedding models. Optional `includeStats`.
- `ollamify_search_documents`: searches indexed document chunks by `vector`, `keyword`, or `hybrid` mode. Supports `project`, `limit`, `useReranker`, `includeAdjacentChunks`, `minScore`, and explicit `keywords`.
- `ollamify_get_document`: returns document metadata and first available content chunk.
- `ollamify_get_document_chunks`: reads a range of indexed chunks by `documentId` and `startChunkIndex`.

All document search tools use the same retrieval service as `/api/ai/rag/chunks`.
