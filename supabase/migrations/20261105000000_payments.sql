-- Paying for Pro through Stripe. Stripe keeps the card details and the payment
-- records; this keeps only which Stripe customer and subscription belong to which
-- person, and the plan that follows from it. Everything here is written by the
-- server's billing function (supabase/functions/billing) acting as service_role,
-- never by the browser: a person can only read their own plan (public.plans).

-- Whether a Pro plan is ending at the end of its period (cancelled, still paid up).
alter table public.plans add column cancels_at_period_end boolean not null default false;

-- One row per person who has ever started paying. Never read by the browser.
create table public.billing (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  -- Stripe's own word for the subscription (active, past_due, canceled, ...), as last seen.
  status text,
  updated_at timestamptz not null default now()
);
revoke all on public.billing from anon, authenticated;
alter table public.billing enable row level security;
-- No policy: only the functions below, run by the server, touch it.

-- The Stripe customer of a person, or null when they never started paying.
create function public.billing_customer(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select b.stripe_customer_id from public.billing b where b.user_id = p_user
$$;

-- Records a person's Stripe customer the first time they start paying, and gives
-- back the one kept (the first one, if two checkouts raced).
create function public.link_stripe_customer(p_user uuid, p_customer text) returns text
language plpgsql security definer set search_path = '' as $$
declare kept text;
begin
  insert into public.billing (user_id, stripe_customer_id) values (p_user, p_customer)
    on conflict (user_id) do nothing;
  select b.stripe_customer_id into kept from public.billing b where b.user_id = p_user;
  return kept;
end $$;

-- What Stripe says about a subscription becomes the person's plan, in this one place:
-- active, trialing and past_due (Stripe is still retrying the card) are Pro; anything
-- else (canceled, unpaid, incomplete, incomplete_expired, paused) is the free plan.
-- A Team plan is never changed here. Returns false when no person has that customer
-- (their account was deleted), so the caller can cancel the subscription at Stripe.
create function public.set_plan_from_stripe(p_customer text, p_subscription text, p_status text, p_renews_at timestamptz, p_cancels boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who uuid;
  pro boolean := p_status in ('active', 'trialing', 'past_due');
begin
  update public.billing set stripe_subscription_id = p_subscription, status = p_status, updated_at = now()
    where stripe_customer_id = p_customer returning user_id into who;
  if who is null then
    return false;
  end if;
  update public.plans set
      plan = case when pro then 'pro' else 'free' end,
      renews_at = case when pro then p_renews_at end,
      cancels_at_period_end = pro and coalesce(p_cancels, false),
      updated_at = now()
    where user_id = who and plan in ('free', 'pro');
  return true;
end $$;

-- After the server deleted the person's Stripe customer (which cancels any subscription
-- straight away), it forgets the link so the account itself can be deleted.
create function public.forget_billing(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.billing where user_id = p_user
$$;

-- Deleting an account must never leave a subscription running at Stripe: while a
-- Stripe customer is linked, only the billing function may delete it (it deletes the
-- customer at Stripe first, then the link, then calls this).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if exists (select from public.billing b where b.user_id = auth.uid()) then
    raise exception 'payments linked: delete through the billing function';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

-- Download my data also shows the Stripe link (ids and status; Stripe holds the rest).
create or replace function public.my_data() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'from_google', u.raw_user_meta_data) from auth.users u where u.id = auth.uid()),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'plan', (select to_jsonb(l) from public.plans l where l.user_id = auth.uid()),
    'payments', (select jsonb_build_object('stripe_customer_id', b.stripe_customer_id, 'stripe_subscription_id', b.stripe_subscription_id, 'status', b.status, 'updated_at', b.updated_at) from public.billing b where b.user_id = auth.uid()),
    'ai_allowance_used_percent', public.my_allowance())
  where auth.uid() is not null
$$;

revoke all on function public.billing_customer(uuid), public.link_stripe_customer(uuid, text), public.set_plan_from_stripe(text, text, text, timestamptz, boolean), public.forget_billing(uuid) from public, anon, authenticated;
grant execute on function public.billing_customer(uuid), public.link_stripe_customer(uuid, text), public.set_plan_from_stripe(text, text, text, timestamptz, boolean), public.forget_billing(uuid) to service_role;
