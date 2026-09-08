-- Monotonic counter for PdfRemoteState.version.
-- Replaces the previous wall-clock version (max(Pipeline.updatedAt)), which could
-- go backwards across function instances with skewed clocks and cause clients to
-- permanently discard newer state.
CREATE SEQUENCE IF NOT EXISTS "control_state_version" AS BIGINT START WITH 1 INCREMENT BY 1 CACHE 1;
