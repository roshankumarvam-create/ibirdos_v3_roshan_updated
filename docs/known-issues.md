# Known Issues

## Invoice OCR: "400 Missing required parameter: messages[1].content[1].image_url.url"

**Status:** Deferred. OCR hidden behind `NEXT_PUBLIC_ENABLE_OCR=false` feature flag.

**Symptom:** Uploading an invoice image triggers an OpenAI Vision API call that returns HTTP 400:
```
400 Missing required parameter: 'messages[1].content[1].image_url.url'
```

**Affected file:** `packages/ai/src/invoice-extraction.ts`

**What was tried:**
1. Verified message structure matches OpenAI spec (system + user with text + image_url parts).
2. Data URL format checked: `data:image/jpeg;base64,...` — appears correct.
3. Multiple fix attempts over 2+ hours: message re-ordering, content array restructuring, base64 encoding checks.

**Current hypothesis:**
- OpenAI SDK version mismatch: the SDK may be stripping or mutating the `image_url.url` field before sending.
- Or: `response_format: { type: "json_object" }` + Vision is not supported on the selected model.

**Next debug steps:**
1. Dump the exact JSON wire payload using `client.request()` or a debug proxy (e.g., `mitmproxy`).
2. Try `client.chat.completions.create(...).withResponse()` to inspect the raw request body.
3. Check if `OPENAI_VISION_MODEL` env var is set to a model that actually supports Vision (must be `gpt-4o`, `gpt-4o-mini`, or `gpt-4-turbo`).
4. Try sending the request without `response_format` to rule out that as a conflict.
5. Pin `openai` SDK to a known-good version (e.g., `4.28.0`) and test.

**Workaround:** Upload invoice → add line items manually from the invoice detail page. The file is stored in R2/MinIO for reference.
