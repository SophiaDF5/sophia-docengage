import { corsHeaders } from "../_shared/cors.ts";
import { requireAuth, createUserClient } from "../_shared/auth.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { safeError } from "../_shared/error-handler.ts";
import { validateBody, z } from "../_shared/validate.ts";

const ScrapeSchema = z.object({
  org_id: z.string().uuid(),
  linkedin_post_url: z.string().url(),
});

interface ApifyCommenter {
  profileUrl?: string;
  fullName?: string;
  headline?: string;
}

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
    const [body, validationError] = await validateBody(req, ScrapeSchema);
    if (validationError) return validationError;

    // 3. Check Apify API key
    const apifyToken = Deno.env.get("APIFY_API_KEY");
    if (!apifyToken) {
      return new Response(
        JSON.stringify({ error: "Apify API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Start Apify actor run (synchronous — waits for completion)
    const actorId = "curious_coder~linkedin-post-commenters";
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}&waitForFinish=120`;

    let runResponse: Response;
    try {
      runResponse = await fetch(runUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postUrl: body.linkedin_post_url,
        }),
      });
    } catch (err) {
      console.error("Apify request failed:", err);
      return new Response(
        JSON.stringify({ error: "Failed to connect to scraping service" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!runResponse.ok) {
      console.error("Apify run failed:", runResponse.status, await runResponse.text());
      return new Response(
        JSON.stringify({ error: "Scraping service returned an error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const runData = await runResponse.json();
    const datasetId = runData.data?.defaultDatasetId;

    if (!datasetId) {
      return new Response(
        JSON.stringify({ error: "Scraping completed but no results found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Fetch results from dataset
    const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`;
    const datasetResponse = await fetch(datasetUrl);

    if (!datasetResponse.ok) {
      console.error("Failed to fetch Apify dataset:", datasetResponse.status);
      return new Response(
        JSON.stringify({ error: "Failed to retrieve scraping results" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const commenters: ApifyCommenter[] = await datasetResponse.json();

    // 6. Upsert contacts
    const supabase = createUserClient(req);
    let contactsNew = 0;

    for (const commenter of commenters) {
      if (!commenter.profileUrl || !commenter.fullName) continue;

      const { error } = await supabase
        .from("doc_contacts")
        .upsert(
          {
            org_id: body.org_id,
            linkedin_profile_url: commenter.profileUrl,
            full_name: commenter.fullName,
            headline: commenter.headline ?? null,
            status: "no_action",
          },
          { onConflict: "org_id,linkedin_profile_url", ignoreDuplicates: true }
        );

      if (!error) contactsNew++;
      else console.error("Failed to upsert contact:", commenter.profileUrl, error);
    }

    return new Response(
      JSON.stringify({
        data: {
          contacts_found: commenters.length,
          contacts_saved: contactsNew,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return safeError(err);
  }
});
