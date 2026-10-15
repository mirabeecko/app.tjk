-- AIRBAG sessions v2. Apply ONLY after review. App schema (not public).
CREATE TABLE IF NOT EXISTS app.airbag_session_days (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 activity_date date NOT NULL UNIQUE,
 enabled boolean NOT NULL DEFAULT false,
 price_czk integer NOT NULL DEFAULT 349 CHECK (price_czk >= 0),
 second_price_czk integer NOT NULL DEFAULT 199 CHECK (second_price_czk >= 0),
 capacity integer NOT NULL DEFAULT 10 CHECK (capacity BETWEEN 1 AND 200),
 min_paid_third integer NOT NULL DEFAULT 5 CHECK (min_paid_third >= 1),
 min_first integer NOT NULL DEFAULT 7,
 min_second integer NOT NULL DEFAULT 7,
 min_interest_with_occupancy integer NOT NULL DEFAULT 3,
 min_interest_alone integer NOT NULL DEFAULT 7,
 confirmation_deadline timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app.airbag_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 day_id uuid NOT NULL REFERENCES app.airbag_session_days(id) ON DELETE CASCADE,
 slot integer NOT NULL CHECK (slot IN (1,2,3)),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 state text NOT NULL CHECK (state IN ('open','interest','pending','confirmed','closed','cancelled')),
 opening_reason text CHECK (opening_reason IN ('occupancy_interest','interest','sold_out','manual')),
 manually_guaranteed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(day_id,slot), CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS app.airbag_bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_email text NOT NULL,
 customer_name text NOT NULL,
 payment_reference text UNIQUE,
 status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','paid','cancelled','refunded')),
 hold_expires_at timestamptz,
 total_czk integer NOT NULL CHECK(total_czk>=0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app.airbag_booking_places (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES app.airbag_bookings(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES app.airbag_sessions(id),
 rider_key text NOT NULL,
 price_czk integer NOT NULL CHECK(price_czk>=0),
 UNIQUE(booking_id,session_id,rider_key)
);
CREATE INDEX IF NOT EXISTS airbag_places_session_idx ON app.airbag_booking_places(session_id);
CREATE TABLE IF NOT EXISTS app.airbag_interest (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id uuid NOT NULL REFERENCES app.airbag_sessions(id) ON DELETE CASCADE,
 email text NOT NULL,
 rider_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,rider_key)
);
CREATE TABLE IF NOT EXISTS app.airbag_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES app.airbag_sessions(id),
 action text NOT NULL,
 actor text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Never expose write privileges for these tables to anonymous clients.
-- All capacity checks and state changes must happen in a single backend DB transaction.
