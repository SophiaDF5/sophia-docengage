import { corsHeaders } from "../_shared/cors.ts";
import { safeError } from "../_shared/error-handler.ts";
import { validateBody, z } from "../_shared/validate.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const InboundPostSchema = z.object({
  org_id: z.string().uuid(),
  linkedin_post_url: z.string().url(),
  author_name: z.string().min(1),
  author_headline: z.string().optional(),
  author_linkedin_url: z.string().url().optional(),
  content: z.string().min(1),
  secret_token: z.string().min(1),
});

/**
 * Constant-time string comparison to prevent timing attacks on secret validation.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid leaking length info through timing
    const dummy = new TextEncoder().encode(a);
    const dummyB = new TextEncoder().encode(a);
    let result = 0;
    for (let i = 0; i < dummy.length; i++) {
      result |= dummy[i] ^ dummyB[i];
    }
    return false;
  }
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

/**
 * Calls OpenAI chat completions with exponential backoff on 429s.
 */
async function callOpenAI(
  systemPrompt: string,
  userPrompt: string
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("OPENAI_API_KEY not configured");
    return null;
  }

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
        }),
      });

      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (response.status >= 500) {
        console.error("OpenAI server error:", response.status, await response.text());
        return null;
      }

      if (!response.ok) {
        console.error("OpenAI error:", response.status, await response.text());
        return null;
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content ?? null;
    } catch (err) {
      console.error("OpenAI request failed:", err);
      if (attempt === maxRetries - 1) return null;
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return null;
}

/**
 * Triggers Make.com outbound webhook for auto-approved comments.
 */
async function triggerMakeWebhook(payload: {
  event: string;
  org_id: string;
  post_url: string;
  comment_content: string;
  contact_name: string;
}): Promise<boolean> {
  const secret = Deno.env.get("MAKE_WEBHOOK_SECRET");
  if (!secret) {
    console.error("MAKE_WEBHOOK_SECRET not configured");
    return false;
  }

  try {
    const response = await fetch(`https://hook.us1.make.com/${Deno.env.get("MAKE_WEBHOOK_ID")}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.status >= 500 || !response.ok) {
      console.error("Make.com webhook failed:", response.status, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Make.com webhook error:", err);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Validate input
    const [body, validationError] = await validateBody(req, InboundPostSchema);
    if (validationError) return validationError;

    // 2. Validate secret token (constant-time comparison)
    const expectedSecret = Deno.env.get("MAKE_WEBHOOK_SECRET");
    if (!expectedSecret || !timingSafeEqual(body.secret_token, expectedSecret)) {
      return new Response(
        JSON.stringify({ error: "Invalid secret token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Create service client for webhook-initiated writes
    // (webhooks from Make.com don't carry a user JWT)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 4. Idempotency check — skip if linkedin_post_url already exists for this org
    const { data: existingPost } = await supabase
      .from("doc_posts")
      .select("id")
      .eq("org_id", body.org_id)
      .eq("linkedin_post_url", body.linkedin_post_url)
      .maybeSingle();

    if (existingPost) {
      return new Response(
        JSON.stringify({ data: { id: existingPost.id, status: "already_exists" } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Fetch org settings (auto_post, ai_system_prompt)
    const { data: org, error: orgError } = await supabase
      .from("doc_organizations")
      .select("auto_post_enabled, ai_system_prompt, user_id")
      .eq("id", body.org_id)
      .single();

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Insert the post
    const { data: post, error: postError } = await supabase
      .from("doc_posts")
      .insert({
        user_id: org.user_id,
        org_id: body.org_id,
        linkedin_post_url: body.linkedin_post_url,
        author_name: body.author_name,
        author_headline: body.author_headline ?? null,
        content: body.content,
      })
      .select("id")
      .single();

    if (postError || !post) {
      console.error("Failed to insert post:", postError);
      return safeError(postError);
    }

    // 6b. Upsert contact for the post author (populates CRM pipeline)
    if (body.author_linkedin_url) {
      const { error: contactError } = await supabase
        .from("doc_contacts")
        .upsert(
          {
            user_id: org.user_id,
            org_id: body.org_id,
            linkedin_profile_url: body.author_linkedin_url,
            full_name: body.author_name,
            status: "no_action",
          },
          { onConflict: "org_id,linkedin_profile_url", ignoreDuplicates: true }
        );
      if (contactError) {
        console.error("Failed to upsert contact:", contactError);
        // Non-fatal: continue with post/comment flow
      }
    }

    // 7. Generate AI comment via OpenAI
    const systemPrompt = org.ai_system_prompt ||
      "You are a professional CEO engaging on LinkedIn. Write thoughtful, genuine comments that build relationships with healthcare professionals. Keep comments concise (2-3 sentences), professional, and relevant to the post content.";

    const authorContext = body.author_headline
      ? `${body.author_name} (${body.author_headline})`
      : body.author_name;
    const userPrompt = `Draft a LinkedIn comment for this post by ${authorContext}:\n\n${body.content}`;

    const generatedContent = await callOpenAI(systemPrompt, userPrompt);

    // 8. Determine comment status
    const commentStatus = generatedContent === null
      ? "generation_failed"
      : org.auto_post_enabled
        ? "approved"
        : "pending";

    // 9. Insert the comment
    const { data: comment, error: commentError } = await supabase
      .from("doc_comments")
      .insert({
        user_id: org.user_id,
        post_id: post.id,
        org_id: body.org_id,
        generated_content: generatedContent,
        status: commentStatus,
        approved_by: commentStatus === "approved" ? org.user_id : null,
      })
      .select("id, status")
      .single();

    if (commentError || !comment) {
      console.error("Failed to insert comment:", commentError);
      return safeError(commentError);
    }

    // 10. If auto-approved, trigger Make.com to post
    if (commentStatus === "approved" && generatedContent) {
      await triggerMakeWebhook({
        event: "comment_approved",
        org_id: body.org_id,
        post_url: body.linkedin_post_url,
        comment_content: generatedContent,
        contact_name: body.author_name,
      });
    }

    return new Response(
      JSON.stringify({ data: { id: comment.id, status: comment.status } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return safeError(err);
  }
});
