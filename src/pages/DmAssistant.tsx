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
import { Skeleton } from "../components/ui/skeleton";
import { Copy, RefreshCw, Loader2 } from "lucide-react";
import type { DmDraft } from "../types/database";

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

  const mutation = useMutation({
    mutationFn: async () => {
      return callEdgeFunction<GenerateDmResult>("doc_generate_dm", {
        org_id: currentOrgId,
        conversation_context: conversationContext,
        last_reply: lastReply,
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

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">DM Assistant</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate professional DM replies using your trained tone.
        </p>
      </div>

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

        <Button
          onClick={() => mutation.mutate()}
          disabled={
            !conversationContext.trim() ||
            !lastReply.trim() ||
            mutation.isPending
          }
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

function DmHistory({ orgId }: { orgId: string }) {
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
              Their reply: "{item.last_reply}"
            </p>
            <p className="text-sm line-clamp-3">
              {item.generated_content}
            </p>
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
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
