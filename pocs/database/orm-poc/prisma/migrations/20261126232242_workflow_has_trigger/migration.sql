ALTER TABLE "workflows" ADD CONSTRAINT "workflow_has_trigger" CHECK ("config" -> 'trigger' IS NOT NULL);
