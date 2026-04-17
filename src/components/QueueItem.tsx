import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { callEdgeFunction } from "../lib/apiClient";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import {
  Check,
  X,
  Copy,
  ExternalLink,
  Pencil,
  Undo2,
} from "lucide-react";
import type { CommentWithPost, CommentStatus } from "../types/database";
import { supabase } from "../lib/supabaseClient";

interface QueueItemProps {
  comment: CommentWithPost;
  orgId: string;
}

export function QueueItem({ comment, orgId }: QueueItemProps) {
  const post = comment.doc_posts;
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(
    comment.edited_content || comment.generated_content || ""
  );

  const approveMutation = useMutation({
    mutationFn: async (content: string) => {
      const result = await callEdgeFunction<{
        data: { id: string; status: string; posted: boolean };
      }>("doc_approve_comment", {
        comment_id: comment.id,
        edited_content: content,
      });
      return result.data;
    },
    onMutate: async () => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["comments", orgId] });
      const previous = queryClient.getQueryData<CommentWithPost[]>(["comments", orgId]);

      queryClient.setQueryData<CommentWithPost[]>(["comments", orgId], (old) =>
        old?.map((c) =>
          c.id === comment.id ? { ...c, status: "approved" as CommentStatus } : c
        )
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Revert optimistic update
      if (context?.previous) {
        queryClient.setQueryData(["comments", orgId], context.previous);
      }
      toast.error("Failed to approve comment");
    },
    onSuccess: (data) => {
      if (!data.posted) {
        toast("Comment approved but could not auto-post. Use the copy button to post manually.", {
          duration: 8000,
        });
      } else {
        toast.success("Comment approved and posted");
      }
      queryClient.invalidateQueries({ queryKey: ["comments", orgId] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("doc_comments")
        .update({ status: "rejected" })
        .eq("id", comment.id)
        .eq("status", "pending");
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["comments", orgId] });
      const previous = queryClient.getQueryData<CommentWithPost[]>(["comments", orgId]);

      queryClient.setQueryData<CommentWithPost[]>(["comments", orgId], (old) =>
        old?.map((c) =>
          c.id === comment.id ? { ...c, status: "rejected" as CommentStatus } : c
        )
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["comments", orgId], context.previous);
      }
      toast.error("Failed to reject comment");
    },
    onSuccess: () => {
      toast.success("Comment rejected");
      queryClient.invalidateQueries({ queryKey: ["comments", orgId] });
    },
  });

  const handleApprove = () => {
    const content = editedContent.trim();
    if (!content) {
      toast.error("Comment content cannot be empty");
      return;
    }
    if (content.length > 3000) {
      toast.error("Comment must be under 3000 characters");
      return;
    }
    approveMutation.mutate(content);
  };

  const handleCopy = async () => {
    const content = comment.edited_content || comment.generated_content || "";
    await navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  };

  const statusBadgeVariant = {
    pending: "outline" as const,
    approved: "default" as const,
    rejected: "secondary" as const,
    generation_failed: "destructive" as const,
  };

  const isPending = comment.status === "pending";
  const isFailed = comment.status === "generation_failed";
  const timeAgo = getTimeAgo(comment.created_at);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm truncate">
                {post.author_name}
              </span>
              {post.author_headline && (
                <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                  {post.author_headline}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{timeAgo}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={statusBadgeVariant[comment.status]}>
              {comment.status === "generation_failed" ? "failed" : comment.status}
            </Badge>
            <a
              href={post.linkedin_post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Original post content */}
        {post.content && (
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-sm text-muted-foreground line-clamp-3">
              {post.content}
            </p>
          </div>
        )}

        {/* Generated/edited comment */}
        {isFailed ? (
          <p className="text-sm text-destructive italic">
            AI generation failed. Manual entry required.
          </p>
        ) : isEditing ? (
          <div className="space-y-2">
            <Textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              rows={4}
              maxLength={3000}
              className="text-sm"
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">
                {editedContent.length}/3000
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditedContent(
                      comment.edited_content || comment.generated_content || ""
                    );
                    setIsEditing(false);
                  }}
                >
                  <Undo2 className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => setIsEditing(false)}
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap">
            {comment.edited_content || comment.generated_content || "No content generated."}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          {isPending && (
            <>
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              >
                <Check className="h-4 w-4 mr-1" />
                {approveMutation.isPending ? "Approving..." : "Approve"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => rejectMutation.mutate()}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              >
                <X className="h-4 w-4 mr-1" />
                Reject
              </Button>
              {!isEditing && !isFailed && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              )}
            </>
          )}
          {(comment.generated_content || comment.edited_content) && (
            <Button variant="ghost" size="sm" onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function getTimeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
