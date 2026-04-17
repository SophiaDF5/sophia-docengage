import { corsHeaders } from "../_shared/cors.ts";
import { requireAuth, createUserClient } from "../_shared/auth.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { safeError } from "../_shared/error-handler.ts";
import { validateBody, z } from "../_shared/validate.ts";

const ApproveCommentSchema = z.object({
  comment_id: z.string().uuid(),
  edited_content: z.string().min(1).max(3000),
});

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Authenticate
    const [user, authError] = await requireAuth(req);
    if (authError) return authError;

    // 2. Rate limit
    const [, rateLimitError] = await rateLimit(user.id, "write");
    if (rateLimitError) return rateLimitError;

    // 3. Validate input
    const [body, validationError] = await validateBody(req, ApproveCommentSchema);
    if (validationError) return validationError;

    // 4. Create user-scoped client (RLS enforced)
    const supabase = createUserClient(req);

    // 5. Fetch the comment and verify it's pending (prevents double-approval)
    const { data: comment, error: fetchError } = await supabase
      .from("doc_comments")
      .select("id, status, org_id, post_id")
      .eq("id", body.comment_id)
      .single();

    if (fetchError || !comment) {
      return new Response(
        JSON.stringify({ error: "Comment not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (comment.status !== "pending") {
      return new Response(
        JSON.stringify({ error: "Comment is not in pending status" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Fetch the associated post for Make.com webhook payload
    const { data: post } = await supabase
      .from("doc_posts")
      .select("linkedin_post_url, author_name")
      .eq("id", comment.post_id)
      .single();

    // 7. Update the comment to approved
    const { data: updated, error: updateError } = await supabase
      .from("doc_comments")
      .update({
        edited_content: body.edited_content,
        status: "approved",
        approved_by: user.id,
      })
      .eq("id", body.comment_id)
      .eq("status", "pending") // Extra guard against race conditions
      .select("id, status")
      .single();

    if (updateError || !updated) {
      console.error("Failed to approve comment:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to approve comment. It may have already been processed." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. Trigger Make.com webhook to post the comment
    let makeSuccess = false;
    const makeSecret = Deno.env.get("MAKE_WEBHOOK_SECRET");
    const makeWebhookId = Deno.env.get("MAKE_WEBHOOK_ID");

    if (makeSecret && makeWebhookId && post) {
      try {
        const response = await fetch(`https://hook.us1.make.com/${makeWebhookId}`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${makeSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event: "comment_approved",
            org_id: comment.org_id,
            post_url: post.linkedin_post_url,
            comment_content: body.edited_content,
            contact_name: post.author_name,
          }),
        });

        if (response.status >= 500 || !response.ok) {
          console.error("Make.com webhook failed:", response.status, await response.text());
        } else {
          makeSuccess = true;
        }
      } catch (err) {
        console.error("Make.com webhook error:", err);
      }
    }

    // 9. If Make.com failed, the comment is still approved in DB.
    // The frontend shows a "copy to clipboard" fallback per PRD.
    return new Response(
      JSON.stringify({
        data: {
          id: updated.id,
          status: updated.status,
          posted: makeSuccess,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return safeError(err);
  }
});
