export interface Organization {
  id: string;
  user_id: string;
  name: string;
  auto_post_enabled: boolean;
  ai_system_prompt: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  user_id: string;
  org_id: string;
  role: "owner" | "admin" | "member";
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: string;
  user_id: string;
  org_id: string;
  linkedin_post_url: string;
  author_name: string;
  author_headline: string | null;
  content: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CommentStatus = "pending" | "approved" | "rejected" | "generation_failed";

export interface Comment {
  id: string;
  user_id: string;
  post_id: string;
  org_id: string;
  generated_content: string | null;
  edited_content: string | null;
  status: CommentStatus;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommentWithPost extends Comment {
  doc_posts: Post;
}

export type ContactStatus = "no_action" | "connected" | "replied";

export interface Contact {
  id: string;
  user_id: string;
  org_id: string;
  linkedin_profile_url: string;
  full_name: string;
  status: ContactStatus;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ToneProcessingStatus = "pending" | "completed" | "failed";

export interface ToneSample {
  id: string;
  user_id: string;
  org_id: string;
  file_path: string;
  extracted_text: string | null;
  processing_status: ToneProcessingStatus;
  created_at: string;
  updated_at: string;
}
