# Veo API Limitation: OAuth2 Required for Polling

## Issue

Google Veo's video generation API **does not fully support API key authentication**:

- ✅ **Generation submission works** with API keys (`ai.models.generateVideos()`)
- ❌ **Operation polling fails** with API keys (`ai.operations.getVideosOperation()`)

Error:
```
API keys are not supported by this API. Expected OAuth2 access token or other
authentication credentials that assert a principal.
Reason: CREDENTIALS_MISSING
Method: google.longrunning.Operations.GetOperation
```

## Technical Details

- The Veo API uses Google's long-running operations framework
- The `generativelanguage.googleapis.com` Operations service requires **OAuth2 or service account credentials**
- API keys cannot authenticate "principal-based" operations like `GetOperation`

## Workarounds

### 1. Use OAuth2 (Complex)
- Create Google Cloud project
- Enable Generative Language API
- Create OAuth2 credentials or service account JSON
- Implement token refresh logic
- Update SDK to use OAuth2 flow

### 2. Use Vertex AI (Enterprise)
- Vertex AI Veo endpoint supports service account auth properly
- Requires Google Cloud project setup
- More expensive, but production-ready

### 3. Stick with OpenAI Sora (Current)
- Works with simple API key authentication
- No OAuth complexity
- Production-ready

## Test Script

Run `./node_modules/.bin/tsx scripts/test-veo.ts` to reproduce the issue.

## Recommendation

**Use Sora for now** until Google fixes API key support or we implement OAuth2.

## References

- [Veo API Authentication](https://docs.litellm.ai/docs/proxy/veo_video_generation)
- [Google OAuth2 Guide](https://developers.google.com/identity/protocols/oauth2)
- [Vertex AI Veo](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation)
