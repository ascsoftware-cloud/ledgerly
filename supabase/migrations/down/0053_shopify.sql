-- Reverses 0053_shopify. Only cached Shopify data is lost; Shopify still has it.
drop function if exists public.shopify_forget(uuid);
drop function if exists public.shopify_prune_products(uuid, timestamptz);
drop table if exists public.shopify_sync_state;
drop table if exists public.shopify_orders;
drop table if exists public.shopify_inventory_levels;
drop table if exists public.shopify_variants;
drop table if exists public.shopify_products;
