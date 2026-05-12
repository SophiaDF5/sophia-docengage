import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "../lib/supabaseClient";
import { callEdgeFunction } from "../lib/apiClient";
import { useOrganization } from "../hooks/useOrganization";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import {
  Copy,
  RefreshCw,
  Loader2,
  Trash2,
  Plus,
  UserCircle,
  ChevronDown,
  ChevronUp,
  Pencil,
} from "lucide-react";
import type { DmDraft, DmLead } from "../types/database";

interface GenerateDmResult {
  data: {
    id: string | null;
    generated_content: string;
  };
}

export function DmAssistant() {
  const { currentOrgId } = useOrganization();
  const queryClient = useQueryClient();

  const [conversationContext, setConversationContext] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [newTopic, setNewTopic] = useState("");

  // Lead info
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadName, setLeadName] = useState("");
  const [leadBio, setLeadBio] = useState("");
  const [leadLinks, setLeadLinks] = useState("");
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);

  // Fetch saved leads
  const leadsQuery = useQuery({
    queryKey: ["dm-leads", currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doc_dm_leads")
        .select("*")
        .eq("org_id", currentOrgId!)
        .order("name");
      if (error) throw error;
      return data as DmLead[];
    },
    enabled: !!currentOrgId,
  });

  const leads = leadsQuery.data ?? [];

  // Save lead
  const saveLeadMutation = useMutation({
    mutationFn: async () => {
      if (editingLeadId) {
        const { error } = await supabase
          .from("doc_dm_leads")
          .update({ name: leadName, bio: leadBio || null, links: leadLinks || null })
          .eq("id", editingLeadId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("doc_dm_leads")
          .insert({
            org_id: currentOrgId!,
            name: leadName,
            bio: leadBio || null,
            links: leadLinks || null,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm-leads", currentOrgId] });
      toast.success(editingLeadId ? "Lead updated" : "Lead saved");
      setEditingLeadId(null);
      setShowLeadForm(false);
    },
    onError: () => toast.error("Failed to save lead"),
  });

  const deleteLeadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("doc_dm_leads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm-leads", currentOrgId] });
      if (selectedLeadId) {
        setSelectedLeadId(null);
        setLeadName("");
        setLeadBio("");
        setLeadLinks("");
      }
      toast.success("Lead deleted");
    },
    onError: () => toast.error("Failed to delete lead"),
  });

  const selectLead = (lead: DmLead) => {
    setSelectedLeadId(lead.id);
    setLeadName(lead.name);
    setLeadBio(lead.bio || "");
    setLeadLinks(lead.links || "");
    setShowLeadForm(false);
    setEditingLeadId(null);
  };

  const startNewLead = () => {
    setSelectedLeadId(null);
    setLeadName("");
    setLeadBio("");
    setLeadLinks("");
    setEditingLeadId(null);
    setShowLeadForm(true);
  };

  const startEditLead = (lead: DmLead) => {
    setLeadName(lead.name);
    setLeadBio(lead.bio || "");
    setLeadLinks(lead.links || "");
    setEditingLeadId(lead.id);
    setShowLeadForm(true);
  };

  // Generate DM
  const mutation = useMutation({
    mutationFn: async () => {
      return callEdgeFunction<GenerateDmResult>("doc_generate_dm", {
        org_id: currentOrgId,
        conversation_context: conversationContext,
        last_reply: lastReply || undefined,
        new_topic: newTopic || undefined,
        lead_name: leadName || undefined,
        lead_bio: leadBio || undefined,
        lead_links: leadLinks || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm-history", currentOrgId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    },
  });

  const generatedContent = mutation.data?.data?.generated_content ?? null;
  const [editedReply, setEditedReply] = useState("");

  // Sync when new content arrives
  if (generatedContent && generatedContent !== editedReply && !mutation.isPending) {
    setEditedReply(generatedContent);
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(editedReply);
    toast.success("Copied to clipboard");
  };

  if (!currentOrgId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No organization selected.
      </div>
    );
  }

  const canGenerate = conversationContext.trim() && lastReply.trim();

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">DM Assistant</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate DM replies using your trained tone.
        </p>
      </div>

      {/* Saved Leads */}
      <LeadSection
        leads={leads}
        selectedLeadId={selectedLeadId}
        showLeadForm={showLeadForm}
        editingLeadId={editingLeadId}
        leadName={leadName}
        leadBio={leadBio}
        leadLinks={leadLinks}
        onSelectLead={selectLead}
        onStartNewLead={startNewLead}
        onStartEditLead={startEditLead}
        onDeleteLead={(id) => deleteLeadMutation.mutate(id)}
        onSetLeadName={setLeadName}
        onSetLeadBio={setLeadBio}
        onSetLeadLinks={setLeadLinks}
        onSaveLead={() => saveLeadMutation.mutate()}
        onCancelForm={() => {
          setShowLeadForm(false);
          setEditingLeadId(null);
        }}
        isSaving={saveLeadMutation.isPending}
      />

      {/* Conversation fields */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Last Conversation</Label>
          <Textarea
            value={conversationContext}
            onChange={(e) => setConversationContext(e.target.value)}
            placeholder="Paste the conversation so far..."
            rows={6}
          />
          <p className="text-xs text-muted-foreground">
            The context of your conversation with this person
          </p>
        </div>

        <div className="space-y-2">
          <Label>Last Reply</Label>
          <Textarea
            value={lastReply}
            onChange={(e) => setLastReply(e.target.value)}
            placeholder="Paste their most recent message..."
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            The doctor's most recent message you need to reply to
          </p>
        </div>

        <div className="space-y-2">
          <Label>New Topic (optional)</Label>
          <Textarea
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="e.g. I saw you recently posted about..."
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            Bring up a new topic — like something they recently posted about
          </p>
        </div>

        <Button
          onClick={() => mutation.mutate()}
          disabled={!canGenerate || mutation.isPending}
        >
          {mutation.isPending ? (
            <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Generating...</>
          ) : (
            "Generate Reply"
          )}
        </Button>

        {mutation.isPending && (
          <Card className="mt-4">
            <CardContent className="pt-6 space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        )}

        {generatedContent && !mutation.isPending && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Suggested Reply
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={editedReply}
                onChange={(e) => setEditedReply(e.target.value)}
                rows={4}
                className="text-sm"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {editedReply.length} characters
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => mutation.mutate()}
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Regenerate
                  </Button>
                  <Button size="sm" onClick={handleCopy}>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <DmHistory orgId={currentOrgId} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Lead Section                                                       */
/* ------------------------------------------------------------------ */

interface LeadSectionProps {
  leads: DmLead[];
  selectedLeadId: string | null;
  showLeadForm: boolean;
  editingLeadId: string | null;
  leadName: string;
  leadBio: string;
  leadLinks: string;
  onSelectLead: (lead: DmLead) => void;
  onStartNewLead: () => void;
  onStartEditLead: (lead: DmLead) => void;
  onDeleteLead: (id: string) => void;
  onSetLeadName: (v: string) => void;
  onSetLeadBio: (v: string) => void;
  onSetLeadLinks: (v: string) => void;
  onSaveLead: () => void;
  onCancelForm: () => void;
  isSaving: boolean;
}

function LeadSection({
  leads,
  selectedLeadId,
  showLeadForm,
  editingLeadId,
  leadName,
  leadBio,
  leadLinks,
  onSelectLead,
  onStartNewLead,
  onStartEditLead,
  onDeleteLead,
  onSetLeadName,
  onSetLeadBio,
  onSetLeadLinks,
  onSaveLead,
  onCancelForm,
  isSaving,
}: LeadSectionProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card>
      <CardHeader
        className="pb-2 cursor-pointer flex flex-row items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <UserCircle className="h-4 w-4" />
          Leads
          {selectedLeadId && !expanded && (
            <span className="text-muted-foreground font-normal ml-1">
              — {leads.find((l) => l.id === selectedLeadId)?.name}
            </span>
          )}
        </CardTitle>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3">
          {/* Saved leads list */}
          {leads.length > 0 && (
            <div className="space-y-1">
              {leads.map((lead) => (
                <div
                  key={lead.id}
                  className={`flex items-center justify-between p-2 rounded-md text-sm cursor-pointer hover:bg-muted/50 ${
                    selectedLeadId === lead.id ? "bg-muted" : ""
                  }`}
                  onClick={() => onSelectLead(lead)}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{lead.name}</p>
                    {lead.bio && (
                      <p className="text-xs text-muted-foreground truncate">
                        {lead.bio}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartEditLead(lead);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLead(lead.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add new lead button */}
          {!showLeadForm && (
            <Button variant="outline" size="sm" onClick={onStartNewLead}>
              <Plus className="h-4 w-4 mr-1" />
              Add Lead
            </Button>
          )}

          {/* Lead form (add / edit) */}
          {showLeadForm && (
            <div className="space-y-3 border rounded-md p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {editingLeadId ? "Edit Lead" : "New Lead"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={leadName}
                    onChange={(e) => onSetLeadName(e.target.value)}
                    placeholder="Dr. Jane Smith"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Links</Label>
                  <Input
                    value={leadLinks}
                    onChange={(e) => onSetLeadLinks(e.target.value)}
                    placeholder="LinkedIn URL, website, etc."
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bio</Label>
                <Textarea
                  value={leadBio}
                  onChange={(e) => onSetLeadBio(e.target.value)}
                  placeholder="Their headline, specialty, interests..."
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={onSaveLead}
                  disabled={!leadName.trim() || isSaving}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : null}
                  {editingLeadId ? "Update" : "Save"}
                </Button>
                <Button variant="outline" size="sm" onClick={onCancelForm}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  DM History                                                         */
/* ------------------------------------------------------------------ */

function DmHistory({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("doc_dm_drafts")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm-history", orgId] });
      toast.success("Draft deleted");
    },
    onError: () => toast.error("Failed to delete draft"),
  });

  const historyQuery = useQuery({
    queryKey: ["dm-history", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doc_dm_drafts")
        .select("id, conversation_context, last_reply, generated_content, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as DmDraft[];
    },
  });

  const items = historyQuery.data ?? [];
  if (items.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Recent DM Drafts</h2>
      {items.map((item) => (
        <Card key={item.id}>
          <CardContent className="pt-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              {new Date(item.created_at).toLocaleDateString()}
            </p>
            <p className="text-xs text-muted-foreground line-clamp-1">
              Their reply: &ldquo;{item.last_reply}&rdquo;
            </p>
            <p className="text-sm line-clamp-3">
              {item.generated_content}
            </p>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(item.generated_content || "");
                  toast.success("Copied");
                }}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteMutation.mutate(item.id)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
