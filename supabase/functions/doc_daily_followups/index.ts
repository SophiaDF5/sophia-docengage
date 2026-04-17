import { corsHeaders } from "../_shared/cors.ts";
import { safeError } from "../_shared/error-handler.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cron job: identifies contacts with status='no_action' for >7 days
 * and pushes them to Make.com for follow-up.
 *
 * Uses service_role key — this is the ONLY edge function authorized to do so.
 * Triggered by Supabase cron, not by user requests.
 */

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Verify this is a cron invocation via Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Create service role client (only function authorized to use this)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 3. Find stale contacts: no_action for > 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleContacts, error: queryError } = await supabase
      .from("doc_contacts")
      .select("id, org_id, full_name, linkedin_profile_url, last_contacted_at")
      .eq("status", "no_action")
      .lt("created_at", sevenDaysAgo);

    if (queryError) {
      console.error("Failed to query stale contacts:", queryError);
      return safeError(queryError);
    }

    if (!staleContacts || staleContacts.length === 0) {
      return new Response(
        JSON.stringify({ data: { processed: 0 } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Push each contact to Make.com
    const makeSecret = Deno.env.get("MAKE_WEBHOOK_SECRET");
    const makeWebhookId = Deno.env.get("MAKE_WEBHOOK_ID");

    if (!makeSecret || !makeWebhookId) {
      console.error("Make.com credentials not configured");
      return new Response(
        JSON.stringify({ error: "Webhook configuration missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;

    for (const contact of staleContacts) {
      try {
        const response = await fetch(`https://hook.us1.make.com/${makeWebhookId}`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${makeSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event: "followup_needed",
            org_id: contact.org_id,
            contact_name: contact.full_name,
            linkedin_profile_url: contact.linkedin_profile_url,
          }),
        });

        if (response.ok) {
          // Update last_contacted_at
          await supabase
            .from("doc_contacts")
            .update({ last_contacted_at: new Date().toISOString() })
            .eq("id", contact.id);
          processed++;
        } else {
          console.error(
            "Make.com followup webhook failed for contact:",
            contact.id,
            "status:", response.status
          );
        }
      } catch (err) {
        console.error("Make.com followup webhook error for contact:", contact.id, err);
      }
    }

    return new Response(
      JSON.stringify({ data: { processed } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return safeError(err);
  }
});
