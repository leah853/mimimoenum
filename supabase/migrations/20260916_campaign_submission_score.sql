alter table public.campaign_submissions
  add column if not exists score int check (score is null or (score between 1 and 10));
