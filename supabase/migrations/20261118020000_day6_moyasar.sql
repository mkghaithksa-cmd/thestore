-- =====================================================================
-- Ghaith platform — Day 6, step 3: online payment with Moyasar.
--
-- The customer pays in Moyasar's form on the store. The store never marks
-- an order paid: the moyasar-verify / moyasar-webhook Edge Functions fetch
-- the payment from Moyasar's API with the secret key (kept in Edge Function
-- secrets, never in the database or the repository), then call
-- payment_confirm(), which only the service role may run. It checks the
-- amount and currency against the order's payment request and is safe to
-- call twice for the same payment.
-- =====================================================================

create function public.payment_confirm(
  p_order_id uuid,
  p_provider_payment_id text,
  p_amount_halalas integer,
  p_currency text,
  p_method text default null,
  p_raw jsonb default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  req public.payment_requests%rowtype;
  result text := 'paid';
begin
  if p_provider_payment_id is null or length(p_provider_payment_id) not between 5 and 100 then
    raise exception 'invalid_payment';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if exists (select 1 from public.payments where provider_payment_id = p_provider_payment_id) then
    return 'already_recorded';
  end if;
  select * into req from public.payment_requests where order_id = o.id order by created_at desc limit 1;
  if req.id is null or p_currency is distinct from 'SAR' or p_amount_halalas is distinct from req.amount_halalas then
    raise exception 'amount_mismatch';
  end if;

  insert into public.payments (order_id, payment_request_id, provider_payment_id, amount_halalas, status, method, raw)
  values (o.id, req.id, p_provider_payment_id, p_amount_halalas, 'paid', left(p_method, 40), p_raw);
  update public.payment_requests
     set status = 'paid', provider_payment_id = p_provider_payment_id
   where id = req.id;

  if o.status = 'pending_payment'
     or (o.status = 'cancelled' and o.cancel_reason = 'expired' and o.stock_issued_at is null) then
    -- Paid in time, or paid just after the 24 hours ran out: the order goes ahead.
    perform set_config('ghaith.event_note', 'دفع إلكتروني' || coalesce(' (' || p_method || ')', ''), true);
    update public.orders
       set status = 'paid', paid_at = now(), cancelled_at = null, cancel_reason = null
     where id = o.id;
    perform set_config('ghaith.event_note', '', true);
  else
    -- Already paid another way, or cancelled meanwhile: the money goes back.
    update public.orders set refund_status = 'due' where id = o.id;
    result := 'refund_due';
  end if;
  return result;
end;
$$;

revoke execute on function public.payment_confirm(uuid, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_confirm(uuid, text, integer, text, text, jsonb) to service_role;
