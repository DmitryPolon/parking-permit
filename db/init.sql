-- Parking permit schema for PostgreSQL 14.
-- Re-running this file drops the permit tables and loads them again.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

GRANT web_anon TO authenticator;
GRANT web_admin TO authenticator;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS app_private.settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON TABLE app_private.settings FROM PUBLIC;
INSERT INTO app_private.settings (key, value)
VALUES ('jwt_secret', :'jwt_secret')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO web_anon, web_admin;

DROP FUNCTION IF EXISTS public.create_permit(uuid, text, text, text, text, text, text, text, text, integer, text, text, text);
DROP FUNCTION IF EXISTS public.save_permit_mail(text, text);
DROP FUNCTION IF EXISTS public.permit_by_code(text);
DROP FUNCTION IF EXISTS public.admin_login(text, text);
DROP FUNCTION IF EXISTS public.list_admins();
DROP FUNCTION IF EXISTS public.add_admin(text, text);
DROP FUNCTION IF EXISTS public.remove_admin(text);
DROP FUNCTION IF EXISTS public.assert_admin();
DROP FUNCTION IF EXISTS public.whoami();
DROP FUNCTION IF EXISTS public.change_password(text, text);
DROP FUNCTION IF EXISTS public.delete_tenant(uuid, text);
DROP FUNCTION IF EXISTS public.list_tenant_admins(uuid);
DROP FUNCTION IF EXISTS public.add_tenant_admin(uuid, text, text);
DROP FUNCTION IF EXISTS public.remove_tenant_admin(uuid, text);
DROP FUNCTION IF EXISTS public.can_access_event(uuid);
DROP FUNCTION IF EXISTS public.jwt_is_super();
DROP FUNCTION IF EXISTS public.jwt_email();
DROP FUNCTION IF EXISTS public.permit_payload(uuid);
DROP FUNCTION IF EXISTS public.random_code();
DROP FUNCTION IF EXISTS public.sign_hs256(json);
DROP FUNCTION IF EXISTS public.url_encode(bytea);

DROP VIEW IF EXISTS public.public_events;
DROP VIEW IF EXISTS public.car_makes;
DROP TABLE IF EXISTS public.permit_mail;
DROP TABLE IF EXISTS public.permits;
DROP TABLE IF EXISTS public.event_admins;
DROP TABLE IF EXISTS public.events;
DROP TABLE IF EXISTS public.car_years;
DROP TABLE IF EXISTS public.car_models;
DROP TABLE IF EXISTS public.colors;
DROP TABLE IF EXISTS public.plate_states;
DROP TABLE IF EXISTS public.admins;

CREATE TABLE admins (
  email text PRIMARY KEY,
  password_hash text NOT NULL,
  is_super boolean NOT NULL DEFAULT false
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  show_spot boolean NOT NULL DEFAULT true,
  show_apartment boolean NOT NULL DEFAULT false,
  starts_on date,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT events_dates CHECK (
    (starts_on IS NULL AND ends_on IS NULL)
    OR (starts_on IS NOT NULL AND ends_on IS NOT NULL AND starts_on <= ends_on)
  )
);

CREATE TABLE event_admins (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  email text NOT NULL REFERENCES admins (email) ON DELETE CASCADE,
  PRIMARY KEY (event_id, email)
);

CREATE TABLE permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events (id),
  code text NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  spot text,
  apartment text,
  make text NOT NULL,
  model text NOT NULL,
  year integer NOT NULL,
  color text NOT NULL,
  plate text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permits_code_format CHECK (code ~ '^[A-Z0-9]{3}-[A-Z0-9]{4}$')
);

CREATE INDEX permits_event_created ON permits (event_id, created_at DESC);

CREATE TABLE permit_mail (
  permit_id uuid PRIMARY KEY REFERENCES permits (id) ON DELETE CASCADE,
  email text NOT NULL,
  image bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

ALTER TABLE permit_mail ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE permit_mail FROM PUBLIC, web_anon, web_admin;

CREATE TABLE car_models (
  make text NOT NULL,
  model text NOT NULL,
  year_from integer NOT NULL,
  year_to integer NOT NULL,
  PRIMARY KEY (make, model),
  CONSTRAINT car_models_years CHECK (year_from BETWEEN 1980 AND 2035 AND year_to BETWEEN year_from AND 2035)
);

CREATE TABLE car_years (
  make text NOT NULL,
  model text NOT NULL,
  year integer NOT NULL,
  PRIMARY KEY (make, model, year),
  FOREIGN KEY (make, model) REFERENCES car_models (make, model)
);

CREATE TABLE colors (
  name text PRIMARY KEY,
  sort integer NOT NULL UNIQUE
);

CREATE TABLE plate_states (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE VIEW car_makes AS
  SELECT DISTINCT make FROM car_models;

CREATE VIEW public_events AS
  SELECT id, name, show_spot, show_apartment, starts_on, ends_on,
    (starts_on IS NULL OR current_date BETWEEN starts_on AND ends_on) AS open
  FROM events
  WHERE active;

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE permits ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION url_encode(data bytea) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT translate(encode(data, 'base64'), E'+/=\n', '-_');
$$;

CREATE FUNCTION sign_hs256(payload json) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  header text := url_encode(convert_to('{"alg":"HS256","typ":"JWT"}', 'utf8'));
  body text := url_encode(convert_to(payload::text, 'utf8'));
  secret text := nullif(current_setting('app.jwt_secret', true), '');
BEGIN
  IF secret IS NULL THEN
    SELECT value INTO secret FROM app_private.settings WHERE key = 'jwt_secret';
  END IF;
  IF secret IS NULL THEN
    RAISE EXCEPTION 'Sign in is not configured' USING ERRCODE = '28000';
  END IF;
  RETURN header || '.' || body || '.' || url_encode(hmac(header || '.' || body, secret, 'sha256'));
END;
$$;

CREATE FUNCTION random_code() RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw text := '';
  i integer;
BEGIN
  FOR i IN 1..7 LOOP
    raw := raw || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
  END LOOP;
  RETURN substr(raw, 1, 3) || '-' || substr(raw, 4);
END;
$$;

CREATE FUNCTION permit_payload(p_id uuid) RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'code', p.code,
    'event_name', e.name,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'color', p.color,
    'make', p.make,
    'model', p.model,
    'year', p.year,
    'plate', p.plate,
    'state', p.state,
    'spot', p.spot,
    'apartment', p.apartment
  )
  FROM permits p
  JOIN events e ON e.id = p.event_id
  WHERE p.id = p_id;
$$;

CREATE FUNCTION permit_by_code(p_code text) RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM permits
  WHERE code = upper(trim(p_code));
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN permit_payload(v_id);
END;
$$;

CREATE FUNCTION save_permit_mail(p_code text, p_image text) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_permit permits%ROWTYPE;
  v_image bytea;
BEGIN
  SELECT * INTO v_permit FROM permits WHERE code = upper(btrim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No permit with that code' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_image := decode(p_image, 'base64');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'The permit image is not valid' USING ERRCODE = '22023';
  END;
  IF octet_length(v_image) < 32
     OR octet_length(v_image) > 1500000
     OR substring(v_image FROM 1 FOR 8) <> decode('89504e470d0a1a0a', 'hex') THEN
    RAISE EXCEPTION 'The permit image is not valid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO permit_mail (permit_id, email, image)
  VALUES (v_permit.id, v_permit.email, v_image)
  ON CONFLICT (permit_id) DO UPDATE
    SET email = EXCLUDED.email,
        image = EXCLUDED.image,
        created_at = now();
  RETURN json_build_object('saved', true);
END;
$$;

CREATE FUNCTION admin_login(p_email text, p_password text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(regexp_replace(coalesce(p_email, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  v_password text := regexp_replace(coalesce(p_password, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_hash text;
  v_exp integer;
BEGIN
  SELECT password_hash INTO v_hash FROM admins WHERE email = v_email;
  IF v_hash IS NULL OR v_hash <> crypt(v_password, v_hash) THEN
    RAISE EXCEPTION 'Email or password is wrong' USING ERRCODE = '28000';
  END IF;
  v_exp := extract(epoch FROM (now() + interval '12 hours'))::integer;
  RETURN sign_hs256(json_build_object(
    'role', 'web_admin',
    'email', v_email,
    'exp', v_exp
  ));
END;
$$;

CREATE FUNCTION create_permit(
  p_event_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_spot text,
  p_apartment text,
  p_make text,
  p_model text,
  p_year integer,
  p_color text,
  p_plate text,
  p_state text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev events%ROWTYPE;
  v_first text := btrim(p_first_name);
  v_last text := btrim(p_last_name);
  v_email text := lower(btrim(p_email));
  v_phone text := btrim(p_phone);
  v_make text := btrim(p_make);
  v_model text := btrim(p_model);
  v_color text := btrim(p_color);
  v_plate text := upper(regexp_replace(btrim(p_plate), '[^A-Za-z0-9]', '', 'g'));
  v_state text := upper(btrim(p_state));
  v_spot text;
  v_apartment text;
  v_code text;
  v_id uuid;
  i integer;
BEGIN
  SELECT * INTO ev FROM events WHERE id = p_event_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This parking link is not open' USING ERRCODE = '22023';
  END IF;
  IF ev.starts_on IS NOT NULL AND current_date < ev.starts_on THEN
    RAISE EXCEPTION 'This parking link opens on %', to_char(ev.starts_on, 'FMMonth FMDD, YYYY')
      USING ERRCODE = '22023';
  END IF;
  IF ev.ends_on IS NOT NULL AND current_date > ev.ends_on THEN
    RAISE EXCEPTION 'This parking link ended on %', to_char(ev.ends_on, 'FMMonth FMDD, YYYY')
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_first) < 1 OR char_length(v_last) < 1 THEN
    RAISE EXCEPTION 'Enter a first and last name' USING ERRCODE = '22023';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Enter an email address' USING ERRCODE = '22023';
  END IF;
  IF char_length(regexp_replace(v_phone, '\D', '', 'g')) < 7 THEN
    RAISE EXCEPTION 'Enter a phone number' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM car_years
    WHERE make = v_make AND model = v_model AND year = p_year
  ) THEN
    RAISE EXCEPTION 'Choose a make, model, and year that match' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM colors WHERE name = v_color) THEN
    RAISE EXCEPTION 'Choose a color' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_plate) < 2 OR char_length(v_plate) > 8 THEN
    RAISE EXCEPTION 'Enter a license plate' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plate_states WHERE code = v_state) THEN
    RAISE EXCEPTION 'Choose a state' USING ERRCODE = '22023';
  END IF;

  IF ev.show_spot THEN
    v_spot := nullif(btrim(p_spot), '');
    IF v_spot IS NULL THEN
      RAISE EXCEPTION 'Enter a parking spot' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF ev.show_apartment THEN
    v_apartment := nullif(btrim(p_apartment), '');
    IF v_apartment IS NULL THEN
      RAISE EXCEPTION 'Enter an apartment number' USING ERRCODE = '22023';
    END IF;
  END IF;

  FOR i IN 1..8 LOOP
    v_code := random_code();
    BEGIN
      INSERT INTO permits (
        event_id, code, first_name, last_name, email, phone,
        spot, apartment, make, model, year, color, plate, state
      ) VALUES (
        ev.id, v_code, v_first, v_last, v_email, v_phone,
        v_spot, v_apartment, v_make, v_model, p_year, v_color, v_plate, v_state
      )
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_id := NULL;
    END;
  END LOOP;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Could not assign a permit code' USING ERRCODE = 'P0001';
  END IF;
  RETURN permit_payload(v_id);
END;
$$;

REVOKE ALL ON FUNCTION url_encode(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION sign_hs256(json) FROM PUBLIC;
REVOKE ALL ON FUNCTION random_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION permit_payload(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION permit_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_permit_mail(text, text) FROM PUBLIC;
CREATE FUNCTION jwt_email() RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT lower(nullif(current_setting('request.jwt.claims', true), '')::json->>'email');
$$;

CREATE FUNCTION jwt_is_super() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admins WHERE email = jwt_email() AND is_super);
$$;

CREATE FUNCTION can_access_event(p_event_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jwt_is_super() OR EXISTS (
    SELECT 1 FROM event_admins
    WHERE event_id = p_event_id AND email = jwt_email()
  );
$$;

CREATE POLICY events_select ON events
  FOR SELECT TO web_admin
  USING (can_access_event(id));

CREATE POLICY events_insert ON events
  FOR INSERT TO web_admin
  WITH CHECK (jwt_is_super());

CREATE POLICY events_update ON events
  FOR UPDATE TO web_admin
  USING (can_access_event(id))
  WITH CHECK (can_access_event(id));

CREATE POLICY permits_select ON permits
  FOR SELECT TO web_admin
  USING (can_access_event(event_id));

CREATE FUNCTION assert_admin() RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := jwt_email();
BEGIN
  IF v_email IS NULL OR NOT EXISTS (SELECT 1 FROM admins WHERE email = v_email) THEN
    RAISE EXCEPTION 'Sign in as an admin' USING ERRCODE = '42501';
  END IF;
  RETURN v_email;
END;
$$;

CREATE FUNCTION whoami() RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object('email', email, 'is_super', is_super)
  FROM admins
  WHERE email = assert_admin();
$$;

CREATE FUNCTION change_password(p_current text, p_new text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := assert_admin();
  v_hash text;
BEGIN
  SELECT password_hash INTO v_hash FROM admins WHERE email = v_email;
  IF v_hash IS NULL OR v_hash <> crypt(p_current, v_hash) THEN
    RAISE EXCEPTION 'Current password is wrong' USING ERRCODE = '28000';
  END IF;
  IF char_length(p_new) < 8 THEN
    RAISE EXCEPTION 'Use at least 8 characters for the password' USING ERRCODE = '22023';
  END IF;
  UPDATE admins SET password_hash = crypt(p_new, gen_salt('bf')) WHERE email = v_email;
END;
$$;

CREATE FUNCTION delete_tenant(p_event_id uuid, p_password text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := assert_admin();
  v_hash text;
BEGIN
  IF NOT jwt_is_super() THEN
    RAISE EXCEPTION 'Only the main admin can delete a tenant' USING ERRCODE = '42501';
  END IF;
  SELECT password_hash INTO v_hash FROM admins WHERE email = v_email;
  IF v_hash IS NULL OR v_hash <> crypt(p_password, v_hash) THEN
    RAISE EXCEPTION 'Password is wrong' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id) THEN
    RAISE EXCEPTION 'That tenant was not found' USING ERRCODE = '22023';
  END IF;
  DELETE FROM permits WHERE event_id = p_event_id;
  DELETE FROM events WHERE id = p_event_id;
  DELETE FROM admins a
  WHERE NOT a.is_super
    AND NOT EXISTS (SELECT 1 FROM event_admins ea WHERE ea.email = a.email);
END;
$$;

CREATE FUNCTION list_tenant_admins(p_event_id uuid) RETURNS TABLE (email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_admin();
  IF NOT can_access_event(p_event_id) THEN
    RAISE EXCEPTION 'You cannot view this tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT ea.email FROM event_admins ea
    WHERE ea.event_id = p_event_id
    ORDER BY ea.email;
END;
$$;

CREATE FUNCTION add_tenant_admin(p_event_id uuid, p_email text, p_password text) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_password text := NULL;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i integer;
BEGIN
  PERFORM assert_admin();
  IF NOT can_access_event(p_event_id) THEN
    RAISE EXCEPTION 'You cannot change this tenant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id) THEN
    RAISE EXCEPTION 'That tenant was not found' USING ERRCODE = '22023';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Enter an email address' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM admins WHERE email = v_email AND is_super) THEN
    RAISE EXCEPTION 'The main admin already sees every tenant' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admins WHERE email = v_email) THEN
    FOR i IN 1..10 LOOP
      v_password := coalesce(v_password, '') || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    END LOOP;
    INSERT INTO admins (email, password_hash, is_super)
    VALUES (v_email, crypt(v_password, gen_salt('bf')), false);
  END IF;
  INSERT INTO event_admins (event_id, email) VALUES (p_event_id, v_email);
  RETURN json_build_object('email', v_email, 'temporary_password', v_password);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That admin is already on this tenant' USING ERRCODE = '23505';
END;
$$;

CREATE FUNCTION remove_tenant_admin(p_event_id uuid, p_email text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_removed integer;
BEGIN
  PERFORM assert_admin();
  IF NOT can_access_event(p_event_id) THEN
    RAISE EXCEPTION 'You cannot change this tenant' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM admins WHERE email = v_email AND is_super) THEN
    RAISE EXCEPTION 'The main admin stays on every tenant' USING ERRCODE = '22023';
  END IF;
  DELETE FROM event_admins WHERE event_id = p_event_id AND email = v_email;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed = 0 THEN
    RAISE EXCEPTION 'That admin is not on this tenant' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM event_admins WHERE email = v_email) THEN
    DELETE FROM admins WHERE email = v_email AND NOT is_super;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_login(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_permit(uuid, text, text, text, text, text, text, text, text, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jwt_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION jwt_is_super() FROM PUBLIC;
REVOKE ALL ON FUNCTION can_access_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assert_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION whoami() FROM PUBLIC;
REVOKE ALL ON FUNCTION change_password(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_tenant(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_tenant_admins(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_tenant_admin(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION remove_tenant_admin(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION admin_login(text, text) TO web_anon;
GRANT EXECUTE ON FUNCTION create_permit(uuid, text, text, text, text, text, text, text, text, integer, text, text, text) TO web_anon;
GRANT EXECUTE ON FUNCTION permit_by_code(text) TO web_anon;
GRANT EXECUTE ON FUNCTION save_permit_mail(text, text) TO web_anon, web_admin;
GRANT EXECUTE ON FUNCTION jwt_email() TO web_admin;
GRANT EXECUTE ON FUNCTION jwt_is_super() TO web_admin;
GRANT EXECUTE ON FUNCTION can_access_event(uuid) TO web_admin;
GRANT EXECUTE ON FUNCTION whoami() TO web_admin;
GRANT EXECUTE ON FUNCTION change_password(text, text) TO web_admin;
GRANT EXECUTE ON FUNCTION delete_tenant(uuid, text) TO web_admin;
GRANT EXECUTE ON FUNCTION list_tenant_admins(uuid) TO web_admin;
GRANT EXECUTE ON FUNCTION add_tenant_admin(uuid, text, text) TO web_admin;
GRANT EXECUTE ON FUNCTION remove_tenant_admin(uuid, text) TO web_admin;

GRANT SELECT ON car_makes, car_models, car_years, colors, plate_states, public_events TO web_anon, web_admin;
GRANT SELECT, INSERT, UPDATE ON events TO web_admin;
GRANT SELECT ON permits TO web_admin;

INSERT INTO colors (name, sort) VALUES
  ('Black', 1),
  ('White', 2),
  ('Silver', 3),
  ('Gray', 4),
  ('Red', 5),
  ('Blue', 6),
  ('Green', 7),
  ('Brown', 8),
  ('Gold', 9),
  ('Orange', 10),
  ('Yellow', 11),
  ('Other', 12);

INSERT INTO plate_states (code, name) VALUES
  ('AL','Alabama'), ('AK','Alaska'), ('AZ','Arizona'), ('AR','Arkansas'),
  ('CA','California'), ('CO','Colorado'), ('CT','Connecticut'), ('DE','Delaware'),
  ('DC','District of Columbia'), ('FL','Florida'), ('GA','Georgia'), ('HI','Hawaii'),
  ('ID','Idaho'), ('IL','Illinois'), ('IN','Indiana'), ('IA','Iowa'),
  ('KS','Kansas'), ('KY','Kentucky'), ('LA','Louisiana'), ('ME','Maine'),
  ('MD','Maryland'), ('MA','Massachusetts'), ('MI','Michigan'), ('MN','Minnesota'),
  ('MS','Mississippi'), ('MO','Missouri'), ('MT','Montana'), ('NE','Nebraska'),
  ('NV','Nevada'), ('NH','New Hampshire'), ('NJ','New Jersey'), ('NM','New Mexico'),
  ('NY','New York'), ('NC','North Carolina'), ('ND','North Dakota'), ('OH','Ohio'),
  ('OK','Oklahoma'), ('OR','Oregon'), ('PA','Pennsylvania'), ('RI','Rhode Island'),
  ('SC','South Carolina'), ('SD','South Dakota'), ('TN','Tennessee'), ('TX','Texas'),
  ('UT','Utah'), ('VT','Vermont'), ('VA','Virginia'), ('WA','Washington'),
  ('WV','West Virginia'), ('WI','Wisconsin'), ('WY','Wyoming');

INSERT INTO car_models (make, model, year_from, year_to) VALUES
  ('Acura','MDX',2012,2026),
  ('Acura','RDX',2012,2026),
  ('Acura','TLX',2015,2026),
  ('Audi','A4',2012,2026),
  ('Audi','Q5',2012,2026),
  ('Audi','Q7',2012,2026),
  ('BMW','3 Series',2012,2026),
  ('BMW','5 Series',2012,2026),
  ('BMW','X3',2012,2026),
  ('BMW','X5',2012,2026),
  ('Buick','Enclave',2012,2026),
  ('Cadillac','Escalade',2012,2026),
  ('Cadillac','XT5',2017,2026),
  ('Chevrolet','Colorado',2015,2026),
  ('Chevrolet','Equinox',2012,2026),
  ('Chevrolet','Malibu',2012,2025),
  ('Chevrolet','Silverado',2012,2026),
  ('Chevrolet','Tahoe',2012,2026),
  ('Chevrolet','Traverse',2012,2026),
  ('Chevrolet','Trax',2015,2026),
  ('Chrysler','Pacifica',2017,2026),
  ('Dodge','Challenger',2012,2023),
  ('Dodge','Charger',2012,2026),
  ('Dodge','Durango',2012,2026),
  ('Ford','Bronco',2021,2026),
  ('Ford','Edge',2012,2024),
  ('Ford','Escape',2012,2026),
  ('Ford','Explorer',2012,2026),
  ('Ford','F-150',2012,2026),
  ('Ford','Maverick',2022,2026),
  ('Ford','Mustang',2012,2026),
  ('Ford','Ranger',2019,2026),
  ('GMC','Acadia',2012,2026),
  ('GMC','Sierra',2012,2026),
  ('GMC','Terrain',2012,2026),
  ('GMC','Yukon',2012,2026),
  ('Honda','Accord',2012,2026),
  ('Honda','CR-V',2012,2026),
  ('Honda','Civic',2012,2026),
  ('Honda','HR-V',2016,2026),
  ('Honda','Odyssey',2012,2026),
  ('Honda','Passport',2019,2026),
  ('Honda','Pilot',2012,2026),
  ('Honda','Ridgeline',2017,2026),
  ('Hyundai','Elantra',2012,2026),
  ('Hyundai','Kona',2018,2026),
  ('Hyundai','Palisade',2020,2026),
  ('Hyundai','Santa Fe',2012,2026),
  ('Hyundai','Sonata',2012,2026),
  ('Hyundai','Tucson',2012,2026),
  ('Jeep','Cherokee',2014,2023),
  ('Jeep','Compass',2012,2026),
  ('Jeep','Gladiator',2020,2026),
  ('Jeep','Grand Cherokee',2012,2026),
  ('Jeep','Wrangler',2012,2026),
  ('Kia','Forte',2012,2026),
  ('Kia','K5',2021,2026),
  ('Kia','Optima',2012,2020),
  ('Kia','Sorento',2012,2026),
  ('Kia','Soul',2012,2026),
  ('Kia','Sportage',2012,2026),
  ('Kia','Telluride',2020,2026),
  ('Lexus','ES',2012,2026),
  ('Lexus','NX',2015,2026),
  ('Lexus','RX',2012,2026),
  ('Mazda','CX-5',2013,2026),
  ('Mazda','CX-50',2023,2026),
  ('Mazda','CX-9',2012,2024),
  ('Mazda','Mazda3',2012,2026),
  ('Mercedes-Benz','C-Class',2012,2026),
  ('Mercedes-Benz','E-Class',2012,2026),
  ('Mercedes-Benz','GLC',2016,2026),
  ('Mercedes-Benz','GLE',2016,2026),
  ('Mitsubishi','Outlander',2012,2026),
  ('Mitsubishi','Outlander Sport',2012,2026),
  ('Nissan','Altima',2012,2026),
  ('Nissan','Frontier',2012,2026),
  ('Nissan','Murano',2012,2026),
  ('Nissan','Pathfinder',2012,2026),
  ('Nissan','Rogue',2012,2026),
  ('Nissan','Sentra',2012,2026),
  ('Ram','1500',2012,2026),
  ('Ram','2500',2012,2026),
  ('Subaru','Ascent',2019,2026),
  ('Subaru','Crosstrek',2013,2026),
  ('Subaru','Forester',2012,2026),
  ('Subaru','Impreza',2012,2026),
  ('Subaru','Outback',2012,2026),
  ('Tesla','Model 3',2018,2026),
  ('Tesla','Model S',2012,2026),
  ('Tesla','Model X',2016,2026),
  ('Tesla','Model Y',2020,2026),
  ('Toyota','4Runner',2012,2026),
  ('Toyota','Camry',2012,2026),
  ('Toyota','Corolla',2012,2026),
  ('Toyota','Highlander',2012,2026),
  ('Toyota','Prius',2012,2026),
  ('Toyota','RAV4',2012,2026),
  ('Toyota','Sienna',2012,2026),
  ('Toyota','Tacoma',2012,2026),
  ('Toyota','Tundra',2012,2026),
  ('Volkswagen','Atlas',2018,2026),
  ('Volkswagen','Golf',2012,2021),
  ('Volkswagen','Jetta',2012,2026),
  ('Volkswagen','Tiguan',2012,2026),
  ('Volvo','XC60',2012,2026),
  ('Volvo','XC90',2016,2026);

INSERT INTO car_years (make, model, year)
SELECT make, model, generate_series(year_from, year_to)
FROM car_models;

INSERT INTO admins (email, password_hash, is_super)
VALUES (lower(:'admin_email'), crypt(:'admin_password', gen_salt('bf')), true);

INSERT INTO events (id, name, active, show_spot, show_apartment)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Sample lot',
  true,
  true,
  true
);
