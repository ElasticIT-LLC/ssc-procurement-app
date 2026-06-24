-- app_procurement initial schema (publish-app prepends SET search_path TO app_procurement, public).
-- No RLS statements here — the auto_enable_app_rls trigger applies advisor-safe defaults.

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, address TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, description TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id      UUID,                                  -- auth.uid() for internal; NULL for public (Phase 4)
  requester_name    TEXT,
  requester_email   TEXT,
  requester_type    TEXT NOT NULL DEFAULT 'portal_user' CHECK (requester_type IN ('portal_user','public')),
  submission_source TEXT NOT NULL DEFAULT 'in_portal'   CHECK (submission_source IN ('in_portal','public_link')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','on_hold','partially_approved','approved','declined')),
  notes             TEXT,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_requests_requester_idx ON purchase_requests (requester_id);
CREATE INDEX IF NOT EXISTS purchase_requests_status_idx ON purchase_requests (status);

CREATE TABLE IF NOT EXISTS line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests (id) ON DELETE CASCADE,
  ship_to_name TEXT, location_id UUID REFERENCES locations (id), custom_location TEXT,
  department_id UUID REFERENCES departments (id), custom_department TEXT,
  item_url TEXT, item_description TEXT, memo TEXT,
  quantity INTEGER NOT NULL DEFAULT 1, substitution_ok BOOLEAN NOT NULL DEFAULT false, date_needed DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','declined','on_hold','ordered','received','returned','replacement_ordered')),
  approved_by UUID, approval_date TIMESTAMPTZ,
  date_purchased DATE, shipping_location_id UUID REFERENCES locations (id), custom_shipping_location TEXT,
  eta DATE, purchase_notes TEXT,
  return_quantity INTEGER, return_reason TEXT CHECK (return_reason IS NULL OR return_reason IN ('poor_quality','didnt_need','broken','other')),
  has_packaging BOOLEAN, wants_replacement BOOLEAN, return_date TIMESTAMPTZ, return_notes TEXT,
  product_image_path TEXT,                                 -- set in Phase 2 (screenshot capture)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS line_items_request_idx ON line_items (request_id);
CREATE INDEX IF NOT EXISTS line_items_status_idx ON line_items (status);

CREATE TABLE IF NOT EXISTS _config (key TEXT PRIMARY KEY, value TEXT);

INSERT INTO locations (name) VALUES ('Main Office'), ('Warehouse') ON CONFLICT DO NOTHING;
INSERT INTO departments (name) VALUES ('Operations'), ('Clinical'), ('Administration') ON CONFLICT DO NOTHING;
