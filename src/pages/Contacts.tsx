import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "../lib/supabaseClient";
import { useOrganization } from "../hooks/useOrganization";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Skeleton } from "../components/ui/skeleton";
import { ExternalLink, ChevronDown } from "lucide-react";
import type { Contact, ContactStatus } from "../types/database";

const STATUS_OPTIONS: { value: ContactStatus; label: string }[] = [
  { value: "no_action", label: "No Action" },
  { value: "connected", label: "Connected" },
  { value: "replied", label: "Replied" },
];

const STATUS_FILTERS: { value: ContactStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  ...STATUS_OPTIONS,
];

const statusBadgeVariant: Record<ContactStatus, "outline" | "default" | "secondary"> = {
  no_action: "outline",
  connected: "default",
  replied: "secondary",
};

export function Contacts() {
  const { currentOrgId } = useOrganization();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ContactStatus | "all">("all");

  const contactsQuery = useQuery({
    queryKey: ["contacts", currentOrgId],
    queryFn: async () => {
      if (!currentOrgId) return [];
      const { data, error } = await supabase
        .from("doc_contacts")
        .select("id, user_id, org_id, linkedin_profile_url, full_name, status, last_contacted_at, created_at, updated_at")
        .eq("org_id", currentOrgId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Contact[];
    },
    enabled: !!currentOrgId,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ contactId, status }: { contactId: string; status: ContactStatus }) => {
      const { error } = await supabase
        .from("doc_contacts")
        .update({ status })
        .eq("id", contactId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contact status updated");
      queryClient.invalidateQueries({ queryKey: ["contacts", currentOrgId] });
    },
    onError: () => {
      toast.error("Failed to update contact status");
    },
  });

  if (!currentOrgId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No organization selected.
      </div>
    );
  }

  const contacts = contactsQuery.data ?? [];
  const filtered =
    statusFilter === "all"
      ? contacts
      : contacts.filter((c) => c.status === statusFilter);

  const statusCounts = contacts.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {contacts.length} contact{contacts.length === 1 ? "" : "s"} in pipeline
        </p>
      </div>

      {/* Status filters */}
      <div className="flex gap-2">
        {STATUS_FILTERS.map((filter) => {
          const count =
            filter.value === "all"
              ? contacts.length
              : statusCounts[filter.value] ?? 0;
          return (
            <Button
              key={filter.value}
              variant={statusFilter === filter.value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
              {count > 0 && (
                <span className="ml-1.5 text-xs tabular-nums">({count})</span>
              )}
            </Button>
          );
        })}
      </div>

      {/* Contacts table */}
      {contactsQuery.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground">
          {contacts.length === 0
            ? "No contacts yet. They will appear as posts are ingested."
            : "No contacts match this filter."}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Contacted</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">
                    {contact.full_name}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="sm" className="gap-1 h-7" />}
                      >
                        <Badge variant={statusBadgeVariant[contact.status]}>
                          {contact.status === "no_action"
                            ? "No Action"
                            : contact.status.charAt(0).toUpperCase() +
                              contact.status.slice(1)}
                        </Badge>
                        <ChevronDown className="h-3 w-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {STATUS_OPTIONS.map((opt) => (
                          <DropdownMenuItem
                            key={opt.value}
                            onClick={() =>
                              updateStatusMutation.mutate({
                                contactId: contact.id,
                                status: opt.value,
                              })
                            }
                            disabled={contact.status === opt.value}
                          >
                            {opt.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {contact.last_contacted_at
                      ? new Date(contact.last_contacted_at).toLocaleDateString()
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(contact.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <a
                      href={contact.linkedin_profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
