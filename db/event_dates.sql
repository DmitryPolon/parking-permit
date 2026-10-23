ALTER TABLE events
  ADD COLUMN IF NOT EXISTS starts_on date,
  ADD COLUMN IF NOT EXISTS ends_on date;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_dates;
ALTER TABLE events ADD CONSTRAINT events_dates CHECK (
  (starts_on IS NULL AND ends_on IS NULL)
  OR (starts_on IS NOT NULL AND ends_on IS NOT NULL AND starts_on <= ends_on)
);

CREATE OR REPLACE VIEW public_events AS
  SELECT id, name, show_spot, show_apartment, starts_on, ends_on,
    (starts_on IS NULL OR current_date BETWEEN starts_on AND ends_on) AS open
  FROM events
  WHERE active;
CREATE OR REPLACE FUNCTION create_permit(
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
NOTIFY pgrst, 'reload schema';
