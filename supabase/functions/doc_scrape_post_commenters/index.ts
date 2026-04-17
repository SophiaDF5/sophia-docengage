import { corsHeaders } from "../_shared/cors.ts";
import { requireAuth, createUserClient } from "../_shared/auth.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { safeError } from "../_shared/error-handler.ts";
import { validateBody, z } from "../_shared/validate.ts";

const ScrapeSchema = z.object({
  org_id: z.string().uuid(),
  linkedin_post_url: z.string().url(),
});

interface ApifyEngager {
  linkedinUrl?: string;
  fullName?: string;
  headline?: string;
  connectionDegree?: string;
  engagementType?: string;
}

const DOCTOR_KEYWORDS = [
  "doctor", "dr.", "dr ", "physician", "surgeon", "medical director",
  "cardiologist", "dermatologist", "neurologist", "oncologist", "radiologist",
  "anesthesiologist", "pathologist", "psychiatrist", "pediatrician", "urologist",
  "ophthalmologist", "orthopedic", "gastroenterologist", "endocrinologist",
  "pulmonologist", "nephrologist", "rheumatologist", "hematologist",
  "md", "m.d.", "mbbs", "m.b.b.s", "do", "d.o.",
  "hospital", "clinic", "healthcare", "medical", "medicine",
  "chief medical", "cmo", "attending", "resident", "fellow",
];

function isDoctorLead(name: string, headline: string): boolean {
  const text = `${name.toLowerCase()} ${headline.toLowerCase()}`;
  return DOCTOR_KEYWORDS.some((kw) => text.includes(kw));
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
    const liAt = Deno.env.get("LINKEDIN_LI_AT");
    const jsessionId = Deno.env.get("LINKEDIN_JSESSIONID");

    if (!apifyToken) {
      return new Response(
        JSON.stringify({ error: "Apify API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!liAt) {
      return new Response(
        JSON.stringify({ error: "LinkedIn cookies not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Build LinkedIn cookies array
    const cookies = [
      { name: "li_at", value: liAt, domain: ".www.linkedin.com" },
    ];
    if (jsessionId) {
      cookies.push({ name: "JSESSIONID", value: `"${jsessionId}"`, domain: ".www.linkedin.com" });
    }

    // 5. Scrape post engagers with real cookies
    const actorId = "alizarin_refrigerator-owner~linkedin-post-engagers-scraper";
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}&waitForFinish=180`;

    let runResponse: Response;
    try {
      runResponse = await fetch(runUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postUrls: [body.linkedin_post_url],
          cookies,
          demoMode: false,
          maxEngagersPerPost: 100,
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
    const runStatus = runData.data?.status;
    const datasetId = runData.data?.defaultDatasetId;

    console.log("Apify run status:", runStatus, "dataset:", datasetId);

    if (runStatus === "FAILED") {
      return new Response(
        JSON.stringify({ error: "Scraping failed — LinkedIn cookies may have expired" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!datasetId) {
      return new Response(
        JSON.stringify({ error: "Scraping completed but no results found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

    const allEngagers: ApifyEngager[] = await datasetResponse.json();
    console.log("Total engagers from Apify:", allEngagers.length);

    // 7. Deduplicate and filter for doctor leads
    const seen = new Set<string>();
    const doctorLeads: { name: string; profileUrl: string; headline: string; isConnected: boolean }[] = [];

    for (const engager of allEngagers) {
      const profileUrl = engager.linkedinUrl;
      const name = engager.fullName;
      const headline = engager.headline ?? "";

      if (!profileUrl || !name || seen.has(profileUrl)) continue;
      seen.add(profileUrl);

      if (isDoctorLead(name, headline)) {
        const isConnected = engager.connectionDegree === "1st";
        doctorLeads.push({ name, profileUrl, headline, isConnected });
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
            is_connected: lead.isConnected,
            status: "pending",
          },
          { onConflict: "org_id,linkedin_profile_url", ignoreDuplicates: true }
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
