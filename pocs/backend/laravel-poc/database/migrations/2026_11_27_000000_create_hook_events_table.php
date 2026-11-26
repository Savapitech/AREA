<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hook_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('source');
            $table->string('external_id');
            $table->json('payload')->nullable();
            $table->timestamp('received_at')->useCurrent();
            $table->unique(['source', 'external_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hook_events');
    }
};
