import { corsHeaders } from "../_shared/cors.ts";
import { requireAuth, createUserClient } from "../_shared/auth.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { safeError } from "../_shared/error-handler.ts";
import { validateBody, z } from "../_shared/validate.ts";

const ScrapeSchema = z.object({
  org_id: z.string().uuid(),
  linkedin_post_url: z.string().url(),
});

interface ApifyComment {
  data_type: "comment";
  author?: { name?: string; headline?: string; profile_url?: string };
}

interface ApifyReaction {
  data_type: "reaction";
  reactor?: { name?: string; headline?: string; profile_url?: string };
}

type ApifyItem = ApifyComment | ApifyReaction;

const DOCTOR_KEYWORDS = [
  "doctor", "dr.", "dr ", "physician", "surgeon", "medical director",
  "cardiologist", "dermatologist", "neurologist", "oncologist", "radiologist",
  "anesthesiologist", "pathologist", "psychiatrist", "pediatrician", "urologist",
  "ophthalmologist", "orthopedic", "gastroenterologist", "endocrinologist",
  "pulmonologist", "nephrologist", "rheumatologist", "hematologist",
  "m.d.", "mbbs", "m.b.b.s", "d.o.",
  "hospital", "clinic", "healthcare", "medical", "medicine",
  "chief medical", "cmo", "attending", "resident", "fellow",
];

const DOCTOR_KEYWORDS_EXACT = [/\bmd\b/, /\bdo\b/];

function isDoctorLead(name: string, headline: string): boolean {
  const text = `${name.toLowerCase()} ${headline.toLowerCase()}`;
  return (
    DOCTOR_KEYWORDS.some((kw) => text.includes(kw)) ||
    DOCTOR_KEYWORDS_EXACT.some((re) => re.test(text))
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    // 3. Check required env vars
    const apifyToken = Deno.env.get("APIFY_API_KEY");

    if (!apifyToken) {
      return new Response(
        JSON.stringify({ error: "Apify API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Start Apify actor (no cookies needed)
    const actorId = "unseenuser~linkedin-post-comment-reaction-extractor-no-cookies";
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}`;

    let runResponse: Response;
    try {
      runResponse = await fetch(runUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posts: [body.linkedin_post_url],
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
      const errText = await runResponse.text();
      console.error("Apify run failed:", runResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "Scraping service returned an error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const runData = await runResponse.json();
    const runId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;

    console.log("Apify run started:", runId, "dataset:", datasetId);

    if (!runId || !datasetId) {
      return new Response(
        JSON.stringify({ error: "Scraping service did not return a run ID" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Poll for completion (max ~5 minutes)
    const maxWaitMs = 300_000;
    const pollIntervalMs = 10_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await sleep(pollIntervalMs);

      const statusResp = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
      );
      if (!statusResp.ok) {
        console.error("Failed to poll Apify run status:", statusResp.status);
        continue;
      }

      const statusData = await statusResp.json();
      const status = statusData.data?.status;
      console.log("Apify poll:", status, `(${Math.round((Date.now() - startTime) / 1000)}s)`);

      if (status === "SUCCEEDED") break;
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        return new Response(
          JSON.stringify({ error: "Scraping failed — the actor did not complete successfully" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 6. Fetch results
    const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`;
    const datasetResponse = await fetch(datasetUrl);

    if (!datasetResponse.ok) {
      console.error("Failed to fetch Apify dataset:", datasetResponse.status);
      return new Response(
        JSON.stringify({ error: "Failed to retrieve scraping results" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const allItems: ApifyItem[] = await datasetResponse.json();
    console.log("Total items from Apify:", allItems.length);

    // 7. Deduplicate and filter for doctor leads
    const seen = new Set<string>();
    const doctorLeads: { name: string; profileUrl: string; headline: string; engagementType: string }[] = [];

    for (const item of allItems) {
      const person = item.data_type === "comment"
        ? (item as ApifyComment).author
        : (item as ApifyReaction).reactor;

      const profileUrl = person?.profile_url;
      const name = person?.name;
      const headline = person?.headline ?? "";

      if (!profileUrl || !name || seen.has(profileUrl)) continue;
      seen.add(profileUrl);

      if (isDoctorLead(name, headline)) {
        doctorLeads.push({ name, profileUrl, headline, engagementType: item.data_type });
      }
    }

    console.log("Doctor leads found:", doctorLeads.length);

    // 8. Upsert contacts
    const supabase = createUserClient(req);
    let contactsNew = 0;

    for (const lead of doctorLeads) {
      const { error } = await supabase
        .from("doc_contacts")
        .upsert(
          {
            user_id: user.id,
            org_id: body.org_id,
            linkedin_profile_url: lead.profileUrl,
            full_name: lead.name,
            headline: lead.headline || null,
            is_connected: false,
            status: "pending",
          },
          { onConflict: "org_id,linkedin_profile_url" }
        );

      if (!error) contactsNew++;
      else console.error("Failed to upsert contact:", lead.profileUrl, error.message);
    }

    console.log("Contacts saved:", contactsNew);

    return new Response(
      JSON.stringify({
        data: {
          total_engagers: seen.size,
          doctors_found: doctorLeads.length,
          contacts_saved: contactsNew,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return safeError(err);
  }
});
