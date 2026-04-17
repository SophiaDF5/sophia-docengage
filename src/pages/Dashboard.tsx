import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { useOrganization } from "../hooks/useOrganization";
import { QueueItem } from "../components/QueueItem";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Skeleton } from "../components/ui/skeleton";
import type { CommentWithPost, CommentStatus } from "../types/database";

const STATUS_TABS: { value: CommentStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "generation_failed", label: "Failed" },
];

export function Dashboard() {
  const { currentOrgId } = useOrganization();
  const queryClient = useQueryClient();

  const commentsQuery = useQuery({
    queryKey: ["comments", currentOrgId],
    queryFn: async () => {
      if (!currentOrgId) return [];
      const { data, error } = await supabase
        .from("doc_comments")
        .select(
          "id, user_id, post_id, org_id, generated_content, edited_content, status, approved_by, created_at, updated_at, doc_posts(id, user_id, org_id, linkedin_post_url, author_name, author_headline, content, published_at, created_at, updated_at)"
        )
        .eq("org_id", currentOrgId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as CommentWithPost[];
    },
    enabled: !!currentOrgId,
  });

  // Realtime subscription for comment status changes
  useEffect(() => {
    if (!currentOrgId) return;

    const channel = supabase
      .channel(`doc_comments_${currentOrgId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "doc_comments",
          filter: `org_id=eq.${currentOrgId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["comments", currentOrgId] });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "doc_comments",
          filter: `org_id=eq.${currentOrgId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["comments", currentOrgId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentOrgId, queryClient]);

  if (!currentOrgId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No organization selected. Please select or create an organization.
      </div>
    );
  }

  const comments = commentsQuery.data ?? [];

  const commentsByStatus = (status: CommentStatus) =>
    comments.filter((c) => c.status === status);

  const pendingCount = commentsByStatus("pending").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Comment Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {pendingCount > 0
            ? `${pendingCount} comment${pendingCount === 1 ? "" : "s"} awaiting review`
            : "No pending comments"}
        </p>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          {STATUS_TABS.map((tab) => {
            const count = commentsByStatus(tab.value).length;
            return (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
                {count > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {STATUS_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="space-y-4 mt-4">
            {commentsQuery.isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-48 w-full rounded-lg" />
                ))}
              </div>
            ) : commentsByStatus(tab.value).length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">
                No {tab.label.toLowerCase()} comments
              </p>
            ) : (
              commentsByStatus(tab.value).map((comment) => (
                <QueueItem
                  key={comment.id}
                  comment={comment}
                  orgId={currentOrgId}
                />
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
