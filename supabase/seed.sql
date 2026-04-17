-- SEED DATA
-- Development/testing only - never run in production
-- Test users must be created in Supabase Auth separately
-- (via dashboard, CLI, or the abuse test setup script)
--
-- Users:
--   User A: 11111111-1111-1111-1111-111111111111 (owner of Acme Health, admin of Beta MedTech)
--   User B: 22222222-2222-2222-2222-222222222222 (owner of Gamma Orthopedics, member of Delta Clinical)
--   User C: 33333333-3333-3333-3333-333333333333 (member of Acme Health — tests cross-user org access)

begin;

-- ============================================================
-- Organizations
-- ============================================================

-- User A's orgs
insert into public.doc_organizations (id, user_id, name, auto_post_enabled, ai_system_prompt)
values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Acme Health Group', false, 'You are a professional healthcare CEO. Focus on empathy and leadership.'),
  ('a1111111-2222-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Beta MedTech', true, 'You are an energetic startup founder bridging tech and medicine.')
on conflict do nothing;

-- User B's orgs
insert into public.doc_organizations (id, user_id, name, auto_post_enabled, ai_system_prompt)
values
  ('b2222222-1111-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Gamma Orthopedics', false, 'You are an academic researcher. Use formal language.'),
  ('b2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Delta Clinical', true, 'You are a friendly medical device sales representative.')
on conflict do nothing;

-- ============================================================
-- Organization Members
-- ============================================================

insert into public.doc_organization_members (id, user_id, org_id, role)
values
  -- User A: owner of Acme Health, admin of Beta MedTech
  ('m1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'owner'),
  ('m1111111-2222-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a1111111-2222-1111-1111-111111111111', 'owner'),
  -- User B: owner of Gamma, member of Delta
  ('m2222222-1111-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'b2222222-1111-2222-2222-222222222222', 'owner'),
  ('m2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', 'owner'),
  -- User C: member of Acme Health (tests cross-user org-scoped access)
  ('m3333333-1111-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', 'member')
on conflict do nothing;

-- ============================================================
-- Posts
-- ============================================================

insert into public.doc_posts (id, user_id, org_id, linkedin_post_url, author_name, author_headline, content, published_at)
values
  -- Acme Health posts (User A's org — User C should also see these)
  ('p1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'https://linkedin.com/post/1', 'Dr. Smith', 'Cardiologist', 'Great insights on preventative heart health today in the clinic.', now()),
  ('p1111111-2222-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'https://linkedin.com/post/2', 'Dr. Jones', 'Surgeon', 'The future of robotic surgery is already here.', null),
  -- Gamma Orthopedics post (User B's org — User A and C should NOT see this)
  ('p2222222-1111-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'b2222222-1111-2222-2222-222222222222', 'https://linkedin.com/post/3', 'Dr. Evans', 'Neurologist', 'New studies on brain plasticity are challenging our previous models.', now())
on conflict do nothing;

-- ============================================================
-- Comments (various statuses to populate all Dashboard tabs)
-- ============================================================

insert into public.doc_comments (id, user_id, post_id, org_id, generated_content, edited_content, status, approved_by)
values
  -- Acme Health: pending (shows in queue for both User A and User C)
  ('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'p1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Completely agree, Dr. Smith. Prevention is the cornerstone of modern cardiology. How are your patients responding to the new guidelines?', null, 'pending', null),
  -- Acme Health: approved
  ('c1111111-2222-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'p1111111-2222-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Robotics are fascinating.', 'Robotics are transforming the surgical suite. What system are you currently favoring, Dr. Jones?', 'approved', '11111111-1111-1111-1111-111111111111'),
  -- Acme Health: generation_failed
  ('c1111111-3333-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'p1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', null, null, 'generation_failed', null),
  -- Gamma Orthopedics: rejected (should NOT be visible to User A or User C)
  ('c2222222-1111-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'p2222222-1111-2222-2222-222222222222', 'b2222222-1111-2222-2222-222222222222', 'Great post.', null, 'rejected', '22222222-2222-2222-2222-222222222222')
on conflict do nothing;

-- ============================================================
-- Contacts
-- ============================================================

insert into public.doc_contacts (id, user_id, org_id, linkedin_profile_url, full_name, status, last_contacted_at)
values
  -- Acme Health contacts
  ('k1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'https://linkedin.com/in/drsmith', 'Dr. Alan Smith', 'no_action', null),
  ('k1111111-2222-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'https://linkedin.com/in/drjones', 'Dr. Sarah Jones', 'connected', now()),
  -- Stale contact for daily followup test (created >7 days ago)
  ('k1111111-3333-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'https://linkedin.com/in/drpatel', 'Dr. Raj Patel', 'no_action', null),
  -- Gamma Orthopedics contacts
  ('k2222222-1111-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'b2222222-1111-2222-2222-222222222222', 'https://linkedin.com/in/drevans', 'Dr. Marcus Evans', 'replied', now())
on conflict do nothing;

-- Backdate the stale contact so daily followup cron picks it up
update public.doc_contacts
  set created_at = now() - interval '10 days'
  where id = 'k1111111-3333-1111-1111-111111111111';

-- ============================================================
-- Tone Samples (paths use org_id per migration 002 storage fix)
-- ============================================================

insert into public.doc_tone_samples (id, user_id, org_id, file_path, extracted_text, processing_status)
values
  -- Acme Health: pending processing
  ('t1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111/ceo_keynote.mp4', null, 'pending'),
  -- Acme Health: completed
  ('t1111111-2222-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111/podcast_interview.mp3', 'It is crucial to keep pushing the boundaries of what our systems can handle while maintaining the human touch...', 'completed'),
  -- Gamma Orthopedics: failed
  ('t2222222-1111-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'b2222222-1111-2222-2222-222222222222', 'b2222222-1111-2222-2222-222222222222/damaged_audio.wav', null, 'failed')
on conflict do nothing;

commit;
