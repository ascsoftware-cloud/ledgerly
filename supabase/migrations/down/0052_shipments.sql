-- Reverses 0052_shipments. Deletes shipment records.
drop function if exists public.record_shipment_tracking(uuid, text, text, jsonb);
drop function if exists public.finish_shipment_booking(uuid, boolean, text, text, text, bigint, text);
drop function if exists public.start_shipment(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, bigint);
drop table if exists public.shipment_events;
drop table if exists public.shipments;
