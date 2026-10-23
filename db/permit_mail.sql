CREATE TABLE IF NOT EXISTS permit_mail (
  permit_id uuid PRIMARY KEY REFERENCES permits (id) ON DELETE CASCADE,
  email text NOT NULL,
  image bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE permit_mail ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE permit_mail FROM PUBLIC, web_anon, web_admin;

CREATE OR REPLACE FUNCTION save_permit_mail(p_code text, p_image text) RETURNS json
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

REVOKE ALL ON FUNCTION save_permit_mail(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_permit_mail(text, text) TO web_anon, web_admin;

NOTIFY pgrst, 'reload schema';
