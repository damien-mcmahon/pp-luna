-- Applied once by Supabase CLI after the initial schema baseline.
begin;

alter table public.tables
  add column deck text not null default 'fibonacci'
  check (deck in ('fibonacci', 't-shirt-sizes'));

alter table public.votes drop constraint votes_value_check;
alter table public.votes alter column value type text using value::text;
alter table public.votes add constraint votes_value_check
  check (value in ('1', '2', '3', '5', '8', '13', '21', 'XS', 'S', 'M', 'L', 'XL', 'XXL'));

commit;
