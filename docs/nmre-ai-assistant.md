# NMRE Intelligence

NMRE Intelligence is an authenticated assistant embedded in the private app.

## Architecture

- Frontend invokes the `nmre-ai-assistant` Supabase Edge Function using the signed-in Supabase session.
- The Edge Function validates the caller with Supabase Auth and reads CRM records using the caller's JWT, so existing row-level security remains in force.
- The function is restricted to the existing `NMRE_ALLOWED_USER_ID` project secret and applies a per-instance request limit.
- The function sends a limited operational context to the OpenAI Responses API using the server-side `OPENAI_API_KEY` secret.
- The OpenAI key is never sent to the browser or committed to Git.
- Conversation history is held in the current page session; the OpenAI request uses `store: false`.

## Enable the model

1. Create an API key in the OpenAI API platform and ensure API billing/access is enabled.
2. In Supabase Dashboard, open Project Settings → Edge Functions → Secrets (or the Edge Function Secrets page).
3. Add the secret `OPENAI_API_KEY` with the API key as its value.
4. Save. Supabase Edge Functions read project secrets from their runtime environment; no redeploy is needed after setting a secret.
5. Sign in to the NMRE app, open **Assistente AI**, and send a test prompt.

Do not paste the key into the app, GitHub, chat, or any browser field.

## Data minimization

The function retrieves only records owned by the authenticated user from:
- `annunci` and `annunci_interazioni`
- `nmre_contacts` and `nmre_contact_interactions`
- `nmre_properties`
- `nmre_appointments`

Phone numbers, email addresses, and private street-address fields are not selected. Free-text fields are truncated and common phone, email, and Italian street-address patterns are redacted before the request. The UI discloses that selected operational data and the prompt are sent to OpenAI to generate the response. Review notes before entering sensitive details in the CRM.

## Safety boundaries

The assistant is read-only. It cannot create, update, delete, contact a seller, or book an appointment. It must distinguish recorded facts from suggestions and must not invent CRM data. Any future write action must be implemented as a separate authenticated, explicitly confirmed workflow.
