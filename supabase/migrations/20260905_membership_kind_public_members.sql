-- ============================================================
-- Členská evidence TJ Krupka (public.members) — nový sloupec „typ členství"
-- ------------------------------------------------------------------
-- Požadavek (superadmin app.tjkrupka.cz):
--   • nový sloupec membership_kind s hodnotami:
--       radne      → „řádné" (stávající členové)
--       sportovni  → „sportovní" (všichni NOVÍ členové automaticky)
--   • všichni členové v tabulce NYNÍ → řádné (radne)
--   • nově vkládaní členové (INSERT bez hodnoty) → sportovní (sportovni)
--
-- Postup (2 kroky):
--   1) ADD COLUMN s DEFAULT 'radne'  → všechny EXISTUJÍCÍ řádky dostanou 'radne'
--      (NOT NULL bez nutnosti UPDATE hromadně).
--   2) SET DEFAULT 'sportovni'       → všechny BUDOUCÍ INSERTy bez hodnoty
--      dostanou 'sportovni' (noví členové z registrace PWA i jiných zdrojů).
-- ============================================================

alter table public.members
  add column if not exists membership_kind text not null default 'radne';

alter table public.members
  alter column membership_kind set default 'sportovni';

-- Přípustné hodnoty (ochrana proti překlepům)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'members_membership_kind_check'
      and conrelid = 'public.members'::regclass
  ) then
    alter table public.members
      add constraint members_membership_kind_check
      check (membership_kind in ('radne', 'sportovni'));
  end if;
end $$;

comment on column public.members.membership_kind is
  'Typ členství: radne (řádné členství) | sportovni (sportovní — výchozí pro nové členy).';
