drop function if exists public.import_bank_lines(uuid, text, jsonb);
drop function if exists public.match_bank_line(uuid, uuid);
drop function if exists public.bank_line_to_expense(uuid, uuid);
drop function if exists public.set_bank_line_ignored(uuid, boolean);
drop table if exists public.bank_lines, public.bank_imports;
