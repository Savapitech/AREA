import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1795735345103 implements MigrationInterface {
    name = 'Init1795735345103'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" text NOT NULL, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "workflows" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "name" text NOT NULL, "config" jsonb NOT NULL, CONSTRAINT "workflow_has_trigger" CHECK ("config" -> 'trigger' IS NOT NULL), CONSTRAINT "PK_5b5757cc1cd86268019fef52e0c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "nodes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workflow_id" uuid NOT NULL, "position" integer NOT NULL, "type" text NOT NULL, "params" jsonb NOT NULL, CONSTRAINT "UQ_452bb18a10bbb1a5d6cb137f763" UNIQUE ("workflow_id", "position"), CONSTRAINT "PK_682d6427523a0fa43d062ea03ee" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "service_connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "service" text NOT NULL, CONSTRAINT "UQ_ca7d49cc727178479be612d9539" UNIQUE ("user_id", "service"), CONSTRAINT "PK_21959bac3ec4afc986139f06c6f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "hook_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "source" text NOT NULL, "external_id" text NOT NULL, CONSTRAINT "UQ_d720911c4d63a787130f531fce4" UNIQUE ("source", "external_id"), CONSTRAINT "PK_630ecef7cfed382639f05f2256d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "jobs" ("id" SERIAL NOT NULL, "claimed_by" integer, CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "workflows" ADD CONSTRAINT "FK_0a52180b1fead686fa874dcf951" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "nodes" ADD CONSTRAINT "FK_e787f08bd0e38aa2d4ad40ce951" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "service_connections" ADD CONSTRAINT "FK_3f26bf2f6ad27c324858790c286" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "service_connections" DROP CONSTRAINT "FK_3f26bf2f6ad27c324858790c286"`);
        await queryRunner.query(`ALTER TABLE "nodes" DROP CONSTRAINT "FK_e787f08bd0e38aa2d4ad40ce951"`);
        await queryRunner.query(`ALTER TABLE "workflows" DROP CONSTRAINT "FK_0a52180b1fead686fa874dcf951"`);
        await queryRunner.query(`DROP TABLE "jobs"`);
        await queryRunner.query(`DROP TABLE "hook_events"`);
        await queryRunner.query(`DROP TABLE "service_connections"`);
        await queryRunner.query(`DROP TABLE "nodes"`);
        await queryRunner.query(`DROP TABLE "workflows"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
