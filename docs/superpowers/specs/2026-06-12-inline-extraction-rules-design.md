# Inline extraction rules design

## Context

Ollamify is a universal open source RAG tool. It must not contain project-specific
knowledge, entity taxonomies, regex rules, or assumptions about source systems.

Alfred AI Sync is a company-specific synchronization product. It knows how company
sources are structured and which signals should be extracted from them.

The current ingestion flow sends whole documents to Ollamify. Ollamify performs
chunking, embedding, and stores chunk payloads in Qdrant. Because extraction must
run at chunk scope, extraction belongs in Ollamify's ingestion pipeline, but the
rules and semantic keys must come from the caller.

## Decision

Add support for caller-provided inline extraction rules to Ollamify document
upload.

The first version supports only regex rules. It does not use NER or LLM extraction
because upload must remain fast and inexpensive.

Ollamify executes the rules mechanically:

1. Accept a document with optional `extraction_rules`.
2. Validate the rules.
3. Split the document into chunks using the existing chunking logic.
4. Apply each rule to each chunk's text.
5. Store extracted values in each chunk payload.

Ollamify does not know what any rule means. A rule key such as `tracker.keys` or
`infra.ip` is an opaque string owned by the caller.

## Non-goals

- No built-in entity types in Ollamify.
- No project-specific profiles stored in Ollamify.
- No NER or LLM extraction during upload.
- No domain-specific regex rules in Ollamify.
- No requirement for Alfred AI Sync to chunk documents.
- No re-embedding of existing documents.

## API shape

Existing upload endpoints remain backward compatible. If `extraction_rules` is
absent, ingestion behaves as it does today.

For JSON requests, `extraction_rules` is an array. For multipart/form-data upload,
`extraction_rules` is passed as a JSON string field, matching the current style of
passing structured metadata.

Example:

```json
{
  "metadata": {
    "source": "tracker",
    "external_id": "..."
  },
  "extraction_rules": [
    {
      "key": "tracker.keys",
      "type": "regex",
      "pattern": "\\bDEV-\\d+\\b",
      "flags": "gi"
    }
  ]
}
```

Rule schema for version 1:

```json
{
  "key": "opaque.caller.owned.key",
  "type": "regex",
  "pattern": "regex source",
  "flags": "optional JavaScript regex flags"
}
```

`type` must be `regex` in version 1. Unknown rule types are rejected.

## Payload shape

Each Qdrant chunk payload keeps the caller's original metadata and adds extracted
values separately:

```json
{
  "metadata": {
    "source": "tracker"
  },
  "extracted_metadata": {
    "tracker.keys": ["DEV-123", "DEV-456"]
  }
}
```

Values are deduplicated per chunk while preserving first-seen order. Rules with no
matches do not create empty keys.

Search and retrieval can later use this block as generic metadata. Ollamify must
treat keys and values as opaque caller data.

## Alfred AI Sync responsibilities

Alfred AI Sync stays responsible for company-specific choices:

- which extraction rules to send;
- which opaque keys to use;
- which source-level metadata to attach;
- how rules vary by source type or project.

Alfred sends whole documents to Ollamify. It does not reproduce Ollamify chunking.

## Existing data

Existing records are enriched without re-uploading documents and without
re-embedding chunks.

The permanent product code is the extraction engine and upload integration. The
backfill runner is a one-time migration utility:

1. Stop Alfred AI Sync so no new records are written during migration.
2. Run a temporary backfill runner against existing Ollamify chunks.
3. The runner reads chunk text from Qdrant, applies the same inline regex rules,
   and patches chunk payloads with `extracted_metadata`.
4. Verify the updated payloads on a small sample.
5. Remove the one-time runner from the working copy after migration.
6. Start Alfred AI Sync again.

The one-time runner is not shipped as a permanent Ollamify feature.

## Deployment order

1. Deploy backward-compatible Ollamify changes first.
2. Stop the deployed Alfred AI Sync service.
3. Deploy Alfred AI Sync changes that send `extraction_rules`.
4. Run the one-time backfill runner.
5. Remove the one-time runner.
6. Start Alfred AI Sync.

This order ensures that future Alfred writes immediately go through the new
chunk-level extraction path, while existing data is updated in place.

## Safety and validation

Ollamify validates extraction rules before chunk processing:

- maximum number of rules per upload;
- maximum regex pattern length;
- allowed regex flags only;
- invalid regex patterns rejected with a clear API error;
- maximum collected matches per rule per chunk;
- extracted value length limits.

Regex execution is intentionally the only supported extraction mechanism in the
first version. If a safe regex engine is practical in the Node.js service, use it.
Otherwise keep the API restricted to trusted ingestion clients and enforce strict
limits to reduce ReDoS risk.

## Testing

Ollamify tests:

- valid regex rule extracts values per chunk;
- missing `extraction_rules` keeps old behavior;
- invalid rule returns a validation error;
- duplicate matches are deduplicated;
- payload contains original `metadata` and separate `extracted_metadata`;
- one-time backfill can update existing chunk payload without changing vectors.

Alfred AI Sync tests:

- upload requests include `extraction_rules`;
- rules can vary by source type;
- existing metadata continues to be sent unchanged.
