DROP FUNCTION IF EXISTS public.add_tenant_admin(uuid, text, text);

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

REVOKE ALL ON FUNCTION add_tenant_admin(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_tenant_admin(uuid, text, text) TO web_admin;

NOTIFY pgrst, 'reload schema';
