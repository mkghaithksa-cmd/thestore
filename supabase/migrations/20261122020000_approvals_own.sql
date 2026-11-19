-- A manager may approve their own request (owner's decision, 2026-11-20):
-- what matters is that the approver holds the approve permission for that
-- kind. Everything else in approval_decide() is unchanged.

-- Drop the table rule "decided_by must differ from requested_by" (found by its text, not its generated name).
do $do$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.approvals'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%decided_by%requested_by%'
  loop
    execute format('alter table public.approvals drop constraint %I', v_name);
  end loop;
end
$do$;

create or replace function public.approval_decide(p_approval_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.approvals%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into a from public.approvals where id = p_approval_id for update;
  if not found then
    raise exception 'approval_not_found';
  end if;
  if not public.has_permission(case when a.kind = 'stock_diff' then 'inventory' else 'payments' end, 'approve') then
    raise exception 'not_allowed';
  end if;
  if a.status <> 'pending' then
    raise exception 'already_decided';
  end if;
  if length(coalesce(v_note, '')) > 300 then
    raise exception 'note_too_long';
  end if;
  if not coalesce(p_approve, false) and v_note is null then
    raise exception 'reason_required';
  end if;

  update public.approvals
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = a.id;

  if a.kind = 'discount' then
    if p_approve then
      update public.work_orders set status = 'quote', quote_at = now() where id = a.work_order_id and status = 'approval';
    else
      -- Back to pricing without the discount.
      update public.work_orders
         set status = 'report', subtotal = subtotal + discount,
             vat = round((subtotal + discount) * vat_rate, 2),
             total = (subtotal + discount) + round((subtotal + discount) * vat_rate, 2),
             discount = 0, discount_reason = null
       where id = a.work_order_id and status = 'approval';
    end if;
  elsif a.kind = 'custody_diff' then
    if p_approve then
      update public.custodies set status = 'settled' where id = a.custody_id and status = 'pending';
    else
      update public.custodies
         set status = 'open', received_amount = null, received_at = null, received_by = null, note = null
       where id = a.custody_id and status = 'pending';
    end if;
  elsif a.kind = 'stock_diff' and p_approve then
    insert into public.stock_movements (product_id, qty, kind, note)
    values (a.product_id, a.qty, 'adjust', coalesce(a.note, 'فرق جرد') || ' (معتمد)');
  end if;
end;
$$;
