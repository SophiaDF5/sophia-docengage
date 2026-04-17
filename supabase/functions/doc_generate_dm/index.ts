import { corsHeaders } from "../_shared/cors.ts";
import { requireAuth, createUserClient } from "../_shared/auth.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { safeError } from "../_shared/error-handler.ts";
import { validateBody, z } from "../_shared/validate.ts";
import { callOpenAI } from "../_shared/openai.ts";

const GenerateDmSchema = z.object({
  org_id: z.string().uuid(),
  conversation_context: z.string().min(1).max(5000),
  last_reply: z.string().min(1).max(3000),
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Auth + rate limit
    const [user, authError] = await requireAuth(req);
    if (authError) return authError;

    const [, rateLimitError] = await rateLimit(user.id, "expensive");
    if (rateLimitError) return rateLimitError;

    // 2. Validate
    const [body, validationError] = await validateBody(req, GenerateDmSchema);
    if (validationError) return validationError;

    // 3. Fetch org settings
    const supabase = createUserClient(req);
    const { data: org, error: orgError } = await supabase
      .from("doc_organizations")
      .select("ai_system_prompt")
      .eq("id", body.org_id)
      .single();

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const basePrompt = org.ai_system_prompt ||
      "You are a professional CEO. Write warm, professional direct messages that build genuine relationships with healthcare professionals.";

    const systemPrompt = `${basePrompt}\n\nYou are drafting a direct message reply. Match the tone and formality of the ongoing conversation. Keep your reply concise and natural — avoid sounding scripted.`;

    const userPrompt = `Here is the conversation so far:\n\n${body.conversation_context}\n\nTheir last message:\n"${body.last_reply}"\n\nDraft a reply:`;

    // 4. Generate reply
    const generatedContent = await callOpenAI(systemPrompt, userPrompt);

    if (!generatedContent) {
      return new Response(
        JSON.stringify({ error: "AI draft unavailable - please try again" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Save to doc_dm_drafts
    const { data: draft, error: draftError } = await supabase
      .from("doc_dm_drafts")
      .insert({
        org_id: body.org_id,
        conversation_context: body.conversation_context,
        last_reply: body.last_reply,
        generated_content: generatedContent,
      })
      .select("id")
      .single();

    if (draftError) {
      console.error("Failed to save DM draft:", draftError);
    }

    return new Response(
      JSON.stringify({
        data: {
          id: draft?.id ?? null,
          generated_content: generatedContent,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return safeError(err);
  }
});
