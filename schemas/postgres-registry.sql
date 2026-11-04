CREATE SCHEMA agent_connectors;
REVOKE ALL ON SCHEMA agent_connectors FROM PUBLIC;

CREATE TABLE agent_connectors.schema_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL CHECK (version = 1)
);
INSERT INTO agent_connectors.schema_version VALUES (true, 1);

CREATE TABLE agent_connectors.registries (
  id uuid PRIMARY KEY,
  generation bigint NOT NULL CHECK (generation >= 0 AND generation <= 9007199254740991),
  document text NOT NULL CHECK (octet_length(document) <= 4194304),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  CHECK ((document::jsonb ->> 'id')::uuid = id),
  CHECK ((document::jsonb ->> 'generation')::bigint = generation),
  CHECK ((document::jsonb ->> 'formatVersion')::integer = 1)
);
CREATE TABLE agent_connectors.registry_access (
  registry_id uuid NOT NULL REFERENCES agent_connectors.registries(id),
  role_name name NOT NULL,
  can_write boolean NOT NULL DEFAULT false,
  PRIMARY KEY (registry_id, role_name)
);

ALTER TABLE agent_connectors.registries ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_connectors.registries FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_connectors.registry_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_connectors.registry_access FORCE ROW LEVEL SECURITY;
CREATE POLICY own_access ON agent_connectors.registry_access FOR SELECT
  USING (role_name = current_user);
CREATE POLICY registry_read ON agent_connectors.registries FOR SELECT USING (
  EXISTS (SELECT 1 FROM agent_connectors.registry_access AS access
    WHERE access.registry_id = registries.id AND access.role_name = current_user)
);
CREATE POLICY registry_update ON agent_connectors.registries FOR UPDATE USING (
  EXISTS (SELECT 1 FROM agent_connectors.registry_access AS access
    WHERE access.registry_id = registries.id AND access.role_name = current_user AND access.can_write)
) WITH CHECK (
  EXISTS (SELECT 1 FROM agent_connectors.registry_access AS access
    WHERE access.registry_id = registries.id AND access.role_name = current_user AND access.can_write)
);
REVOKE ALL ON ALL TABLES IN SCHEMA agent_connectors FROM PUBLIC;
